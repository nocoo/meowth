package agent

import (
	"log/slog"
	"testing"
)

// ── Shared injection fixture (Trump's MUL-2339 constraint) ───────────
//
// The three Codex injection points (thread/start.config,
// thread/resume.config, turn/start.effort) must encode the same
// thinking_level value, in the same shape per call type, with no
// drift. This fixture defines the expected payload once and asserts
// it across all three sites so a future refactor of any one site
// breaks the test if the other two aren't kept in sync.

// codexReasoningInjection is the shared expectation table for the
// three Codex injection points. value→{turnStartEffort, configKey}.
// One row per scenario.
type codexReasoningCase struct {
	name  string
	level string
}

var codexReasoningCases = []codexReasoningCase{
	{"empty-level-is-noop", ""},
	{"low", "low"},
	{"medium", "medium"},
	{"high", "high"},
	{"xhigh", "xhigh"},
	{"none-codex-only", "none"},
}

func TestApplyCodexReasoningEffort_ThreePoints(t *testing.T) {
	t.Parallel()
	for _, tc := range codexReasoningCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			// 1. thread/start params shape.
			startParams := map[string]any{
				"model": "gpt-5.5",
				"cwd":   "/work",
			}
			applyCodexReasoningEffort(startParams, tc.level)
			assertCodexThreadConfigEffort(t, "thread/start", startParams, tc.level)

			// 2. thread/resume params shape.
			resumeParams := map[string]any{
				"threadId": "thr_prior",
				"cwd":      "/work",
				"model":    "gpt-5.5",
			}
			applyCodexReasoningEffort(resumeParams, tc.level)
			assertCodexThreadConfigEffort(t, "thread/resume", resumeParams, tc.level)

			// 3. turn/start params shape.
			turnParams := map[string]any{
				"threadId": "thr_x",
				"input":    []map[string]any{{"type": "text", "text": "hi"}},
			}
			applyCodexReasoningEffort(turnParams, tc.level)
			assertCodexTurnEffort(t, "turn/start", turnParams, tc.level)
		})
	}
}

// assertCodexThreadConfigEffort verifies the nested
// `config.model_reasoning_effort` shape used by thread/start and
// thread/resume. Empty level means the helper must be a no-op
// (no key emitted), not an empty-string value.
func assertCodexThreadConfigEffort(t *testing.T, method string, params map[string]any, want string) {
	t.Helper()
	cfgAny, hasCfg := params["config"]
	if want == "" {
		// Empty level → helper must not touch `config`. We allow the
		// caller to have pre-populated config with other keys, but the
		// reasoning effort key must NOT appear.
		if !hasCfg {
			return
		}
		cfg, _ := cfgAny.(map[string]any)
		if _, has := cfg["model_reasoning_effort"]; has {
			t.Errorf("%s: empty level must not emit model_reasoning_effort, got %v", method, cfg["model_reasoning_effort"])
		}
		return
	}
	if !hasCfg {
		t.Fatalf("%s: expected config block when level=%q", method, want)
	}
	cfg, ok := cfgAny.(map[string]any)
	if !ok {
		t.Fatalf("%s: config has wrong type %T", method, cfgAny)
	}
	got, ok := cfg["model_reasoning_effort"]
	if !ok {
		t.Fatalf("%s: missing config.model_reasoning_effort for level=%q (params=%+v)", method, want, params)
	}
	if got != want {
		t.Errorf("%s: config.model_reasoning_effort = %v, want %q", method, got, want)
	}
	// `effort` (turn/start key) must NOT leak into a thread call.
	if _, leaked := params["effort"]; leaked {
		t.Errorf("%s: top-level effort key leaked into thread params: %+v", method, params)
	}
}

