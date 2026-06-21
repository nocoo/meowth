// Package remoteaccess parses and validates the docs/architecture/05
// `[remote_access]` config block. It exposes the small RemoteAccess
// struct that the daemon's serve subcommand reads to derive its
// listener and that Phase 3.8 will read (via IsLocal()) to decide
// whether the bootstrap/mint endpoint is mounted.
//
// The package layers cleanly:
//   - Load(configPath, ifaceAddrs) is the only entry point a caller
//     needs. It reads the TOML file (or treats "not exist" as the
//     §2.2 default), runs the §5 validation pipeline, and returns a
//     fully-resolved *RemoteAccess.
//   - Each validation failure is a *StartupError with the D-code,
//     fixed reason, fixed fix and the docs/architecture/05 section
//     pointer baked in by the constructor. FormatStartupFailure
//     renders it in the §6.1 three-section layout for stderr.
//   - LocalInterfaceAddrs is the production helper that gathers the
//     ifaceAddrs argument. Tests inject their own list.
//
// The package does NOT touch the SQLite store, write any file, or
// open the listener — that responsibility belongs to the caller
// (cmd/meowthd serve) which runs validation strictly before
// h.Ensure() / store.Open() so a failed validation cannot leave
// runtime files behind.
package remoteaccess

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"strconv"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

// Mode is the docs/architecture/05 §3 enum.
type Mode string

const (
	ModeLocal      Mode = "local"
	ModeTailscale  Mode = "tailscale"
	ModeSSHTunnel  Mode = "ssh_tunnel"
	ModeHTTPSProxy Mode = "https_proxy"
)

// validModes is the enum allow-set; iterated by D1.
var validModes = []Mode{ModeLocal, ModeTailscale, ModeSSHTunnel, ModeHTTPSProxy}

// MaxConfigSize caps the config file read at 64 KiB. The file is a
// few-line TOML; anything larger is corruption or a foot-gun.
const MaxConfigSize = 64 * 1024

// DefaultBindAddr / DefaultBindPort encode the docs/architecture/05
// §2.2 "block missing → equivalent to full local default" values.
var (
	DefaultBindAddr        = netip.MustParseAddr("127.0.0.1")
	DefaultBindPort uint16 = 7777
)

// tsV4 / tsV6 are the Tailscale prefixes per docs/architecture/05 §4.
var (
	tsV4 = netip.MustParsePrefix("100.64.0.0/10")
	tsV6 = netip.MustParsePrefix("fd7a:115c:a1e0::/48")
)

var (
	loopbackV4 = netip.MustParseAddr("127.0.0.1")
	loopbackV6 = netip.MustParseAddr("::1")
)

// RemoteAccess is the validated, in-memory result of the §2 schema
// after running through the §5 pipeline. All callers should obtain
// instances via Load — the struct does not validate itself on
// construction so direct literals must not be used outside tests.
type RemoteAccess struct {
	Mode           Mode
	BindAddr       netip.Addr
	BindPort       uint16
	AcknowledgedBy string
}

// IsLocal mirrors docs/architecture/05 §5 step 9: the mint endpoint
// mount decision (04 §5.1) is taken from Mode alone, NOT from the
// bind being loopback. This is the §2.4 "bind loopback ≠ IsLocal"
// rule expressed in code.
func (r RemoteAccess) IsLocal() bool { return r.Mode == ModeLocal }

// ListenAddr returns the canonical "host:port" string the daemon's
// HTTP listener should bind to. IPv6 hosts are wrapped in brackets
// per net.JoinHostPort semantics.
func (r RemoteAccess) ListenAddr() string {
	return net.JoinHostPort(r.BindAddr.String(), strconv.Itoa(int(r.BindPort)))
}

// rawBlock is the strict-decoded `[remote_access]` table. Field
// pointers let us distinguish "missing" from "explicitly zero".
type rawBlock struct {
	Mode           *string `toml:"mode"`
	BindAddr       *string `toml:"bind_addr"`
	BindPort       *int64  `toml:"bind_port"`
	AcknowledgedBy *string `toml:"acknowledged_by"`
}

type rawConfig struct {
	RemoteAccess *rawBlock `toml:"remote_access"`
}

// TOMLParseError wraps a decode failure from go-toml/v2 so the
// caller can present it as a generic parse error (NOT a D-code).
// docs/architecture/05 §12 lists this as a separate failure mode.
type TOMLParseError struct {
	Path string
	Err  error
}

func (e *TOMLParseError) Error() string {
	return fmt.Sprintf("parse %s: %v", e.Path, e.Err)
}

func (e *TOMLParseError) Unwrap() error { return e.Err }

