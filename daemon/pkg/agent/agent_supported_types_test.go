package agent

import (
	"log/slog"
	"testing"
)

// TestSupportedTypesLockstepWithNew guards the iron-rule whitelist: every type
// in SupportedTypes must be constructable by New, and New must reject anything
// not in SupportedTypes. This is the single source of truth the custom runtime
// profile protocol_family validation (handler) and the runtime_profile
// protocol_family CHECK (migration 120) are aligned to. If a backend is added
// to New, it must be added here too — and to the migration CHECK.
func TestSupportedTypesLockstepWithNew(t *testing.T) {
	cfg := Config{Logger: slog.Default()}

	for _, typ := range SupportedTypes {
		if !IsSupportedType(typ) {
			t.Errorf("IsSupportedType(%q) = false, but it is in SupportedTypes", typ)
		}
		if _, err := New(typ, cfg); err != nil {
			t.Errorf("New(%q) returned error for a SupportedTypes entry: %v", typ, err)
		}
	}

	// A type outside the whitelist must be rejected by both.
	const bogus = "definitely-not-a-real-backend"
	if IsSupportedType(bogus) {
		t.Errorf("IsSupportedType(%q) = true, want false", bogus)
	}
	if _, err := New(bogus, cfg); err == nil {
		t.Errorf("New(%q) succeeded, want error for an unsupported type", bogus)
	}
}

// TestSupportedTypesMatchesMeowthWhitelist pins the exact set so any drift from
// the meowth V1 whitelist (see docs/architecture/01 §4) fails loudly. Adding or
// removing a backend in agent.go without updating this test will turn the gate
// red on the next `go test ./pkg/agent/...` run.
func TestSupportedTypesMatchesMeowthWhitelist(t *testing.T) {
	want := map[string]bool{
		"claude":  true,
		"codex":   true,
		"copilot": true,
		"hermes":  true,
		"pi":      true,
	}
	if len(SupportedTypes) != len(want) {
		t.Fatalf("SupportedTypes has %d entries, meowth whitelist has %d; keep them in lockstep", len(SupportedTypes), len(want))
	}
	for _, typ := range SupportedTypes {
		if !want[typ] {
			t.Errorf("SupportedTypes contains %q which is not in the meowth V1 whitelist", typ)
		}
	}
}

// TestNewFactoryWhitelist asserts that New() accepts exactly the 5 whitelisted
// backends and rejects every previously-trimmed provider. Regression guard
// against accidentally re-introducing a removed backend during a future pump.
func TestNewFactoryWhitelist(t *testing.T) {
	cfg := Config{Logger: slog.Default()}

	allowed := []string{"claude", "codex", "copilot", "hermes", "pi"}
	for _, typ := range allowed {
		if _, err := New(typ, cfg); err != nil {
			t.Errorf("New(%q) returned error for an allowed backend: %v", typ, err)
		}
	}

	trimmed := []string{
		"antigravity", "codebuddy", "cursor", "gemini",
		"kimi", "kiro", "openclaw", "opencode",
	}
	for _, typ := range trimmed {
		if _, err := New(typ, cfg); err == nil {
			t.Errorf("New(%q) succeeded; trimmed backend must be rejected by the factory", typ)
		}
	}
}
