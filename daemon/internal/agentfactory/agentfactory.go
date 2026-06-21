// Package agentfactory resolves an agent.Backend for a given
// backend type. Two implementations exist:
//
//   - Production: returns ErrNotImplemented for every type in
//     Phase 3.11a; Phase 3.12 wires the real agent.New() factory
//     and replaces this stub.
//   - Fake: hands back a deterministic testbackend.Fake
//     instance per-type. Enabled only under
//     MEOWTH_TEST=1 + MEOWTH_BACKEND_FACTORY=fake (docs/
//     architecture/08 §3.3.1).
//
// FromEnv resolves a Factory at daemon startup using the same env
// signals; it fails closed when MEOWTH_BACKEND_FACTORY=fake is
// requested without MEOWTH_TEST=1.
package agentfactory

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/nocoo/meowth/daemon/internal/server/testbackend"
	"github.com/nocoo/meowth/daemon/pkg/agent"
)

// ErrUnknownBackend is returned when a caller requests a type that
// is NOT in agent.SupportedTypes. docs/architecture/02 §4.1 maps
// this to 404 /problems/unknown_backend.
var ErrUnknownBackend = errors.New("agentfactory: unknown backend type")

// ErrBackendUnavailable is returned when the type is supported but
// the production CLI binary cannot be located, or when 3.11's stub
// production factory has not yet been wired. docs/architecture/02
// §4.3 maps this to 503 /problems/backend_unavailable.
var ErrBackendUnavailable = errors.New("agentfactory: backend unavailable")

// AgentInfo is the docs/architecture/02 §6.1 GET /v1/agents row.
type AgentInfo struct {
	Type       string
	Installed  bool
	Executable string
	Version    string
}

// Factory describes the daemon-side knowledge of available agent
// backends. Both production and fake implementations satisfy it.
type Factory interface {
	// Mode reports whether the factory is production or fake; used
	// only for startup log lines and tests.
	Mode() string
	// SupportedTypes returns the canonical 5-type list per
	// docs/architecture/01 §4. Order is the agent package's
	// SupportedTypes order so GET /v1/agents enumeration is stable.
	SupportedTypes() []string
	// New constructs a backend for the requested type. Returns
	// ErrUnknownBackend for types not in SupportedTypes and
	// ErrBackendUnavailable when the type is recognised but no
	// runnable implementation is available.
	New(agentType string) (agent.Backend, error)
	// Agents probes installed status / executable / version for
	// each supported type. The result feeds GET /v1/agents.
	Agents() []AgentInfo
}

// ProductionFactory is the daemon's real factory. It resolves the
// backend CLI via exec.LookPath and constructs the concrete
// agent.Backend via agent.New. Each Agents() / New() call probes
// live so a CLI installed after daemon startup becomes visible
// immediately (no cache, see docs/architecture/02 §6.1).
type ProductionFactory struct {
	// Logger is forwarded into agent.Config when constructing a
	// backend. Defaults to slog.Default when nil.
	Logger *slog.Logger
	// VersionProbe is the injection point for tests. Production
	// callers leave it nil; we fall through to agent.DetectVersion.
	// A version probe that returns ("", err) yields Version="" but
	// keeps Installed=true — the CLI exists, we just could not
	// determine its version. docs/architecture/02 §6.1.
	VersionProbe func(ctx context.Context, executablePath string) (string, error)
	// VersionProbeTimeout caps how long DetectVersion runs per
	// agent so GET /v1/agents stays fast even when a CLI hangs.
	VersionProbeTimeout time.Duration
	// Resolver is the executable-path resolver. Defaults to
	// exec.LookPath. Tests override to assert which path the
	// factory hands to agent.Config.
	Resolver func(agentType string) (string, error)
	// NewBackend is the injectable agent.Backend constructor.
	// Defaults to agent.New. Tests override so they can assert
	// the Config the factory builds (ExecutablePath / Logger)
	// without spinning up a real backend.
	NewBackend func(agentType string, cfg agent.Config) (agent.Backend, error)
}

// NewProduction returns a ProductionFactory using slog.Default.
// Callers that want to attach a request-id-aware logger should
// build the factory directly: `&ProductionFactory{Logger: l}`.
func NewProduction() *ProductionFactory { return &ProductionFactory{} }

// NewProductionWithLogger returns a ProductionFactory wired with
// the supplied logger so agent.Config.Logger inherits the daemon's
// structured logger.
func NewProductionWithLogger(logger *slog.Logger) *ProductionFactory {
	return &ProductionFactory{Logger: logger}
}

// Mode returns "production".
func (*ProductionFactory) Mode() string { return "production" }

// SupportedTypes returns agent.SupportedTypes.
func (*ProductionFactory) SupportedTypes() []string {
	out := make([]string, len(agent.SupportedTypes))
	copy(out, agent.SupportedTypes)
	return out
}

