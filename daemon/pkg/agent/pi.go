package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// piBackend implements Backend by spawning the Pi CLI in non-interactive
// JSON mode (`pi -p --mode json --session <path>`) and parsing its event
// stream on stdout.
type piBackend struct {
	cfg Config
}

var (
	piControlTokenRE = regexp.MustCompile(`<\|[A-Za-z0-9_-]+>[A-Za-z0-9_-]*|<[A-Za-z0-9_-]+\|>`)
)

// emitChunkedMessageText splits text into UTF-8 rune-safe chunks that comfortably
// fit within the consumer's (Teams Native MeowthStreamDecoder.maximumLineBytes = 524,288 bytes)
// and daemon envelope's (1 MiB) per-line limit even after worst-case JSON string escaping
// (where control characters like \u0001 become 6 bytes: \ u 0 0 0 1, or quotes become \").
// Target chunk byte size is at most 64 KiB, guaranteeing encoded line length < 512 KiB.
func emitChunkedMessageText(pipe *messagePipe, text string) {
	if text == "" {
		return
	}
	const maxChunkBytes = 64 * 1024
	for len(text) > 0 {
		if len(text) <= maxChunkBytes {
			pipe.Send(Message{Type: MessageText, Content: text})
			return
		}
		// Cut at rune boundary <= maxChunkBytes
		cut := maxChunkBytes
		for cut > 0 && (text[cut]&0xC0) == 0x80 {
			cut--
		}
		if cut == 0 {
			// Fallback: advance at least to next valid rune boundary
			cut = 1
			for cut < len(text) && (text[cut]&0xC0) == 0x80 {
				cut++
			}
		}
		pipe.Send(Message{Type: MessageText, Content: text[:cut]})
		text = text[cut:]
	}
}

func stripPiToolCallMarkup(s string) string {
	s = stripPiStructuredToolMarkup(s)
	return piControlTokenRE.ReplaceAllString(s, "")
}

func drainPiTextBuffer(buf *strings.Builder, delta string) string {
	buf.WriteString(delta)
	emit, pending := drainPiSanitizedText(buf.String())
	buf.Reset()
	buf.WriteString(pending)
	return emit
}

func flushPiTextBuffer(buf *strings.Builder) string {
	s := buf.String()
	buf.Reset()
	emit, pending := drainPiSanitizedText(s)
	emit += piControlTokenRE.ReplaceAllString(pending, "")
	return emit
}

func drainPiSanitizedText(s string) (string, string) {
	var out strings.Builder
	for i := 0; i < len(s); {
		start, prefixLen := nextPiToolMarkupPrefix(s, i)
		if start == -1 {
			safeLen := safePiTextEmitLen(s[i:])
			out.WriteString(s[i : i+safeLen])
			return piControlTokenRE.ReplaceAllString(out.String(), ""), s[i+safeLen:]
		}
		out.WriteString(s[i:start])
		end, ok := scanPiToolMarkupEnd(s, start+prefixLen)
		if !ok {
			return piControlTokenRE.ReplaceAllString(out.String(), ""), s[start:]
		}
		i = end
	}
	return piControlTokenRE.ReplaceAllString(out.String(), ""), ""
}

func stripPiStructuredToolMarkup(s string) string {
	var out strings.Builder
	for i := 0; i < len(s); {
		start, prefixLen := nextPiToolMarkupPrefix(s, i)
		if start == -1 {
			out.WriteString(s[i:])
			break
		}
		out.WriteString(s[i:start])
		end, ok := scanPiToolMarkupEnd(s, start+prefixLen)
		if !ok {
			out.WriteString(s[start:])
			break
		}
		i = end
	}
	return out.String()
}

func safePiTextEmitLen(s string) int {
	hold := 0
	for _, prefix := range []string{"call:", "response:"} {
		for n := 1; n < len(prefix) && n <= len(s); n++ {
			if strings.HasSuffix(s, prefix[:n]) && n > hold {
				hold = n
			}
		}
	}
	if i := strings.LastIndexByte(s, '<'); i >= 0 && looksLikePiControlTokenPrefix(s[i:]) {
		if len(s)-i > hold {
			hold = len(s) - i
		}
	}
	return len(s) - hold
}

