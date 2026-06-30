// Package testbackend provides a deterministic agent.Backend
// implementation that replays prerecorded fixtures. It is the
// shared test surface used by L1 and L2 (docs/architecture/08
// §3.3.1).
//
// SECURITY: the factory that returns Fake instances is gated by
// MEOWTH_TEST=1 + MEOWTH_BACKEND_FACTORY=fake. The production
// path NEVER reaches testbackend; that contract is enforced in
// internal/agentfactory.
package testbackend

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nocoo/meowth/daemon/pkg/agent"
)

//go:embed fixtures/*.jsonl
var fixturesFS embed.FS

// FixtureScenario names a prerecorded run under fixtures/.
type FixtureScenario string

const (
	ScenarioHappy     FixtureScenario = "happy"
	ScenarioError     FixtureScenario = "error"
	ScenarioCancelled FixtureScenario = "cancelled"
	ScenarioIdle      FixtureScenario = "idle"
)

// DefaultScenarioByBackend is the per-type fixed mapping reviewer
// approved at plan stage. The L2 matrix exercises each scenario
// via the backend type that maps to it. ScenarioFor is the
// behavioural accessor; this map is just the static table.
var DefaultScenarioByBackend = map[string]FixtureScenario{
	"claude":  ScenarioHappy,
	"copilot": ScenarioError,
	"codex":   ScenarioCancelled,
	"hermes":  ScenarioIdle,
	"pi":      ScenarioHappy,
}

// ScenarioFor returns the per-type default scenario the fake
// factory uses when constructing backends. Currently:
//
//	claude  → happy
//	copilot → error
//	codex   → cancelled
//	hermes  → idle
//	pi      → happy
//
// This keeps L2 cases covering all four scenarios over the five
// backend types without injecting wire-level test parameters.
func ScenarioFor(backendType string) FixtureScenario {
	switch backendType {
	case "claude", "pi":
		return ScenarioHappy
	case "copilot":
		return ScenarioError
	case "codex":
		return ScenarioCancelled
	case "hermes":
		return ScenarioIdle
	}
	return ScenarioHappy
}

// Fake is the agent.Backend implementation. Each Execute spawns a
// goroutine that emits the fixture's messages and finally a
// Result; the goroutine honours ctx cancellation by short-
// circuiting to a "cancelled" result.
type Fake struct {
	Scenario FixtureScenario
	// MessageDelay is the wall-clock delay between successive
	// message emits. Tests can set zero for instant replay; the
	// daemon's L2 harness uses a small positive value to exercise
	// heartbeat / cancel races.
	MessageDelay time.Duration
}

// New constructs a Fake. Returns an error if the scenario is not
// embedded.
func New(scenario FixtureScenario) (*Fake, error) {
	if _, err := loadFixture(scenario); err != nil {
		return nil, err
	}
	return &Fake{Scenario: scenario}, nil
}

// fixtureEntry is one row of a *.jsonl fixture.
type fixtureEntry struct {
	// Exactly one of Message / Result is non-nil per row.
	Message *fixtureMessage `json:"message,omitempty"`
	Result  *fixtureResult  `json:"result,omitempty"`
	// PauseMS — emit this delay before the next entry. Optional.
	PauseMS int64 `json:"pause_ms,omitempty"`
}

type fixtureMessage struct {
	Type      string         `json:"type"`
	Content   string         `json:"content,omitempty"`
	Tool      string         `json:"tool,omitempty"`
	CallID    string         `json:"call_id,omitempty"`
	Input     map[string]any `json:"input,omitempty"`
	Output    string         `json:"output,omitempty"`
	Status    string         `json:"status,omitempty"`
	Level     string         `json:"level,omitempty"`
	SessionID string         `json:"session_id,omitempty"`
}

type fixtureResult struct {
	Status     string                       `json:"status"`
	Output     string                       `json:"output,omitempty"`
	Error      string                       `json:"error,omitempty"`
	DurationMS int64                        `json:"duration_ms,omitempty"`
	SessionID  string                       `json:"session_id,omitempty"`
	Usage      map[string]fixtureTokenUsage `json:"usage,omitempty"`
}

type fixtureTokenUsage struct {
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	CacheReadTokens  int64 `json:"cache_read_tokens,omitempty"`
	CacheWriteTokens int64 `json:"cache_write_tokens,omitempty"`
}

// promptMarkerXSSPayload is the test-only prompt prefix that asks
// the fake backend to emit an additional text message whose
// Content is the marker's suffix. Used by the L3 XSS spec
// (docs/architecture/07 §11 L3 (b)) to drive untrusted message
// content through the real exec → SQLite → /messages render path
// without standing up a fake claude binary.
//
// Format: `MEOWTH_E2E_XSS_PAYLOAD:<payload>`. The marker is a
// no-op on the production backend factory (which never reaches
// this code) and on every prompt that does not start with the
// prefix. The happy fixture's existing messages are still emitted;
// the payload message is prepended once.
//
// Package-private on purpose: callers outside this package have no
// business depending on the wire shape of a test-only hook.
const promptMarkerXSSPayload = "MEOWTH_E2E_XSS_PAYLOAD:"

// extractXSSPayload returns the suffix after promptMarkerXSSPayload
// when prompt starts with that marker, plus a true ok. Otherwise
// returns ("", false) and the caller continues with the unchanged
// fixture behaviour.
func extractXSSPayload(prompt string) (string, bool) {
	if !strings.HasPrefix(prompt, promptMarkerXSSPayload) {
		return "", false
	}
	return prompt[len(promptMarkerXSSPayload):], true
}