// New resolves the CLI binary via Resolver (default exec.LookPath)
// and constructs the agent.Backend via NewBackend (default
// agent.New). Returns ErrUnknownBackend for types not in
// agent.SupportedTypes and ErrBackendUnavailable when the binary
// cannot be located or the constructor fails.
func (f *ProductionFactory) New(agentType string) (agent.Backend, error) {
	if !agent.IsSupportedType(agentType) {
		return nil, fmt.Errorf("%w: %q", ErrUnknownBackend, agentType)
	}
	resolver := f.Resolver
	if resolver == nil {
		resolver = exec.LookPath
	}
	path, err := resolver(agentType)
	if err != nil {
		return nil, fmt.Errorf("%w: type=%q LookPath: %v", ErrBackendUnavailable, agentType, err)
	}
	ctor := f.NewBackend
	if ctor == nil {
		ctor = agent.New
	}
	logger := f.Logger
	if logger == nil {
		logger = slog.Default()
	}
	backend, err := ctor(agentType, agent.Config{
		ExecutablePath: path,
		Logger:         logger,
	})
	if err != nil {
		return nil, fmt.Errorf("%w: type=%q agent.New: %v", ErrBackendUnavailable, agentType, err)
	}
	return backend, nil
}

// Agents probes each supported type for executable presence and
// CLI version. Version detection failure (CLI is installed but
// `--version` errors or times out) keeps Installed=true with
// Version="" per docs/architecture/02 §6.1.
func (f *ProductionFactory) Agents() []AgentInfo {
	probe := f.VersionProbe
	if probe == nil {
		probe = agent.DetectVersion
	}
	timeout := f.VersionProbeTimeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	out := make([]AgentInfo, 0, len(agent.SupportedTypes))
	for _, t := range agent.SupportedTypes {
		info := AgentInfo{Type: t}
		path, err := exec.LookPath(t)
		if err != nil {
			out = append(out, info)
			continue
		}
		info.Installed = true
		info.Executable = path
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		if v, err := probe(ctx, path); err == nil {
			info.Version = strings.TrimSpace(v)
		}
		cancel()
		out = append(out, info)
	}
	return out
}

// FakeFactory replays deterministic fixtures via testbackend. It
// is constructed only by FromEnv when both gating env vars are
// set, so production code paths cannot reach it accidentally.
type FakeFactory struct{}

// NewFake constructs a FakeFactory. Callers must have already
// verified MEOWTH_TEST=1 + MEOWTH_BACKEND_FACTORY=fake before
// calling this constructor — FromEnv does that gating.
func NewFake() *FakeFactory { return &FakeFactory{} }

// Mode returns "fake".
func (*FakeFactory) Mode() string { return "fake" }

// SupportedTypes returns agent.SupportedTypes.
func (*FakeFactory) SupportedTypes() []string {
	out := make([]string, len(agent.SupportedTypes))
	copy(out, agent.SupportedTypes)
	return out
}

// New returns a testbackend.Fake configured for the agent type.
// docs/architecture/08 §3.3.1: per-type scenario mapping is fixed
// (see testbackend.ScenarioFor).
func (*FakeFactory) New(agentType string) (agent.Backend, error) {
	if !agent.IsSupportedType(agentType) {
		return nil, fmt.Errorf("%w: %q", ErrUnknownBackend, agentType)
	}
	scenario := testbackend.ScenarioFor(agentType)
	return testbackend.New(scenario)
}

// Agents returns an Installed=true entry for every supported
// type so dashboards in fake mode behave as if all CLIs are
// present.
func (*FakeFactory) Agents() []AgentInfo {
	out := make([]AgentInfo, 0, len(agent.SupportedTypes))
	for _, t := range agent.SupportedTypes {
		out = append(out, AgentInfo{
			Type:       t,
			Installed:  true,
			Executable: "<fake>",
			Version:    "0.0.0-fake",
		})
	}
	return out
}

// FromEnv resolves the Factory the daemon should use given the
// process environment. The env contract per docs/architecture/08
// §3.3.1:
//
//   - MEOWTH_BACKEND_FACTORY unset / empty → production
//   - MEOWTH_BACKEND_FACTORY=fake + MEOWTH_TEST=1 → fake
//   - MEOWTH_BACKEND_FACTORY=fake without MEOWTH_TEST=1 → error
//   - any other MEOWTH_BACKEND_FACTORY value → error
//
// logger is forwarded into ProductionFactory so the agent.Config
// the factory builds inherits the daemon's structured logger.
// nil is acceptable; ProductionFactory falls back to slog.Default.
// Fake mode ignores the logger (it does not invoke agent.New).
//
// The error path is fatal: daemon refuses to start. This prevents
// a misconfigured production process from accidentally serving
// fake backends.
func FromEnv(logger *slog.Logger) (Factory, error) {
	requested := os.Getenv("MEOWTH_BACKEND_FACTORY")
	switch requested {
	case "", "production":
		return NewProductionWithLogger(logger), nil
	case "fake":
		if os.Getenv("MEOWTH_TEST") != "1" {
			return nil, errors.New("agentfactory: MEOWTH_BACKEND_FACTORY=fake requires MEOWTH_TEST=1")
		}
		return NewFake(), nil
	default:
		return nil, fmt.Errorf("agentfactory: unsupported MEOWTH_BACKEND_FACTORY=%q (allowed: production, fake)", requested)
	}
}