func looksLikePiControlTokenPrefix(s string) bool {
	if len(s) == 0 || s[0] != '<' || len(s) > 64 {
		return false
	}
	for i := 1; i < len(s); i++ {
		b := s[i]
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_' || b == '-' || b == '|' || b == '>' {
			continue
		}
		return false
	}
	return true
}

func nextPiToolMarkupPrefix(s string, from int) (int, int) {
	best := -1
	bestLen := 0
	for _, prefix := range []string{"call:", "response:"} {
		if i := strings.Index(s[from:], prefix); i >= 0 {
			abs := from + i
			if best == -1 || abs < best {
				best = abs
				bestLen = len(prefix)
			}
		}
	}
	return best, bestLen
}

func scanPiToolMarkupEnd(s string, i int) (int, bool) {
	nameStart := i
	for i < len(s) && isPiToolNameByte(s[i]) {
		i++
	}
	if i == nameStart || i >= len(s) || s[i] != '{' {
		return 0, false
	}

	const quoteMarker = `<|"|>`
	depth := 0
	inQuote := false
	for i < len(s) {
		if strings.HasPrefix(s[i:], quoteMarker) {
			inQuote = !inQuote
			i += len(quoteMarker)
			continue
		}

		if !inQuote {
			switch s[i] {
			case '{':
				depth++
			case '}':
				depth--
				if depth == 0 {
					i++
					if strings.HasPrefix(s[i:], "<tool_call|>") {
						i += len("<tool_call|>")
					}
					return i, true
				}
			}
		}
		i++
	}
	return 0, false
}

func isPiToolNameByte(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_' || b == '-'
}

