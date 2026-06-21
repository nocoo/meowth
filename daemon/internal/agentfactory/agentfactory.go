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

// ProductionFactory is the daemon's real factory. In Phase 3.11a
// every New call returns ErrBackendUnavailable; Phase 3.12 will
// replace this with the genuine agent.New(type, config) wiring.
//
// Probe results (Agents()) DO call exec.LookPath + agent.DetectVersion
// so /v1/agents reports the local CLI presence + version even
// before the production factory is fully wired.
type ProductionFactory struct {
	// VersionProbe is the injection point for tests. Production
	// callers leave it nil; we fall through to agent.DetectVersion.
	// A version probe that returns ("", err) yields Version="" but
	// keeps Installed=true — the CLI exists, we just could not
	// determine its version. docs/architecture/02 §6.1.
	VersionProbe func(ctx context.Context, executablePath string) (string, error)
	// VersionProbeTimeout caps how long DetectVersion runs per
	// agent so GET /v1/agents stays fast even when a CLI hangs.
	VersionProbeTimeout time.Duration
}

// NewProduction returns a ProductionFactory.
func NewProduction() *ProductionFactory { return &ProductionFactory{} }

// Mode returns "production".
func (*ProductionFactory) Mode() string { return "production" }

// SupportedTypes returns agent.SupportedTypes.
func (*ProductionFactory) SupportedTypes() []string {
	out := make([]string, len(agent.SupportedTypes))
	copy(out, agent.SupportedTypes)
	return out
}

// New returns ErrUnknownBackend or ErrBackendUnavailable. Phase
// 3.12 replaces the latter with agent.New.
func (*ProductionFactory) New(agentType string) (agent.Backend, error) {
	if !agent.IsSupportedType(agentType) {
		return nil, fmt.Errorf("%w: %q", ErrUnknownBackend, agentType)
	}
	return nil, fmt.Errorf("%w: production factory not wired until Phase 3.12 (type=%q)", ErrBackendUnavailable, agentType)
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
// The error path is fatal: daemon refuses to start. This prevents
// a misconfigured production process from accidentally serving
// fake backends.
func FromEnv() (Factory, error) {
	requested := os.Getenv("MEOWTH_BACKEND_FACTORY")
	switch requested {
	case "", "production":
		return NewProduction(), nil
	case "fake":
		if os.Getenv("MEOWTH_TEST") != "1" {
			return nil, errors.New("agentfactory: MEOWTH_BACKEND_FACTORY=fake requires MEOWTH_TEST=1")
		}
		return NewFake(), nil
	default:
		return nil, fmt.Errorf("agentfactory: unsupported MEOWTH_BACKEND_FACTORY=%q (allowed: production, fake)", requested)
	}
}
