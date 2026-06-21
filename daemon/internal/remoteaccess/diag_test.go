package remoteaccess

import (
	"net/netip"
	"strings"
	"testing"
)

// TestFormatStartupFailureHasThreeSections asserts the §6.1
// envelope (header + state / reason / fix / doc) is rendered for
// any *StartupError input.
func TestFormatStartupFailureHasThreeSections(t *testing.T) {
	out := FormatStartupFailure(State{Mode: "tailscale", BindAddr: "100.64.10.20", BindPort: "7777", AcknowledgedBy: ""}, errD2MissingAck("tailscale"))
	for _, frag := range []string{
		"meowthd: startup failed",
		"state:",
		"mode            = tailscale",
		"bind_addr       = 100.64.10.20",
		"bind_port       = 7777",
		"acknowledged_by = <unset>",
		"reason:",
		"fix:",
		"doc: docs/architecture/05-remote-access-modes.md §2.1 / §5 step 3",
	} {
		if !strings.Contains(out, frag) {
			t.Fatalf("missing %q in:\n%s", frag, out)
		}
	}
}

func TestFormatStartupFailureFallbackForNonStartupError(t *testing.T) {
	pe := &TOMLParseError{Path: "/tmp/x", Err: errSentinel{}}
	out := FormatStartupFailure(State{}, pe)
	if !strings.Contains(out, "meowthd: startup failed") {
		t.Fatalf("missing prefix: %s", out)
	}
	if !strings.Contains(out, "/tmp/x") {
		t.Fatalf("missing path: %s", out)
	}
}

type errSentinel struct{}

func (errSentinel) Error() string { return "boom" }

// TestDiagCoverageForEachDCode iterates the seven D-codes and
// asserts each carries the §6.2 critical fragments. The intent is
// to make accidental edits to constructors surface immediately.
func TestDiagCoverageForEachDCode(t *testing.T) {
	type want struct {
		code, reason, fix, section string
	}
	cases := []struct {
		name string
		err  *StartupError
		want want
	}{
		{
			"D0",
			errD0Missing("bind_addr"),
			want{
				code:    "D0",
				reason:  `field "bind_addr" is missing`,
				fix:     "add the missing field",
				section: "§2.1 / §5 step 1a",
			},
		},
		{
			"D1",
			errD1BadMode("lan"),
			want{
				code:    "D1",
				reason:  `mode "lan" is not a valid enum value`,
				fix:     `set mode = "local" | "tailscale"`,
				section: "§3 / §5 step 2",
			},
		},
		{
			"D2",
			errD2MissingAck("tailscale"),
			want{
				code:    "D2",
				reason:  `mode = "tailscale" but acknowledged_by is empty`,
				fix:     "add an audit label",
				section: "§2.1 / §5 step 3",
			},
		},
		{
			"D3",
			errD3("0.0.0.0", "wildcard"),
			want{
				code:    "D3",
				reason:  `bind_addr "0.0.0.0" rejected: wildcard`,
				fix:     "ports go in bind_port",
				section: "§2.3 / §5 step 4",
			},
		},
		{
			"D4",
			errD4BadPort(65536),
			want{
				code:    "D4",
				reason:  "bind_port 65536 out of range",
				fix:     "set bind_port to 7777",
				section: "§2.1 / §5 step 5",
			},
		},
		{
			"D5",
			errD5(ModeSSHTunnel, netip.MustParseAddr("100.64.10.20"), "tailscale_ip"),
			want{
				code:    "D5",
				reason:  `mode = "ssh_tunnel" but bind_addr = "100.64.10.20"`,
				fix:     "ssh_tunnel must bind a loopback",
				section: "§4 / §5 step 6",
			},
		},
		{
			"D6-not-running",
			errD6NotRunning(netip.MustParseAddr("100.64.10.20")),
			want{
				code:    "D6",
				reason:  "no Tailscale interface present",
				fix:     "sudo tailscale up",
				section: "§4.1 / §5 step 7",
			},
		},
		{
			"D6-ip-mismatch",
			errD6IPMismatch(netip.MustParseAddr("100.64.10.20")),
			want{
				code:    "D6",
				reason:  "not on this host's Tailscale interface",
				fix:     "run `tailscale ip`",
				section: "§4.1 / §5 step 7",
			},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.err.Code != c.want.code {
				t.Fatalf("code = %s, want %s", c.err.Code, c.want.code)
			}
			out := FormatStartupFailure(State{Mode: "x", BindAddr: "x", BindPort: "x", AcknowledgedBy: "x"}, c.err)
			for _, frag := range []string{c.want.reason, c.want.fix, c.want.section} {
				if !strings.Contains(out, frag) {
					t.Fatalf("missing %q in:\n%s", frag, out)
				}
			}
		})
	}
}