func (b *piBackend) Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error) {
	execName := b.cfg.ExecutablePath
	if execName == "" {
		execName = "pi"
	}
	lookedUp, err := exec.LookPath(execName)
	if err != nil {
		return nil, fmt.Errorf("pi executable not found at %q: %w", execName, err)
	}

	timeout := opts.Timeout

	// Pi's --session flag expects a file path where events are appended.
	// The path doubles as our opaque session identifier: we return it as
	// SessionID and expect it back as ResumeSessionID on the next turn.
	sessionPath := opts.ResumeSessionID
	if sessionPath == "" {
		p, err := newPiSessionPath()
		if err != nil {
			return nil, fmt.Errorf("pi session path: %w", err)
		}
		sessionPath = p
	}
	if err := ensurePiSessionFile(sessionPath); err != nil {
		return nil, fmt.Errorf("pi session file: %w", err)
	}

	// Pi's --append-system-prompt flag natively accepts a file path.
	// If a system prompt is provided, write it to a temporary file (0600)
	// with an absolute path so it never appears in argv or encounters ARG_MAX limitations.
	var systemPromptPath string
	if opts.SystemPrompt != "" {
		tmpFile, err := os.CreateTemp("", "meowth-pi-sysprompt-*.txt")
		if err != nil {
			return nil, fmt.Errorf("pi system prompt tempfile: %w", err)
		}
		absPath, err := filepath.Abs(tmpFile.Name())
		if err != nil {
			_ = tmpFile.Close()
			_ = os.Remove(tmpFile.Name())
			return nil, fmt.Errorf("pi system prompt abs path: %w", err)
		}
		systemPromptPath = absPath
		if _, err := tmpFile.WriteString(opts.SystemPrompt); err != nil {
			_ = tmpFile.Close()
			_ = os.Remove(systemPromptPath)
			return nil, fmt.Errorf("pi system prompt write: %w", err)
		}
		if err := tmpFile.Close(); err != nil {
			_ = os.Remove(systemPromptPath)
			return nil, fmt.Errorf("pi system prompt close: %w", err)
		}
	}

	cleanupSystemPrompt := func() {
		if systemPromptPath != "" {
			if err := os.Remove(systemPromptPath); err != nil && !os.IsNotExist(err) {
				b.cfg.Logger.Warn("failed to clean up pi system prompt file", "path", systemPromptPath, "err", err)
			}
			systemPromptPath = ""
		}
	}

	runCtx, cancel := runContext(ctx, timeout)

	args := buildPiArgs(sessionPath, systemPromptPath, opts, b.cfg.Logger)
	argv0, cmdArgs := choosePiInvocation(execName, lookedUp, args, b.cfg.Logger)

	cmd := exec.CommandContext(runCtx, argv0, cmdArgs...)
	hideAgentWindow(cmd)
	logAgentCommandRedacted(b.cfg.Logger, argv0, cmdArgs, argvPromptNone)
	cmd.WaitDelay = 10 * time.Second
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	cmd.Env = buildEnv(b.cfg.Env)

	// Supplying prompt via cmd.Stdin with strings.NewReader.
	// Go's os/exec automatically sets up an os.Pipe, streams data in a
	// dedicated goroutine, and closes the pipe (delivering EOF) upon completion.
	// This avoids passing the user prompt in argv, avoids OS ARG_MAX limits,
	// and preserves the FIFO EOF behavior required to prevent #2188 hangs.
	cmd.Stdin = strings.NewReader(prompt)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cleanupSystemPrompt()
		cancel()
		return nil, fmt.Errorf("pi stdout pipe: %w", err)
	}
	cmd.Stderr = newLogWriter(b.cfg.Logger, "[pi:stderr] ")

	if err := cmd.Start(); err != nil {
		cleanupSystemPrompt()
		cancel()
		return nil, wrapStartError("pi", err)
	}

	b.cfg.Logger.Info("pi started", "pid", cmd.Process.Pid, "cwd", opts.Cwd, "model", opts.Model)

	pipe := newMessagePipe()
	msgCh := pipe.C()
	resCh := make(chan Result, 1)

	// Close stdout when the context is cancelled so reader unblocks.
	go func() {
		<-runCtx.Done()
		_ = stdout.Close()
	}()

	go func() {
		defer cleanupSystemPrompt()
		defer cancel()
		defer pipe.Close()
		defer close(resCh)

		startTime := time.Now()
		finalStatus := "completed"
		var fatalError string
		var readErr error
		usage := make(map[string]TokenUsage)

		reader := bufio.NewReader(stdout)
		var textBuffer strings.Builder
		var attemptText strings.Builder
		var committedOutput strings.Builder
		var stashedError string
		activeAssistantInFlight := false
		hasSuccessfulTurn := false
		attemptEmitted := false
		attemptUsageRecorded := false
		var retryCount int

		recordAssistantUsage := func(msg *piMessage) {
			if msg != nil && msg.Usage != nil && !attemptUsageRecorded {
				model := msg.Model
				if model == "" {
					model = opts.Model
				}
				if model == "" {
					model = "unknown"
				}
				u := usage[model]
				u.InputTokens += msg.Usage.Input
				u.OutputTokens += msg.Usage.Output
				u.CacheReadTokens += msg.Usage.CacheRead
				u.CacheWriteTokens += msg.Usage.CacheWrite
				usage[model] = u
				attemptUsageRecorded = true
			}
		}

		for {
			lineBytes, err := reader.ReadBytes('\n')
			if len(lineBytes) > 0 {
				line := strings.TrimSpace(string(lineBytes))
				if line != "" {
					var evt piStreamEvent
					if jsonErr := json.Unmarshal([]byte(line), &evt); jsonErr == nil {
						switch evt.Type {
						case "agent_start":
							pipe.Send(Message{Type: MessageStatus, Status: "running"})

						case "message_start":
							if msg := decodePiMessage(evt.Message); msg != nil && msg.Role == "assistant" {
								activeAssistantInFlight = true
								attemptEmitted = false
								attemptUsageRecorded = false
								textBuffer.Reset()
								attemptText.Reset()
							}

						case "message_update":
							if evt.AssistantMessageEvent != nil {
								switch evt.AssistantMessageEvent.Type {
								case "text_delta":
									if d := drainPiTextBuffer(&textBuffer, evt.AssistantMessageEvent.Delta); d != "" {
										attemptText.WriteString(d)
										// Send non-sensitive status update to preserve semantic inactivity progress
										// without prematurely emitting unverified text tokens.
										pipe.Send(Message{Type: MessageStatus, Status: "in_progress"})
									}
								case "thinking_delta":
									if d := evt.AssistantMessageEvent.Delta; d != "" {
										pipe.Send(Message{Type: MessageThinking, Content: d})
									}
								}
							}

						case "tool_execution_start":
							var params map[string]any
							if len(evt.Args) > 0 {
								_ = json.Unmarshal(evt.Args, &params)
							}
							pipe.Send(Message{
								Type:   MessageToolUse,
								Tool:   evt.ToolName,
								CallID: evt.ToolCallID,
								Input:  params,
							})

						case "tool_execution_end":
							pipe.Send(Message{
								Type:   MessageToolResult,
								CallID: evt.ToolCallID,
								Output: decodePiResult(evt.Result),
							})

						case "turn_end":
							msg := decodePiMessage(evt.Message)
							if msg != nil && msg.Role == "assistant" {
								recordAssistantUsage(msg)
								if errText := piMessageErrorText(msg); errText != "" {
									stashedError = errText
									activeAssistantInFlight = false
									// Discard attempt text on error
									textBuffer.Reset()
									attemptText.Reset()
								}
							}

						case "message_end":
							if msg := decodePiMessage(evt.Message); msg != nil {
								if msg.Role == "assistant" {
									recordAssistantUsage(msg)
								}
								if errText := piMessageErrorText(msg); errText != "" {
									stashedError = errText
									activeAssistantInFlight = false
									// Discard attempt text on error
									textBuffer.Reset()
									attemptText.Reset()
								} else if msg.Role == "assistant" && isPiSuccessfulAssistantStopReason(msg.StopReason) {
									// Assistant message completed with verified success
									if d := flushPiTextBuffer(&textBuffer); d != "" {
										attemptText.WriteString(d)
									}
									textBuffer.Reset()
									if !attemptEmitted {
										commit := attemptText.String()
										committedOutput.WriteString(commit)
										if commit != "" {
											emitChunkedMessageText(pipe, commit)
										}
										attemptEmitted = true
									}
									attemptText.Reset()
									activeAssistantInFlight = false
									stashedError = ""
									hasSuccessfulTurn = true
								} else if msg.Role == "assistant" {
									// StopReason is not in success whitelist (e.g. aborted, length, or unexpected)
									stashedError = fmt.Sprintf("pi assistant stopped without success (stopReason: %s)", msg.StopReason)
									activeAssistantInFlight = false
									textBuffer.Reset()
									attemptText.Reset()
								}
							}

						case "auto_retry_start":
							retryCount++
							pipe.Send(Message{Type: MessageStatus, Status: "retrying"})
							b.cfg.Logger.Info("pi auto retry start",
								"pid", cmd.Process.Pid,
								"backend_session_id", sessionPath,
								"attempt", evt.Attempt,
								"max_attempts", evt.MaxAttempts,
								"delay_ms", evt.DelayMs,
							)
							// Reset attempt text buffer for the next attempt
							activeAssistantInFlight = false
							attemptEmitted = false
							attemptUsageRecorded = false
							textBuffer.Reset()
							attemptText.Reset()

						case "auto_retry_end":
							b.cfg.Logger.Info("pi auto retry end",
								"pid", cmd.Process.Pid,
								"backend_session_id", sessionPath,
								"success", evt.Success,
							)
							if !evt.Success {
								if evt.FinalError != "" {
									stashedError = evt.FinalError
								} else if stashedError == "" {
									stashedError = "pi exhausted automatic retries"
								}
							}

						case "error":
							errText := decodePiString(evt.Message)
							fatalError = errText
							activeAssistantInFlight = false
							textBuffer.Reset()
							attemptText.Reset()
						}
					}
				}
			}
			if err != nil {
				if err != io.EOF && runCtx.Err() == nil {
					readErr = err
					if cmd.Process != nil {
						_ = cmd.Process.Kill()
					}
				}
				break
			}
		}

		// Ensure attempt text buffers are cleaned up
		textBuffer.Reset()
		attemptText.Reset()

		waitErr := cmd.Wait()
		duration := time.Since(startTime)

		if runCtx.Err() == context.DeadlineExceeded {
			finalStatus = "timeout"
			fatalError = fmt.Sprintf("pi timed out after %s", timeout)
		} else if runCtx.Err() == context.Canceled {
			finalStatus = "aborted"
			fatalError = "execution cancelled"
		} else if readErr != nil {
			finalStatus = "failed"
			fatalError = fmt.Sprintf("pi stdout read error: %v", readErr)
			pipe.Send(Message{Type: MessageError, Content: fatalError})
		} else if fatalError != "" {
			finalStatus = "failed"
			pipe.Send(Message{Type: MessageError, Content: fatalError})
		} else if waitErr != nil {
			finalStatus = "failed"
			fatalError = fmt.Sprintf("pi exited with error: %v", waitErr)
			pipe.Send(Message{Type: MessageError, Content: fatalError})
		} else if stashedError != "" || !hasSuccessfulTurn || activeAssistantInFlight {
			finalStatus = "failed"
			if stashedError != "" {
				fatalError = stashedError
			} else if activeAssistantInFlight {
				fatalError = "pi stream ended while assistant turn was still in flight"
			} else {
				fatalError = "pi stream ended without successful turn completion"
			}
			pipe.Send(Message{Type: MessageError, Content: fatalError})
		}

		b.cfg.Logger.Info("pi finished", "pid", cmd.Process.Pid, "backend_session_id", sessionPath, "status", finalStatus, "retries", retryCount, "duration", duration.Round(time.Millisecond).String())

		cleanupSystemPrompt()

		resCh <- Result{
			Status:     finalStatus,
			Output:     committedOutput.String(),
			Error:      fatalError,
			DurationMs: duration.Milliseconds(),
			SessionID:  sessionPath,
			Usage:      usage,
		}
	}()

	return &Session{Messages: msgCh, Result: resCh}, nil
}

