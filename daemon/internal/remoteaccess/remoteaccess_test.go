package remoteaccess

import (
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeConfig is the L1 helper that materialises a fixture
// config.toml in the test's temp dir.
func writeConfig(t *testing.T, contents string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func mustAddr(t *testing.T, s string) netip.Addr {
	t.Helper()
	a, err := netip.ParseAddr(s)
	if err != nil {
		t.Fatalf("ParseAddr(%q): %v", s, err)
	}
	return a
}

func loadOK(t *testing.T, contents string, ifaceAddrs []netip.Addr) *RemoteAccess {
	t.Helper()
	ra, err := Load(writeConfig(t, contents), ifaceAddrs)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	return ra
}

func loadCode(t *testing.T, contents string, ifaceAddrs []netip.Addr) *StartupError {
	t.Helper()
	_, err := Load(writeConfig(t, contents), ifaceAddrs)
	if err == nil {
		t.Fatal("Load: want error, got nil")
	}
	var se *StartupError
	if !errors.As(err, &se) {
		t.Fatalf("Load: want *StartupError, got %T (%v)", err, err)
	}
	return se
}

// ---------------- happy paths ----------------

func TestLoadFileMissingReturnsDefaultLocal(t *testing.T) {
	dir := t.TempDir()
	ra, err := Load(filepath.Join(dir, "nope.toml"), nil)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if ra.Mode != ModeLocal || ra.BindAddr != mustAddr(t, "127.0.0.1") || ra.BindPort != 7777 || ra.AcknowledgedBy != "" {
		t.Fatalf("default mismatch: %+v", ra)
	}
	if !ra.IsLocal() {
		t.Fatal("IsLocal should be true on default")
	}
	// Side-effect check: Load must not create the file.
	if _, err := os.Stat(filepath.Join(dir, "nope.toml")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Load created config file on a missing-path call: %v", err)
	}
}

func TestLoadEmptyConfigReturnsDefaultLocal(t *testing.T) {
	ra := loadOK(t, "# only a comment\n", nil)
	if ra.Mode != ModeLocal || !ra.IsLocal() {
		t.Fatalf("want local default, got %+v", ra)
	}
}

func TestLoadExplicitLocalBlock(t *testing.T) {
	body := `[remote_access]
mode            = "local"
bind_addr       = "127.0.0.1"
bind_port       = 7777
acknowledged_by = ""
`
	ra := loadOK(t, body, nil)
	if ra.Mode != ModeLocal || ra.BindPort != 7777 {
		t.Fatalf("unexpected: %+v", ra)
	}
}

func TestLoadLocalhostNormalizes(t *testing.T) {
	body := `[remote_access]
mode      = "local"
bind_addr = "localhost"
bind_port = 7777
`
	ra := loadOK(t, body, nil)
	if ra.BindAddr != mustAddr(t, "127.0.0.1") {
		t.Fatalf("localhost not normalised: %s", ra.BindAddr)
	}
}

func TestLoadTailscaleWithMatchingIface(t *testing.T) {
	body := `[remote_access]
mode            = "tailscale"
bind_addr       = "100.64.10.20"
bind_port       = 7777
acknowledged_by = "alice@laptop"
`
	ifaces := []netip.Addr{mustAddr(t, "127.0.0.1"), mustAddr(t, "100.64.10.20")}
	ra := loadOK(t, body, ifaces)
	if ra.Mode != ModeTailscale || ra.IsLocal() {
		t.Fatalf("want tailscale non-local, got %+v", ra)
	}
}

// ---------------- TOML / strict failures ----------------

func TestLoadTomlParseError(t *testing.T) {
	_, err := Load(writeConfig(t, "this is not toml"), nil)
	if err == nil {
		t.Fatal("want parse error")
	}
	var pe *TOMLParseError
	if !errors.As(err, &pe) {
		t.Fatalf("want *TOMLParseError, got %T", err)
	}
}

func TestLoadRejectsTopLevelUnknownKey(t *testing.T) {
	body := `mysterious_field = 1
[remote_access]
mode = "local"
bind_addr = "127.0.0.1"
bind_port = 7777
`
	_, err := Load(writeConfig(t, body), nil)
	if err == nil {
		t.Fatal("want strict error for top-level unknown")
	}
	var pe *TOMLParseError
	if !errors.As(err, &pe) {
		t.Fatalf("want *TOMLParseError, got %T (%v)", err, err)
	}
}

func TestLoadRejectsUnknownFieldInsideBlock(t *testing.T) {
	body := `[remote_access]
mode = "local"
bind_addr = "127.0.0.1"
bind_port = 7777
hidden_flag = true
`
	_, err := Load(writeConfig(t, body), nil)
	if err == nil {
		t.Fatal("want strict error for block-level unknown")
	}
	var pe *TOMLParseError
	if !errors.As(err, &pe) {
		t.Fatalf("want *TOMLParseError, got %T (%v)", err, err)
	}
}

// ---------------- D0 ----------------

func TestD0MissingMode(t *testing.T) {
	body := `[remote_access]
bind_addr = "127.0.0.1"
bind_port = 7777
`
	se := loadCode(t, body, nil)
	if se.Code != "D0" || se.Field != "mode" {
		t.Fatalf("want D0/mode, got %+v", se)
	}
}

func TestD0MissingBindAddr(t *testing.T) {
	body := `[remote_access]
mode = "local"
bind_port = 7777
`
	se := loadCode(t, body, nil)
	if se.Code != "D0" || se.Field != "bind_addr" {
		t.Fatalf("want D0/bind_addr, got %+v", se)
	}
}

func TestD0MissingBindPort(t *testing.T) {
	body := `[remote_access]
mode = "local"
bind_addr = "127.0.0.1"
`
	se := loadCode(t, body, nil)
	if se.Code != "D0" || se.Field != "bind_port" {
		t.Fatalf("want D0/bind_port, got %+v", se)
	}
}

// ---------------- D1 ----------------

func TestD1BadModeEnum(t *testing.T) {
	body := `[remote_access]
mode = "lan"
bind_addr = "127.0.0.1"
bind_port = 7777
`
	se := loadCode(t, body, nil)
	if se.Code != "D1" {
		t.Fatalf("want D1, got %s", se.Code)
	}
}

// ---------------- D2 ----------------

func TestD2EmptyAck(t *testing.T) {
	body := `[remote_access]
mode = "tailscale"
bind_addr = "100.64.10.20"
bind_port = 7777
acknowledged_by = ""
`
	se := loadCode(t, body, []netip.Addr{mustAddr(t, "100.64.10.20")})
	if se.Code != "D2" {
		t.Fatalf("want D2, got %s", se.Code)
	}
}

func TestD2WhitespaceAck(t *testing.T) {
	body := `[remote_access]
mode = "tailscale"
bind_addr = "100.64.10.20"
bind_port = 7777
acknowledged_by = "   "
`
	se := loadCode(t, body, []netip.Addr{mustAddr(t, "100.64.10.20")})
	if se.Code != "D2" {
		t.Fatalf("want D2 for whitespace-only ack, got %s", se.Code)
	}
}

// ---------------- D3 ----------------

func TestD3RejectionTable(t *testing.T) {
	cases := []struct {
		name, addr, want string
	}{
		{"empty", `""`, "empty"},
		{"has_port_v4", `"127.0.0.1:7777"`, "has_port"},
		{"has_port_v6", `"[::1]:7777"`, "has_port"},
		{"has_cidr", `"127.0.0.1/8"`, "has_cidr"},
		{"wildcard_v4", `"0.0.0.0"`, "wildcard"},
		{"wildcard_v6", `"::"`, "wildcard"},
		{"not_an_ip", `"meowth.local"`, "not_an_ip"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body := "[remote_access]\nmode = \"local\"\nbind_addr = " + c.addr + "\nbind_port = 7777\n"
			se := loadCode(t, body, nil)
			if se.Code != "D3" {
				t.Fatalf("want D3 for %s, got %s", c.name, se.Code)
			}
			if !strings.Contains(se.Reason, c.want) {
				t.Fatalf("want reason containing %q, got %q", c.want, se.Reason)
			}
		})
	}
}

// 127.0.0.2 is a legal IP literal — it must fall to D5, NOT D3.
func TestLocalBind127002IsD5NotD3(t *testing.T) {
	body := `[remote_access]
mode = "local"
bind_addr = "127.0.0.2"
bind_port = 7777
`
	se := loadCode(t, body, nil)
	if se.Code != "D5" {
		t.Fatalf("want D5 for 127.0.0.2 (legal IP, wrong allow-set), got %s", se.Code)
	}
}

// ---------------- D4 ----------------

func TestD4PortRange(t *testing.T) {
	cases := []struct {
		name string
		port string
	}{
		{"negative", "-1"},
		{"zero", "0"},
		{"over", "65536"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body := "[remote_access]\nmode = \"local\"\nbind_addr = \"127.0.0.1\"\nbind_port = " + c.port + "\n"
			se := loadCode(t, body, nil)
			if se.Code != "D4" {
				t.Fatalf("want D4 for %s, got %s", c.name, se.Code)
			}
		})
	}
}

