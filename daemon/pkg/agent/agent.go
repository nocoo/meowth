// Package agent provides a unified interface for executing prompts via
// coding agents (Claude Code, Codex, Copilot, Hermes, Pi). It mirrors the
// happy-cli AgentBackend pattern, translated to idiomatic Go.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// Backend is the unified interface for executing prompts via coding agents.
type Backend interface {
	// Execute runs a prompt and returns a Session for streaming results.
	// The caller should read from Session.Messages (optional) and wait on
	// Session.Result for the final outcome.
	Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}

// ExecOptions configures a single execution.
type ExecOptions struct {
	Cwd   string
	Model string
	// SystemPrompt is consumed only by providers that can pass or safely inline
	// developer/system instructions. Hermes ACP intentionally ignores it and
	// relies on cwd-scoped context files such as AGENTS.md instead.
	SystemPrompt              string
	ThreadName                string
	MaxTurns                  int
	Timeout                   time.Duration
	SemanticInactivityTimeout time.Duration
	ResumeSessionID           string          // if non-empty, resume a previous agent session
	ExtraArgs                 []string        // daemon-wide default CLI arguments appended before CustomArgs; currently read by claude and codex backends only
	CustomArgs                []string        // per-agent CLI arguments appended after ExtraArgs
	McpConfig                 json.RawMessage // if non-nil, MCP server config to pass via --mcp-config
	// ThinkingLevel is the runtime-native reasoning/effort value (e.g.
	// Claude's "low|medium|high|xhigh|max", Codex's "none|minimal|low|
	// medium|high|xhigh"). Empty means
	// "use the runtime/model default" —
	// every backend that consumes this skips its --effort / reasoning_effort
	// injection so the upstream CLI's own default applies. Currently honoured
	// by the claude and codex backends; other backends ignore the
	// field rather than fail (so MUL-2339 can grow runtime support
	// incrementally without breaking unrelated agents).
	ThinkingLevel string
}

// runContext derives the execution context for an agent subprocess from the
// configured per-run timeout. A positive timeout imposes a hard wall-clock
// deadline; a zero (or negative) timeout imposes NO deadline, leaving liveness
// entirely to the daemon's inactivity watchdog so a session that keeps emitting
// events is never killed merely for running long (MUL-3064). The caller owns
// the returned CancelFunc and must call it to release resources.
func runContext(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout > 0 {
		return context.WithTimeout(ctx, timeout)
	}
	return context.WithCancel(ctx)
}

// Session represents a running agent execution.
//
// Lifecycle contract (also covered by L1 tests in
// `daemon/pkg/agent/session_contract_test.go`):
//   - Result is buffered with capacity at least 1, so the backend
//     goroutine can always deliver the final outcome without waiting
//     for a reader. Callers may safely drain Messages first and read
//     Result afterwards without risk of deadlock.
//   - Result delivers exactly one value, then is closed by the
//     backend goroutine. A second receive returns the zero Result
//     with ok=false.
//   - Messages is closed by the same backend goroutine when the run
//     ends. Both channels are closed before the goroutine exits, but
//     the relative order of the Messages-close and the Result-send
//     is an implementation detail and not part of the contract; the
//     buffered Result is what makes the drain-then-read pattern safe.
type Session struct {
	// Messages streams events as the agent works. The channel is
	// closed when the agent finishes. The send side is non-blocking
	// (see trySend in claude.go) — when Messages is full, individual
	// events are dropped to keep the backend from stalling on a slow
	// consumer; the final state always lands via Result.
	Messages <-chan Message
	// Result delivers exactly one value — the final outcome — and is
	// then closed. Buffered (cap 1) so the backend can publish the
	// result and exit even if no reader is parked yet.
	Result <-chan Result
}

// MessageType identifies the kind of Message.
type MessageType string

const (
	MessageText       MessageType = "text"
	MessageThinking   MessageType = "thinking"
	MessageToolUse    MessageType = "tool-use"
	MessageToolResult MessageType = "tool-result"
	MessageStatus     MessageType = "status"
	MessageError      MessageType = "error"
	MessageLog        MessageType = "log"
)

// Message is a unified event emitted by an agent during execution.
type Message struct {
	Type      MessageType
	Content   string         // text content (Text, Error, Log)
	Tool      string         // tool name (ToolUse, ToolResult)
	CallID    string         // tool call ID (ToolUse, ToolResult)
	Input     map[string]any // tool input (ToolUse)
	Output    string         // tool output (ToolResult)
	Status    string         // agent status string (Status)
	Level     string         // log level (Log)
	SessionID string         // backend session id (Status), for early resume-pointer pinning
}

// TokenUsage tracks token consumption for a single model.
type TokenUsage struct {
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
}

// Result is the final outcome after an agent session completes.
type Result struct {
	Status     string // "completed", "failed", "aborted", "timeout", "cancelled"
	Output     string // accumulated text output
	Error      string // error message if failed
	DurationMs int64
	SessionID  string
	Usage      map[string]TokenUsage // keyed by model name
}

// Config configures a Backend instance.
type Config struct {
	ExecutablePath string            // path to CLI binary (claude, codex, copilot, hermes, pi)
	Env            map[string]string // extra environment variables
	Logger         *slog.Logger
}

// New creates a Backend for the given agent type.
// Supported types: "claude", "codex", "copilot", "hermes", "pi".
//
// SupportedTypes is the canonical whitelist of agent types New can construct.
// It MUST stay in lockstep with the switch in New below and the
// runtime_profile.protocol_family CHECK constraint (migration 120): a custom
// runtime profile may only be based on a backend Multica officially supports.
var SupportedTypes = []string{
	"claude",
	"codex",
	"copilot",
	"hermes",
	"pi",
}

// IsSupportedType reports whether agentType is in the SupportedTypes whitelist.
// Used to validate a custom runtime profile's protocol_family before it is
// persisted or registered.
func IsSupportedType(agentType string) bool {
	for _, t := range SupportedTypes {
		if t == agentType {
			return true
		}
	}
	return false
}

func New(agentType string, cfg Config) (Backend, error) {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}

	switch agentType {
	case "claude":
		return &claudeBackend{cfg: cfg}, nil
	case "codex":
		return &codexBackend{cfg: cfg}, nil
	case "copilot":
		return &copilotBackend{cfg: cfg}, nil
	case "hermes":
		return &hermesBackend{cfg: cfg}, nil
	case "pi":
		return &piBackend{cfg: cfg}, nil
	default:
		return nil, fmt.Errorf("unknown agent type: %q (supported: claude, codex, copilot, hermes, pi)", agentType)
	}
}

// DetectVersion runs the agent CLI with --version and returns the output.
func DetectVersion(ctx context.Context, executablePath string) (string, error) {
	return detectCLIVersion(ctx, executablePath)
}

// launchHeaders maps each supported agent type to the user-visible skeleton
// that the daemon spawns before any custom_args are appended. This is
// intentionally minimal — only the command + subcommand (or a short mode
// label when there is no subcommand). Internal flags, transport values, and
// environment variables are deliberately omitted so the string is a hint
// about *what* users are extending, not a dump of the full command line.
var launchHeaders = map[string]string{
	"claude":  "claude (stream-json)",
	"codex":   "codex app-server",
	"copilot": "copilot (json)",
	"hermes":  "hermes acp",
	"pi":      "pi (json mode)",
}

// LaunchHeader returns the user-visible launch skeleton for agentType, or an
// empty string if the type is unknown. Callers render this as a preview so
// users understand which command their custom_args get appended to.
func LaunchHeader(agentType string) string {
	return launchHeaders[agentType]
}