// ── Pi event types ──

// piStreamEvent is the union of fields we consume from Pi's JSON event
// stream. Fields that can be either string or object across event types
// (e.g. `message`, `result`) are held as json.RawMessage and decoded on
// demand by the switch arms.
type piStreamEvent struct {
	Type string `json:"type"`

	// message_update
	AssistantMessageEvent *piAssistantMessageEvent `json:"assistantMessageEvent,omitempty"`

	// tool_execution_start / tool_execution_end
	ToolCallID string          `json:"toolCallId,omitempty"`
	ToolName   string          `json:"toolName,omitempty"`
	Args       json.RawMessage `json:"args,omitempty"`
	Result     json.RawMessage `json:"result,omitempty"`
	IsError    bool            `json:"isError,omitempty"`

	// error: Message is a string. turn_end: Message is an object.
	Message json.RawMessage `json:"message,omitempty"`

	// auto_retry_start
	Attempt      int    `json:"attempt,omitempty"`
	MaxAttempts  int    `json:"maxAttempts,omitempty"`
	DelayMs      int    `json:"delayMs,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`

	// auto_retry_end
	Success    bool   `json:"success,omitempty"`
	FinalError string `json:"finalError,omitempty"`
}

type piAssistantMessageEvent struct {
	Type  string `json:"type"`
	Delta string `json:"delta,omitempty"`
}