// ---------------- D5 ----------------

func TestD5Subtemplates(t *testing.T) {
	cases := []struct {
		name, mode, addr, fixContains string
		ifaces                        []netip.Addr
	}{
		{
			name:        "ssh_tunnel_with_tailscale_ip",
			mode:        "ssh_tunnel",
			addr:        "100.64.10.20",
			fixContains: "ssh_tunnel must bind a loopback",
		},
		{
			name:        "tailscale_with_loopback",
			mode:        "tailscale",
			addr:        "127.0.0.1",
			fixContains: "tailscale must bind your Tailscale IP",
		},
		{
			name:        "local_with_tailscale_ip",
			mode:        "local",
			addr:        "100.64.10.20",
			fixContains: "local mode must bind loopback",
		},
		{
			name:        "https_proxy_with_public_ip",
			mode:        "https_proxy",
			addr:        "1.2.3.4",
			fixContains: "https_proxy must bind loopback",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ack := ""
			if c.mode != "local" {
				ack = "alice"
			}
			body := "[remote_access]\nmode = \"" + c.mode + "\"\nbind_addr = \"" + c.addr + "\"\nbind_port = 7777\nacknowledged_by = \"" + ack + "\"\n"
			se := loadCode(t, body, c.ifaces)
			if se.Code != "D5" {
				t.Fatalf("want D5 for %s, got %s (%s)", c.name, se.Code, se.Reason)
			}
			if !strings.Contains(se.Fix, c.fixContains) {
				t.Fatalf("fix does not contain %q: %s", c.fixContains, se.Fix)
			}
		})
	}
}