// Load is the single entry point. configPath may not exist — in
// that case (and only that case) Load synthesises a default local
// RemoteAccess per docs/architecture/05 §2.2 and does NOT create
// the file. Any other IO error or any TOML parse failure is
// returned wrapped in TOMLParseError. Validation failures are
// returned as *StartupError so the caller can pass them to
// FormatStartupFailure.
//
// ifaceAddrs is the list of IPs the host owns; the production
// caller wires it from LocalInterfaceAddrs. Tests inject a
// deterministic list. Only the tailscale mode consults it.
func Load(configPath string, ifaceAddrs []netip.Addr) (*RemoteAccess, error) {
	raw, err := readConfig(configPath)
	if err != nil {
		return nil, err
	}
	if raw == nil || raw.RemoteAccess == nil {
		// §2.2: block missing → default local, all four fields set.
		return defaultLocal(), nil
	}
	return validate(raw.RemoteAccess, ifaceAddrs)
}

// readConfig reads the file (size-capped) and runs go-toml/v2 in
// strict mode so unknown top-level keys and unknown fields inside
// `[remote_access]` both fail. Returns (nil, nil) when the file
// does not exist — caller treats it as §2.2 default.
func readConfig(configPath string) (*rawConfig, error) {
	info, err := os.Stat(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("stat %s: %w", configPath, err)
	}
	if info.Size() > MaxConfigSize {
		return nil, fmt.Errorf("config file too large: %d bytes (max %d)", info.Size(), MaxConfigSize)
	}
	f, err := os.Open(configPath) //nolint:gosec // configPath is the daemon's resolved home path; not user-attacker-influenced at runtime
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", configPath, err)
	}
	defer func() { _ = f.Close() }()

	dec := toml.NewDecoder(f).DisallowUnknownFields()
	var cfg rawConfig
	if err := dec.Decode(&cfg); err != nil {
		return nil, &TOMLParseError{Path: configPath, Err: err}
	}
	return &cfg, nil
}

func defaultLocal() *RemoteAccess {
	return &RemoteAccess{
		Mode:           ModeLocal,
		BindAddr:       DefaultBindAddr,
		BindPort:       DefaultBindPort,
		AcknowledgedBy: "",
	}
}

func validate(b *rawBlock, ifaceAddrs []netip.Addr) (*RemoteAccess, error) {
	// Step 4 — D0 missing fields. Each constructor pins the §2.1
	// field name so the diagnostic fix points at the actual gap.
	if b.Mode == nil {
		return nil, errD0Missing("mode")
	}
	if b.BindAddr == nil {
		return nil, errD0Missing("bind_addr")
	}
	if b.BindPort == nil {
		return nil, errD0Missing("bind_port")
	}

	// Step 5a — D1 mode enum.
	mode := Mode(*b.Mode)
	if !isValidMode(mode) {
		return nil, errD1BadMode(*b.Mode)
	}

	// Step 6 — D2 ack required for non-local. TrimSpace so "  " is
	// not treated as a real label (per reviewer detail #4).
	ack := ""
	if b.AcknowledgedBy != nil {
		ack = *b.AcknowledgedBy
	}
	if mode != ModeLocal && strings.TrimSpace(ack) == "" {
		return nil, errD2MissingAck(string(mode))
	}

	// Step 5b — D4 port range.
	port, perr := checkPort(*b.BindPort)
	if perr != nil {
		return nil, perr
	}

	// Step 7 — D3 bind_addr classification (5 reasons only;
	// "127.0.0.2" is a legal IP literal and falls to D5).
	addr, addrErr := parseBindAddr(*b.BindAddr)
	if addrErr != nil {
		return nil, addrErr
	}

	// Step 8 — D5 mode×bind allow-set.
	if err := checkModeAddrAllowSet(mode, addr); err != nil {
		return nil, err
	}

	// Step 9 — D6 tailscale-only interface membership.
	if mode == ModeTailscale {
		if err := checkTailscaleInterface(addr, ifaceAddrs); err != nil {
			return nil, err
		}
	}

	return &RemoteAccess{
		Mode:           mode,
		BindAddr:       addr,
		BindPort:       port,
		AcknowledgedBy: ack,
	}, nil
}

func isValidMode(m Mode) bool {
	for _, v := range validModes {
		if v == m {
			return true
		}
	}
	return false
}

// checkPort enforces 1..65535. Negative / zero / over-range all
// route to D4 per reviewer detail #2.
func checkPort(raw int64) (uint16, error) {
	if raw < 1 || raw > 65535 {
		return 0, errD4BadPort(raw)
	}
	return uint16(raw), nil
}

