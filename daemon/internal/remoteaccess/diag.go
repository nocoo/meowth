package remoteaccess

import (
	"fmt"
	"net/netip"
	"strings"
)

// StartupError is the typed D-code error returned by validate. The
// constructors below pin Reason / Fix / Section to fixed strings
// per docs/architecture/05 §6.2 so call sites cannot misspell or
// mutate the diagnostic text.
type StartupError struct {
	// Code is the docs/architecture/05 §6.2 letter (D0..D6).
	Code string
	// Field is the §2.1 schema field name when the error pertains
	// to one (e.g. "mode", "bind_addr"). Empty otherwise.
	Field string
	// Value is the offending literal as the user wrote it. Empty
	// for D-codes that do not echo a value (e.g. D0).
	Value string
	// Reason is the one-line §6.1 "reason:" body. Already
	// substituted; presented verbatim by FormatStartupFailure.
	Reason string
	// Fix is the multi-line §6.1 "fix:" body. Already substituted.
	Fix string
	// Section is the docs/architecture/05 section reference, e.g.
	// "§2.1 / §5".
	Section string
}

func (e *StartupError) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("%s: %s", e.Code, e.Reason)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Reason)
}

// asStartupError lets FormatStartupFailure pivot cleanly on the
// typed error without an errors.As chain at the call site.
func asStartupError(err error) *StartupError {
	se, ok := err.(*StartupError)
	if !ok {
		return nil
	}
	return se
}

// FormatStartupFailure renders the §6.1 three-section message for
// stderr. For non-*StartupError input (e.g. *TOMLParseError) we
// fall back to a single-line "meowthd: startup failed: <err>" so
// generic parse failures still look sensible.
//
// `state` is rendered with whatever fields the caller supplied;
// passing all-zero values is fine — the formatter prints "<unset>"
// for empty strings.
type State struct {
	Mode           string
	BindAddr       string
	BindPort       string
	AcknowledgedBy string
}

// FormatStartupFailure renders the docs/architecture/05 §6.1
// three-section message. `state` carries the values the daemon
// actually parsed so the operator can see what the file
// contained.
func FormatStartupFailure(state State, err error) string {
	se := asStartupError(err)
	if se == nil {
		return fmt.Sprintf("meowthd: startup failed — %v\n", err)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "meowthd: startup failed — remote_access validation (%s)\n\n", se.Code)
	b.WriteString("  state:\n")
	fmt.Fprintf(&b, "    mode            = %s\n", fmtField(state.Mode))
	fmt.Fprintf(&b, "    bind_addr       = %s\n", fmtField(state.BindAddr))
	fmt.Fprintf(&b, "    bind_port       = %s\n", fmtField(state.BindPort))
	fmt.Fprintf(&b, "    acknowledged_by = %s\n", fmtField(state.AcknowledgedBy))
	b.WriteString("\n  reason:\n")
	for _, line := range strings.Split(se.Reason, "\n") {
		b.WriteString("    " + line + "\n")
	}
	b.WriteString("\n  fix:\n")
	for _, line := range strings.Split(se.Fix, "\n") {
		b.WriteString("    " + line + "\n")
	}
	fmt.Fprintf(&b, "\n  doc: docs/architecture/05-remote-access-modes.md %s\n", se.Section)
	return b.String()
}

func fmtField(s string) string {
	if s == "" {
		return "<unset>"
	}
	return s
}

// ---------------- D-code constructors ----------------

// D0: [remote_access] block exists but field <name> is missing.
func errD0Missing(field string) *StartupError {
	return &StartupError{
		Code:   "D0",
		Field:  field,
		Reason: fmt.Sprintf("[remote_access] block is present but field %q is missing\n(when the block is present, mode/bind_addr/bind_port must all be explicit)", field),
		Fix: "add the missing field to ~/.meowth/config.toml; example for local mode:\n" +
			"  [remote_access]\n" +
			"  mode      = \"local\"\n" +
			"  bind_addr = \"127.0.0.1\"\n" +
			"  bind_port = 7040\n" +
			"(or remove the entire [remote_access] block to fall back to defaults)",
		Section: "§2.1 / §5 step 1a",
	}
}

// D1: mode literal is not in the enum.
func errD1BadMode(v string) *StartupError {
	return &StartupError{
		Code:    "D1",
		Field:   "mode",
		Value:   v,
		Reason:  fmt.Sprintf("mode %q is not a valid enum value", v),
		Fix:     "set mode = \"local\" | \"tailscale\" | \"ssh_tunnel\" | \"https_proxy\"\nvim ~/.meowth/config.toml",
		Section: "§3 / §5 step 2",
	}
}