// ---------------- D6 ----------------

func TestD6TailscaleNotRunning(t *testing.T) {
	body := `[remote_access]
mode = "tailscale"
bind_addr = "100.64.10.20"
bind_port = 7777
acknowledged_by = "alice"
`
	// No Tailscale IP at all in ifaceAddrs → "not running".
	se := loadCode(t, body, []netip.Addr{mustAddr(t, "127.0.0.1"), mustAddr(t, "fe80::1")})
	if se.Code != "D6" {
		t.Fatalf("want D6, got %s", se.Code)
	}
	if !strings.Contains(se.Reason, "no Tailscale interface present") {
		t.Fatalf("want not-running reason, got %q", se.Reason)
	}
}

func TestD6TailscaleIPMismatch(t *testing.T) {
	body := `[remote_access]
mode = "tailscale"
bind_addr = "100.64.10.20"
bind_port = 7777
acknowledged_by = "alice"
`
	// A Tailscale IP exists in ifaceAddrs but it's the wrong one →
	// "ip mismatch".
	se := loadCode(t, body, []netip.Addr{mustAddr(t, "127.0.0.1"), mustAddr(t, "100.64.99.99")})
	if se.Code != "D6" {
		t.Fatalf("want D6, got %s", se.Code)
	}
	if !strings.Contains(se.Reason, "not on this host's Tailscale interface") {
		t.Fatalf("want ip-mismatch reason, got %q", se.Reason)
	}
}

// ---------------- IPv6 / Tailscale parser ----------------

func TestTailscaleIPv6AcceptsAndMatches(t *testing.T) {
	body := `[remote_access]
mode = "tailscale"
bind_addr = "fd7a:115c:a1e0::1"
bind_port = 7777
acknowledged_by = "alice"
`
	ra := loadOK(t, body, []netip.Addr{mustAddr(t, "fd7a:115c:a1e0::1")})
	if ra.BindAddr.String() != "fd7a:115c:a1e0::1" {
		t.Fatalf("addr: %s", ra.BindAddr)
	}
}

// ---------------- API surface ----------------

func TestIsLocalMatrix(t *testing.T) {
	cases := []struct {
		m  Mode
		ok bool
	}{
		{ModeLocal, true},
		{ModeTailscale, false},
		{ModeSSHTunnel, false},
		{ModeHTTPSProxy, false},
	}
	for _, c := range cases {
		t.Run(string(c.m), func(t *testing.T) {
			ra := RemoteAccess{Mode: c.m}
			if got := ra.IsLocal(); got != c.ok {
				t.Fatalf("IsLocal(%s) = %v, want %v", c.m, got, c.ok)
			}
		})
	}
}

func TestListenAddrFormat(t *testing.T) {
	cases := []struct{ addr, want string }{
		{"127.0.0.1", "127.0.0.1:7777"},
		{"::1", "[::1]:7777"},
	}
	for _, c := range cases {
		t.Run(c.addr, func(t *testing.T) {
			ra := RemoteAccess{BindAddr: mustAddr(t, c.addr), BindPort: 7777}
			if got := ra.ListenAddr(); got != c.want {
				t.Fatalf("ListenAddr(%s) = %s, want %s", c.addr, got, c.want)
			}
		})
	}
}

// ---------------- File size guard ----------------

func TestLoadRejectsOversizedConfig(t *testing.T) {
	huge := strings.Repeat("# x\n", MaxConfigSize)
	_, err := Load(writeConfig(t, huge), nil)
	if err == nil {
		t.Fatal("want error for oversized config")
	}
}