type piMessage struct {
	Role  string   `json:"role,omitempty"`
	Model string   `json:"model,omitempty"`
	Usage *piUsage `json:"usage,omitempty"`
	// StopReason is set on assistant `message_end` / `turn_end` events.
	// When the upstream Pi run hits a provider/API error mid-turn the
	// CLI emits the failure through this field (typical pattern:
	// `stopReason: "error"` + a populated `errorMessage`) and then
	// still emits `agent_end` with exit code 0. The Pi SDK therefore
	// cannot rely on the exit code alone — see ErrorMessage below.
	StopReason string `json:"stopReason,omitempty"`
	// ErrorMessage is the upstream provider's error payload, surfaced
	// through `message_end` / `turn_end`. Non-empty means the run did
	// not produce an assistant response and the backend must report
	// Status=failed.
	ErrorMessage string `json:"errorMessage,omitempty"`
}

type piUsage struct {
	Input       int64 `json:"input"`
	Output      int64 `json:"output"`
	CacheRead   int64 `json:"cacheRead"`
	CacheWrite  int64 `json:"cacheWrite"`
	TotalTokens int64 `json:"totalTokens"`
}

func decodePiMessage(raw json.RawMessage) *piMessage {
	if len(raw) == 0 {
		return nil
	}
	var m piMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return &m
}

// isPiSuccessfulAssistantStopReason returns true only when the stopReason
// explicitly indicates a normal successful turn completion.
func isPiSuccessfulAssistantStopReason(stopReason string) bool {
	switch strings.ToLower(strings.TrimSpace(stopReason)) {
	case "stop", "tooluse", "tool_use", "end", "end_turn":
		return true
	default:
		return false
	}
}