// assertCodexTurnEffort verifies the top-level `effort` shape used by
// turn/start. Empty level means the helper must be a no-op (no key
// emitted), not an empty-string value.
func assertCodexTurnEffort(t *testing.T, method string, params map[string]any, want string) {
	t.Helper()
	got, has := params["effort"]
	if want == "" {
		if has {
			t.Errorf("%s: empty level must not emit effort, got %v", method, got)
		}
		// Nested config must also stay empty for the turn/start shape.
		if cfg, hasCfg := params["config"]; hasCfg {
			t.Errorf("%s: turn-shape params must not gain a config block, got %v", method, cfg)
		}
		return
	}
	if !has {
		t.Fatalf("%s: missing top-level effort for level=%q (params=%+v)", method, want, params)
	}
	if got != want {
		t.Errorf("%s: effort = %v, want %q", method, got, want)
	}
	// `config.model_reasoning_effort` must NOT leak into a turn call.
	if cfg, hasCfg := params["config"]; hasCfg {
		cfgMap, _ := cfg.(map[string]any)
		if _, leaked := cfgMap["model_reasoning_effort"]; leaked {
			t.Errorf("%s: config.model_reasoning_effort leaked into turn params: %+v", method, params)
		}
	}
}

func TestApplyCodexReasoningEffort_NilParamsSafe(t *testing.T) {
	t.Parallel()
	// Must not panic — defensive against future call sites passing nil.
	applyCodexReasoningEffort(nil, "high")
}

func TestApplyCodexReasoningEffort_PreservesPreExistingConfig(t *testing.T) {
	t.Parallel()
	// thread/start may already have other config keys (e.g. future Codex
	// fields). Reasoning effort must be additive, not destructive.
	startParams := map[string]any{
		"model": "gpt-5.5",
		"config": map[string]any{
			"some_future_key": "preserve_me",
		},
	}
	applyCodexReasoningEffort(startParams, "high")
	cfg, _ := startParams["config"].(map[string]any)
	if cfg["some_future_key"] != "preserve_me" {
		t.Errorf("pre-existing config key was clobbered: %+v", cfg)
	}
	if cfg["model_reasoning_effort"] != "high" {
		t.Errorf("reasoning effort not injected: %+v", cfg)
	}
}

// ── End-to-end: build*Args + thinking_level wiring ───────────────────

func TestBuildClaudeArgs_InjectsEffort(t *testing.T) {
	t.Parallel()
	args := buildClaudeArgs(ExecOptions{Model: "claude-opus-4-7", ThinkingLevel: "xhigh"}, slog.Default())
	if !containsAdjacent(args, "--effort", "xhigh") {
		t.Errorf("expected --effort xhigh in args: %v", args)
	}
	// Must appear after --model (cosmetic but enforced for log readability).
	modelIdx := argIndexOf(args, "--model")
	effortIdx := argIndexOf(args, "--effort")
	if modelIdx < 0 || effortIdx < 0 || modelIdx > effortIdx {
		t.Errorf("expected --model before --effort: %v", args)
	}
}

func TestBuildClaudeArgs_OmitsEffortWhenEmpty(t *testing.T) {
	t.Parallel()
	args := buildClaudeArgs(ExecOptions{Model: "claude-sonnet-4-6"}, slog.Default())
	if argIndexOf(args, "--effort") >= 0 {
		t.Errorf("expected no --effort when level empty: %v", args)
	}
}

func TestBuildClaudeArgs_BlocksUserEffortOverride(t *testing.T) {
	t.Parallel()
	args := buildClaudeArgs(ExecOptions{
		Model:         "claude-opus-4-7",
		ThinkingLevel: "high",
		CustomArgs:    []string{"--effort", "max", "--keep-me"},
	}, slog.Default())
	// Daemon-injected --effort survives.
	if !containsAdjacent(args, "--effort", "high") {
		t.Errorf("daemon-injected --effort high should remain: %v", args)
	}
	// User attempt to override is filtered out: no second --effort,
	// no `max` token.
	count := 0
	for _, a := range args {
		if a == "--effort" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("expected exactly one --effort, got %d: %v", count, args)
	}
	if argIndexOf(args, "max") >= 0 {
		t.Errorf("filtered user --effort value still appears: %v", args)
	}
	// Other custom args pass through.
	if argIndexOf(args, "--keep-me") < 0 {
		t.Errorf("non-blocked custom arg was dropped: %v", args)
	}
}

// ── Helpers ──────────────────────────────────────────────────────────

func containsAdjacent(haystack []string, a, b string) bool {
	for i := 0; i < len(haystack)-1; i++ {
		if haystack[i] == a && haystack[i+1] == b {
			return true
		}
	}
	return false
}

func argIndexOf(slice []string, target string) int {
	for i, v := range slice {
		if v == target {
			return i
		}
	}
	return -1
}
