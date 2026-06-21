package agentfactory

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"testing"

	"github.com/nocoo/meowth/daemon/pkg/agent"
)

func TestProductionFactoryReturnsUnavailableWithEmptyPATH(t *testing.T) {
	// With a deliberately-empty PATH every supported type's
	// LookPath fails → ErrBackendUnavailable. This replaces the
	// pre-3.12 "always returns ErrBackendUnavailable regardless
	// of PATH" stub behaviour.
	t.Setenv("PATH", t.TempDir())
	f := NewProduction()
	if f.Mode() != "production" {
		t.Fatalf("mode = %q", f.Mode())
	}
	for _, typ := range f.SupportedTypes() {
		_, err := f.New(typ)
		if !errors.Is(err, ErrBackendUnavailable) {
			t.Fatalf("New(%q) err = %v, want ErrBackendUnavailable", typ, err)
		}
	}
}

func TestProductionFactoryRejectsUnknownType(t *testing.T) {
	f := NewProduction()
	_, err := f.New("godot")
	if !errors.Is(err, ErrUnknownBackend) {
		t.Fatalf("err = %v, want ErrUnknownBackend", err)
	}
}

func TestProductionFactoryAgentsListsAllSupportedTypes(t *testing.T) {
	f := NewProduction()
	got := f.Agents()
	if len(got) != len(agent.SupportedTypes) {
		t.Fatalf("len = %d, want %d", len(got), len(agent.SupportedTypes))
	}
	for i, t2 := range got {
		if t2.Type != agent.SupportedTypes[i] {
			t.Fatalf("order broken at %d: %q vs %q", i, t2.Type, agent.SupportedTypes[i])
		}
	}
}

func TestFakeFactoryAgentsReportsInstalledForAllTypes(t *testing.T) {
	f := NewFake()
	if f.Mode() != "fake" {
		t.Fatalf("mode = %q", f.Mode())
	}
	for _, info := range f.Agents() {
		if !info.Installed {
			t.Fatalf("fake info for %q not installed", info.Type)
		}
		if info.Executable != "<fake>" {
			t.Fatalf("fake info for %q executable = %q", info.Type, info.Executable)
		}
		if info.Version != "0.0.0-fake" {
			t.Fatalf("fake info for %q version = %q", info.Type, info.Version)
		}
	}
}

func TestFakeFactoryNewRejectsUnknownType(t *testing.T) {
	f := NewFake()
	_, err := f.New("godot")
	if !errors.Is(err, ErrUnknownBackend) {
		t.Fatalf("err = %v, want ErrUnknownBackend", err)
	}
}

func TestFakeFactoryDispatchByType(t *testing.T) {
	f := NewFake()
	for _, typ := range agent.SupportedTypes {
		b, err := f.New(typ)
		if err != nil {
			t.Fatalf("New(%q): %v", typ, err)
		}
		if b == nil {
			t.Fatalf("New(%q) returned nil", typ)
		}
	}
}

func TestFromEnvSelectsProductionByDefault(t *testing.T) {
	t.Setenv("MEOWTH_BACKEND_FACTORY", "")
	t.Setenv("MEOWTH_TEST", "")
	f, err := FromEnv(nil)
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	if f.Mode() != "production" {
		t.Fatalf("mode = %q", f.Mode())
	}
}

func TestFromEnvRejectsFakeWithoutTestMode(t *testing.T) {
	t.Setenv("MEOWTH_BACKEND_FACTORY", "fake")
	t.Setenv("MEOWTH_TEST", "")
	if _, err := FromEnv(nil); err == nil {
		t.Fatal("FromEnv accepted fake without MEOWTH_TEST=1")
	}
}

func TestFromEnvAcceptsFakeWhenTestModeSet(t *testing.T) {
	t.Setenv("MEOWTH_BACKEND_FACTORY", "fake")
	t.Setenv("MEOWTH_TEST", "1")
	f, err := FromEnv(nil)
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	if f.Mode() != "fake" {
		t.Fatalf("mode = %q", f.Mode())
	}
}

func TestFromEnvRejectsUnknownValue(t *testing.T) {
	t.Setenv("MEOWTH_BACKEND_FACTORY", "claude-only")
	if _, err := FromEnv(nil); err == nil {
		t.Fatal("FromEnv accepted unknown value")
	}
}

func TestFromEnvProductionAlias(t *testing.T) {
	t.Setenv("MEOWTH_BACKEND_FACTORY", "production")
	t.Setenv("MEOWTH_TEST", "")
	f, err := FromEnv(nil)
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	if f.Mode() != "production" {
		t.Fatalf("mode = %q", f.Mode())
	}
}

// TestProductionAgentsPopulatesVersionWhenProbeSucceeds confirms
// /v1/agents will surface the CLI version when an installed
// backend's --version returns successfully.
func TestProductionAgentsPopulatesVersionWhenProbeSucceeds(t *testing.T) {
	// Make `sh` resolvable as one of the supported types by
	// putting a shim in a temp PATH dir. Picking the first
	// supported type guarantees the probe runs even on a CI
	// runner without claude/copilot/etc installed.
	target := agent.SupportedTypes[0]
	dir := t.TempDir()
	shim := dir + "/" + target
	if err := writeFakeBinary(t, shim, "echo shim-version-1.2.3"); err != nil {
		t.Fatalf("write shim: %v", err)
	}
	t.Setenv("PATH", dir+":"+t.TempDir()) // narrow PATH so only the shim resolves
	if _, err := exec.LookPath(target); err != nil {
		t.Skipf("PATH not honoured under test runner: %v", err)
	}
	f := NewProduction()
	f.VersionProbe = func(_ context.Context, p string) (string, error) {
		if p != shim {
			t.Fatalf("probe given %q, want %q", p, shim)
		}
		return "shim-version-1.2.3", nil
	}
	agents := f.Agents()
	var info AgentInfo
	for _, a := range agents {
		if a.Type == target {
			info = a
		}
	}
	if !info.Installed {
		t.Fatalf("%s: installed=false despite shim on PATH", target)
	}
	if info.Version != "shim-version-1.2.3" {
		t.Fatalf("%s: version = %q, want shim-version-1.2.3", target, info.Version)
	}
}