// piMessageErrorText returns the human-readable error text carried on a
// Pi assistant message when the upstream provider failed mid-turn. It
// triggers on a populated `errorMessage`, `stopReason == "error"`, or
// any non-successful terminal reason (such as aborted or length).
func piMessageErrorText(m *piMessage) string {
	if m == nil {
		return ""
	}
	if msg := strings.TrimSpace(m.ErrorMessage); msg != "" {
		return msg
	}
	sr := strings.ToLower(strings.TrimSpace(m.StopReason))
	switch sr {
	case "error":
		return "pi reported stopReason=error with no errorMessage payload"
	case "aborted":
		return "pi reported stopReason=aborted"
	case "length":
		return "pi reported stopReason=length (output token limit exceeded)"
	case "":
		return ""
	default:
		if isPiSuccessfulAssistantStopReason(sr) {
			return ""
		}
		return fmt.Sprintf("pi reported unexpected stopReason: %s", m.StopReason)
	}
}

func decodePiString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return strings.Trim(string(raw), `"`)
}

func decodePiResult(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return string(raw)
}

// ── Arg builder ──

// piBlockedArgs are flags hardcoded by the daemon that must not be
// overridden by user-configured custom_args. Overriding these would
// break the daemon↔Pi communication protocol.
var piBlockedArgs = map[string]blockedArgMode{
	"-p":        blockedStandalone, // non-interactive mode
	"--print":   blockedStandalone, // alias for -p
	"--mode":    blockedWithValue,  // "json" event stream protocol
	"--session": blockedWithValue,  // daemon manages the session path
}

// buildPiArgs assembles the argv for a one-shot Pi invocation.
//
// Flags:
//
//	-p                          non-interactive mode (prompt read from stdin)
//	--mode json                 emit one JSON event per line on stdout
//	--session <path>            session log file (created upfront, reused on resume)
//	--provider <name>           provider, when Model is "provider/id"
//	--model <id>                model identifier
//	--append-system-prompt <p>  extra system instructions (file path)
//
// Custom args appended. The prompt is supplied via stdin, not argv.
func buildPiArgs(sessionPath, systemPromptPath string, opts ExecOptions, logger *slog.Logger) []string {
	args := []string{
		"-p",
		"--mode", "json",
	}
	if sessionPath != "" {
		args = append(args, "--session", sessionPath)
	}
	if opts.Model != "" {
		provider, model := splitPiModel(opts.Model)
		if provider != "" {
			args = append(args, "--provider", provider)
		}
		if model != "" {
			args = append(args, "--model", model)
		}
	}
	// Note: we intentionally do NOT pass --tools here. Omitting it lets
	// Pi use its full tool registry, including user-installed extension
	// tools. Passing --tools acts as a restrictive allowlist that
	// silently filters out extension-registered tools (#2379).
	// Users who want to restrict tools can do so via custom_args.
	if systemPromptPath != "" {
		args = append(args, "--append-system-prompt", systemPromptPath)
	}
	args = append(args, filterCustomArgs(opts.CustomArgs, piBlockedArgs, logger)...)
	return args
}

// splitPiModel parses a "provider/model" string into its parts. Plain
// "model" strings pass through as (provider="", model="model").
func splitPiModel(s string) (provider, model string) {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "/"); i >= 0 {
		return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+1:])
	}
	return "", s
}

// ── Session path ──

// piSessionDir returns the directory where Pi session JSONL files live.
// Exported via a helper so the usage scanner (package usage) can point at
// the same location without duplicating the path construction.
func piSessionDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".multica", "pi-sessions"), nil
}

func newPiSessionPath() (string, error) {
	dir, err := piSessionDir()
	if err != nil {
		return "", err
	}
	name := fmt.Sprintf("%s.jsonl", time.Now().UTC().Format("20060102T150405.000000000"))
	return filepath.Join(dir, name), nil
}

// ensurePiSessionFile creates an empty session file if one does not yet
// exist at path. Pi refuses to start when --session points at a missing
// file; paths that already exist (a resumed session) are left untouched.
func ensurePiSessionFile(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	return f.Close()
}

// PiSessionDir exposes piSessionDir to other packages in this module.
func PiSessionDir() (string, error) {
	return piSessionDir()
}