// parseBindAddr implements §2.3 normalize + D3 classification.
// docs/architecture/05 §2.3 enumerates accepted writes and §6.2
// pins D3's five reason labels (empty, has_port, has_cidr,
// wildcard, not_an_ip). The order of checks matters because some
// inputs match multiple patterns (e.g. "0.0.0.0" parses but also
// IsUnspecified) — wildcard must be classified AFTER successful
// parse so the user sees the more specific reason.
func parseBindAddr(raw string) (netip.Addr, error) {
	v := raw
	if v == "" {
		return netip.Addr{}, errD3(raw, "empty")
	}
	if v == "localhost" {
		// §2.3: hard-coded normalize, never DNS-resolved.
		v = "127.0.0.1"
	}
	if strings.ContainsRune(v, '/') {
		return netip.Addr{}, errD3(raw, "has_cidr")
	}
	// AddrPort succeeds when "host:port" is given. We only accept
	// bare addresses here; if AddrPort succeeds we know a port was
	// embedded. ParseAddrPort accepts "[::1]:7777" too, so this
	// catches IPv6+port.
	if _, err := netip.ParseAddrPort(v); err == nil {
		return netip.Addr{}, errD3(raw, "has_port")
	}
	addr, err := netip.ParseAddr(v)
	if err != nil {
		return netip.Addr{}, errD3(raw, "not_an_ip")
	}
	if addr.IsUnspecified() {
		return netip.Addr{}, errD3(raw, "wildcard")
	}
	return addr, nil
}

// checkModeAddrAllowSet is the §4 table.
func checkModeAddrAllowSet(mode Mode, addr netip.Addr) error {
	switch mode {
	case ModeLocal:
		if isLoopback(addr) {
			return nil
		}
		return errD5(mode, addr, classifyBindForD5(addr))
	case ModeSSHTunnel:
		if isLoopback(addr) {
			return nil
		}
		return errD5(mode, addr, classifyBindForD5(addr))
	case ModeHTTPSProxy:
		if isLoopback(addr) {
			return nil
		}
		return errD5(mode, addr, classifyBindForD5(addr))
	case ModeTailscale:
		if tsV4.Contains(addr) || tsV6.Contains(addr) {
			return nil
		}
		return errD5(mode, addr, classifyBindForD5(addr))
	}
	// Unreachable — D1 catches unknown modes earlier.
	return fmt.Errorf("internal: unknown mode %q", mode)
}

// classifyBindForD5 maps a non-matching bind to one of the four
// docs/architecture/05 §6.2 D5 sub-templates so the diagnostic fix
// segment is specific.
func classifyBindForD5(addr netip.Addr) string {
	switch {
	case tsV4.Contains(addr) || tsV6.Contains(addr):
		return "tailscale_ip"
	case isLoopback(addr):
		return "loopback"
	default:
		return "public_ip"
	}
}

// isLoopback is the §4.2 strict definition: only 127.0.0.1 and ::1.
// We deliberately do NOT use netip.Addr.IsLoopback (which covers
// 127.0.0.0/8) — docs/architecture/05 forbids 127.0.0.2 etc.
func isLoopback(addr netip.Addr) bool {
	return addr == loopbackV4 || addr == loopbackV6
}

// checkTailscaleInterface implements §4.1 interface membership.
// `not_running` vs `ip_mismatch` is distinguished by whether the
// passed ifaceAddrs list contains *any* IP inside the Tailscale
// prefixes — if not, Tailscale is presumed off.
func checkTailscaleInterface(addr netip.Addr, ifaceAddrs []netip.Addr) error {
	hasTailscaleIface := false
	for _, ia := range ifaceAddrs {
		if ia == addr {
			return nil
		}
		if tsV4.Contains(ia) || tsV6.Contains(ia) {
			hasTailscaleIface = true
		}
	}
	if hasTailscaleIface {
		return errD6IPMismatch(addr)
	}
	return errD6NotRunning(addr)
}

// LocalInterfaceAddrs is the production helper Load callers pass
// as the second arg. It enumerates net.InterfaceAddrs() and
// converts each *net.IPNet's IP to a netip.Addr. Test code should
// not call this — tests inject deterministic lists.
func LocalInterfaceAddrs() ([]netip.Addr, error) {
	ifaces, err := net.InterfaceAddrs()
	if err != nil {
		return nil, fmt.Errorf("net.InterfaceAddrs: %w", err)
	}
	out := make([]netip.Addr, 0, len(ifaces))
	for _, ia := range ifaces {
		ipNet, ok := ia.(*net.IPNet)
		if !ok {
			continue
		}
		addr, ok := netip.AddrFromSlice(ipNet.IP)
		if !ok {
			continue
		}
		out = append(out, addr.Unmap())
	}
	return out, nil
}