// D2: mode != local but acknowledged_by is empty / whitespace.
func errD2MissingAck(mode string) *StartupError {
	return &StartupError{
		Code:    "D2",
		Field:   "acknowledged_by",
		Value:   mode,
		Reason:  fmt.Sprintf("mode = %q but acknowledged_by is empty", mode),
		Fix:     "add an audit label to [remote_access].acknowledged_by\n(any non-empty human label, e.g. \"alice@laptop\")\nvim ~/.meowth/config.toml",
		Section: "§2.1 / §5 step 3",
	}
}

// D3: bind_addr write is rejected. reason is one of:
// empty / has_port / has_cidr / wildcard / not_an_ip.
func errD3(value, reasonTag string) *StartupError {
	return &StartupError{
		Code:    "D3",
		Field:   "bind_addr",
		Value:   value,
		Reason:  fmt.Sprintf("bind_addr %q rejected: %s", value, reasonTag),
		Fix:     "write only an IP literal or \"localhost\"\nports go in bind_port, not bind_addr\nvim ~/.meowth/config.toml",
		Section: "§2.3 / §5 step 4",
	}
}

// D4: bind_port out of 1..65535.
func errD4BadPort(value int64) *StartupError {
	return &StartupError{
		Code:    "D4",
		Field:   "bind_port",
		Value:   fmt.Sprintf("%d", value),
		Reason:  fmt.Sprintf("bind_port %d out of range (must be 1..65535)", value),
		Fix:     "set bind_port to 7040 (default) or a free TCP port on this host\nvim ~/.meowth/config.toml",
		Section: "§2.1 / §5 step 5",
	}
}

// D5: mode and bind_addr disagree. classification picks one of:
// loopback / tailscale_ip / public_ip — chosen by the caller via
// classifyBindForD5.
func errD5(mode Mode, addr netip.Addr, classification string) *StartupError {
	return &StartupError{
		Code:    "D5",
		Field:   "bind_addr",
		Value:   addr.String(),
		Reason:  fmt.Sprintf("mode = %q but bind_addr = %q is not in the allowed set for this mode", string(mode), addr.String()),
		Fix:     d5Fix(mode, classification),
		Section: "§4 / §5 step 6",
	}
}

// d5Fix produces the docs/architecture/05 §6.2 D5 sub-template
// keyed by the mode×classification matrix.
func d5Fix(mode Mode, classification string) string {
	switch {
	case mode == ModeSSHTunnel && classification == "tailscale_ip":
		return "ssh_tunnel must bind a loopback address (the remote side forwards via `ssh -L`)\n  bind_addr = \"127.0.0.1\""
	case mode == ModeTailscale && classification == "loopback":
		return "tailscale must bind your Tailscale IP from 100.64.0.0/10 or fd7a:115c:a1e0::/48\ncheck it with:  tailscale ip\n  bind_addr = \"100.<x>.<y>.<z>\""
	case mode == ModeLocal && classification == "tailscale_ip":
		return "local mode must bind loopback\nif you want remote access via Tailscale:\n  mode = \"tailscale\"\n  bind_addr = \"<your tailscale ip from `tailscale ip`>\"\n  acknowledged_by = \"<your audit label>\""
	case mode == ModeHTTPSProxy && classification == "public_ip":
		return "https_proxy must bind loopback; the reverse proxy (Caddy / cloudflared) must run on this host\n  bind_addr = \"127.0.0.1\""
	}
	// Default (e.g. local + public_ip, ssh_tunnel + public_ip, etc).
	// Still concrete and actionable.
	switch mode {
	case ModeLocal, ModeSSHTunnel, ModeHTTPSProxy:
		return fmt.Sprintf("%s must bind a loopback address (127.0.0.1 or ::1)\n  bind_addr = \"127.0.0.1\"", mode)
	case ModeTailscale:
		return "tailscale must bind your Tailscale IP from 100.64.0.0/10 or fd7a:115c:a1e0::/48\ncheck it with:  tailscale ip"
	}
	return "see docs/architecture/05 §4 for the allowed bind_addr set per mode"
}

// D6: tailscale bind_addr is not on any local interface.
func errD6NotRunning(addr netip.Addr) *StartupError {
	return &StartupError{
		Code:    "D6",
		Field:   "bind_addr",
		Value:   addr.String(),
		Reason:  fmt.Sprintf("bind_addr %q is not bound to any local interface (no Tailscale interface present — `tailscale up` not running?)", addr.String()),
		Fix:     "start Tailscale:\n  sudo tailscale up\nthen take the IP it prints (or `tailscale ip`) and write it into bind_addr\nvim ~/.meowth/config.toml",
		Section: "§4.1 / §5 step 7",
	}
}

func errD6IPMismatch(addr netip.Addr) *StartupError {
	return &StartupError{
		Code:    "D6",
		Field:   "bind_addr",
		Value:   addr.String(),
		Reason:  fmt.Sprintf("bind_addr %q is not on this host's Tailscale interface", addr.String()),
		Fix:     "run `tailscale ip` to find this host's actual Tailscale address, then update bind_addr\nvim ~/.meowth/config.toml",
		Section: "§4.1 / §5 step 7",
	}
}