// TestProductionAgentsKeepsInstalledWhenVersionProbeFails confirms
// that a probe failure leaves Installed=true with Version="".
func TestProductionAgentsKeepsInstalledWhenVersionProbeFails(t *testing.T) {
	target := agent.SupportedTypes[0]
	dir := t.TempDir()
	shim := dir + "/" + target
	if err := writeFakeBinary(t, shim, "exit 0"); err != nil {
		t.Fatalf("write shim: %v", err)
	}
	t.Setenv("PATH", dir+":"+t.TempDir())
	if _, err := exec.LookPath(target); err != nil {
		t.Skipf("PATH not honoured: %v", err)
	}
	f := NewProduction()
	f.VersionProbe = func(_ context.Context, _ string) (string, error) {
		return "", errors.New("simulated version probe failure")
	}
	for _, a := range f.Agents() {
		if a.Type != target {
			continue
		}
		if !a.Installed {
			t.Fatalf("installed=false despite shim on PATH")
		}
		if a.Version != "" {
			t.Fatalf("version = %q, want empty after probe failure", a.Version)
		}
		return
	}
	t.Fatalf("target %s missing from Agents()", target)
}

// writeFakeBinary writes a tiny shell script the runner can exec.
// Used to make a supported backend type resolvable via PATH so
// Production.Agents() probes a real path.
func writeFakeBinary(t *testing.T, path, body string) error {
	t.Helper()
	return os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0o755) //nolint:gosec // exec scripts under t.TempDir() need the executable bit
}

// stubBackend satisfies agent.Backend without ever spawning a
// process. Tests inject it via ProductionFactory.NewBackend so we
// can assert exactly which executable path the factory resolved
// and which logger it forwarded.
type stubBackend struct{}

func (b *stubBackend) Execute(_ context.Context, _ string, _ agent.ExecOptions) (*agent.Session, error) {
	return nil, errors.New("stubBackend.Execute: not exercised by L1")
}

// TestProductionNewBuildsAgentConfigFromResolverAndLogger covers
// reviewer correction #3: prove the resolved executable path and
// the supplied logger both reach the agent.Config the factory
// passes to NewBackend.
func TestProductionNewBuildsAgentConfigFromResolverAndLogger(t *testing.T) {
	const expectedPath = "/opt/fake/claude"
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	stub := &stubBackend{}
	var receivedCfg agent.Config
	var receivedType string

	f := NewProductionWithLogger(logger)
	f.Resolver = func(typ string) (string, error) {
		if typ != "claude" {
			t.Fatalf("resolver typ = %q, want claude", typ)
		}
		return expectedPath, nil
	}
	f.NewBackend = func(typ string, cfg agent.Config) (agent.Backend, error) {
		receivedType = typ
		receivedCfg = cfg
		return stub, nil
	}
	got, err := f.New("claude")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got != stub {
		t.Fatalf("New returned a different backend than the stub")
	}
	if receivedType != "claude" {
		t.Fatalf("NewBackend typ = %q, want claude", receivedType)
	}
	if receivedCfg.ExecutablePath != expectedPath {
		t.Fatalf("agent.Config.ExecutablePath = %q, want %q", receivedCfg.ExecutablePath, expectedPath)
	}
	if receivedCfg.Logger != logger {
		t.Fatalf("agent.Config.Logger not forwarded; got %v want %v", receivedCfg.Logger, logger)
	}
}

// TestProductionNewWrapsResolverErrorAsUnavailable covers the
// "supported type, missing binary" path (reviewer correction #5).
func TestProductionNewWrapsResolverErrorAsUnavailable(t *testing.T) {
	f := NewProduction()
	f.Resolver = func(_ string) (string, error) { return "", errors.New("not found in $PATH") }
	_, err := f.New("claude")
	if !errors.Is(err, ErrBackendUnavailable) {
		t.Fatalf("err = %v, want ErrBackendUnavailable", err)
	}
}

// TestProductionNewWrapsConstructorErrorAsUnavailable covers the
// "supported type, binary present, but agent.New fails" path
// (reviewer correction #5).
func TestProductionNewWrapsConstructorErrorAsUnavailable(t *testing.T) {
	f := NewProduction()
	f.Resolver = func(_ string) (string, error) { return "/opt/fake/claude", nil }
	f.NewBackend = func(_ string, _ agent.Config) (agent.Backend, error) {
		return nil, errors.New("simulated agent.New failure")
	}
	_, err := f.New("claude")
	if !errors.Is(err, ErrBackendUnavailable) {
		t.Fatalf("err = %v, want ErrBackendUnavailable", err)
	}
}

// TestProductionNewStillRejectsUnknownType ensures the unknown-
// type branch keeps returning ErrUnknownBackend even after the
// 3.12 wiring (reviewer correction #5).
func TestProductionNewStillRejectsUnknownType(t *testing.T) {
	f := NewProduction()
	f.Resolver = func(_ string) (string, error) { return "/should/not/be/called", nil }
	_, err := f.New("godot")
	if !errors.Is(err, ErrUnknownBackend) {
		t.Fatalf("err = %v, want ErrUnknownBackend", err)
	}
}