// Execute satisfies agent.Backend. The returned *agent.Session has
// buffered Messages + Result channels; the producer goroutine
// closes both when done.
func (f *Fake) Execute(ctx context.Context, prompt string, opts agent.ExecOptions) (*agent.Session, error) {
	if recorderEnabled() {
		if err := recordExec(prompt, opts.ResumeSessionID); err != nil {
			return nil, fmt.Errorf("testbackend recorder: %w", err)
		}
	}
	entries, err := loadFixture(f.Scenario)
	if err != nil {
		return nil, err
	}
	msgs := make(chan agent.Message, 32)
	results := make(chan agent.Result, 1)
	delay := f.MessageDelay
	xssPayload, hasXSS := extractXSSPayload(prompt)

	go func() {
		defer close(msgs)
		defer close(results)
		final := agent.Result{Status: "completed"}
		if hasXSS {
			// Emit the untrusted payload as a text message before
			// the fixture's normal messages so the L3 spec sees
			// it via /messages snapshot. The dashboard's
			// MessageText component is the system under test.
			select {
			case <-ctx.Done():
				results <- agent.Result{Status: "cancelled", Error: ctx.Err().Error()}
				return
			case msgs <- agent.Message{Type: agent.MessageType("text"), Content: xssPayload}:
			}
		}
		for _, e := range entries {
			if e.PauseMS > 0 {
				if !sleepUntilDone(ctx, time.Duration(e.PauseMS)*time.Millisecond) {
					results <- agent.Result{Status: "cancelled", Error: ctx.Err().Error()}
					return
				}
			}
			if e.Message != nil {
				msg := agent.Message{
					Type:      agent.MessageType(e.Message.Type),
					Content:   e.Message.Content,
					Tool:      e.Message.Tool,
					CallID:    e.Message.CallID,
					Input:     e.Message.Input,
					Output:    e.Message.Output,
					Status:    e.Message.Status,
					Level:     e.Message.Level,
					SessionID: e.Message.SessionID,
				}
				select {
				case <-ctx.Done():
					results <- agent.Result{Status: "cancelled", Error: ctx.Err().Error()}
					return
				case msgs <- msg:
				}
				if delay > 0 {
					if !sleepUntilDone(ctx, delay) {
						results <- agent.Result{Status: "cancelled", Error: ctx.Err().Error()}
						return
					}
				}
			}
			if e.Result != nil {
				final = agent.Result{
					Status:     e.Result.Status,
					Output:     e.Result.Output,
					Error:      e.Result.Error,
					DurationMs: e.Result.DurationMS,
					SessionID:  e.Result.SessionID,
					Usage:      convertUsage(e.Result.Usage),
				}
				results <- final
				return
			}
		}
		results <- final
	}()

	return &agent.Session{Messages: msgs, Result: results}, nil
}

func convertUsage(in map[string]fixtureTokenUsage) map[string]agent.TokenUsage {
	if in == nil {
		return nil
	}
	out := make(map[string]agent.TokenUsage, len(in))
	for k, v := range in {
		out[k] = agent.TokenUsage{
			InputTokens:      v.InputTokens,
			OutputTokens:     v.OutputTokens,
			CacheReadTokens:  v.CacheReadTokens,
			CacheWriteTokens: v.CacheWriteTokens,
		}
	}
	return out
}

// sleepUntilDone parks the goroutine for d. Returns false if ctx
// fires while parked.
func sleepUntilDone(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// loadFixture decodes the JSONL fixture for the named scenario.
func loadFixture(scenario FixtureScenario) ([]fixtureEntry, error) {
	if scenario == "" {
		return nil, errors.New("testbackend: scenario required")
	}
	name := "fixtures/" + string(scenario) + ".jsonl"
	body, err := fixturesFS.ReadFile(name)
	if err != nil {
		return nil, fmt.Errorf("testbackend: load %s: %w", scenario, err)
	}
	var out []fixtureEntry
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 0, 1<<14), 1<<20)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 || line[0] == '#' {
			continue
		}
		var entry fixtureEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			return nil, fmt.Errorf("testbackend: scenario %s line %d: %w", scenario, len(out)+1, err)
		}
		if entry.Message == nil && entry.Result == nil && entry.PauseMS == 0 {
			return nil, fmt.Errorf("testbackend: scenario %s line %d: empty entry", scenario, len(out)+1)
		}
		out = append(out, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("testbackend: scan %s: %w", scenario, err)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("testbackend: scenario %s is empty", scenario)
	}
	// Ensure exactly one terminal result entry as the last item.
	last := out[len(out)-1]
	if last.Result == nil {
		return nil, fmt.Errorf("testbackend: scenario %s last entry must be a result", scenario)
	}
	return out, nil
}

// SupportedTypes — alias for the agent package's whitelist so
// callers can range over it without importing pkg/agent twice.
func SupportedTypes() []string {
	out := make([]string, len(agent.SupportedTypes))
	copy(out, agent.SupportedTypes)
	return out
}

// ListEmbeddedScenarios returns the scenario names baked into the
// binary. Tests use it to assert the fixture set hasn't drifted.
func ListEmbeddedScenarios() ([]FixtureScenario, error) {
	entries, err := fixturesFS.ReadDir("fixtures")
	if err != nil {
		return nil, fmt.Errorf("testbackend: list fixtures: %w", err)
	}
	out := make([]FixtureScenario, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		out = append(out, FixtureScenario(strings.TrimSuffix(name, ".jsonl")))
	}
	return out, nil
}
