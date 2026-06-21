package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/nocoo/meowth/daemon/internal/bootstraptoken"
	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/initcmd"
	"github.com/nocoo/meowth/daemon/internal/remoteaccess"
	"github.com/nocoo/meowth/daemon/internal/server"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// Version is set at build time via -ldflags; defaults to "dev" for local builds.
var Version = "dev"

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		// runServe has already printed the full three-section
		// diagnostic via FormatStartupFailure for *StartupError
		// paths; in that case we just exit non-zero without
		// re-printing the sentinel.
		if err != errStartupValidation {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(1)
	}
}

// run dispatches subcommands. No-argument invocation prints the
// version banner, which the Phase 2 L2 harness in scripts/run-l2.ts
// regexes against `^meowthd `; that contract is locked by
// TestNoArgPrintsVersionProbe.
func run(args []string, stdout, stderr *os.File) error {
	if len(args) == 0 {
		_, _ = fmt.Fprintf(stdout, "meowthd %s\n", Version)
		return nil
	}
	switch args[0] {
	case "init":
		return runInit(args[1:], stdout, stderr)
	case "bootstrap-token":
		return runBootstrapToken(args[1:], stdout, stderr)
	case "serve":
		return runServe(args[1:], stdout, stderr)
	case "-h", "--help", "help":
		_, _ = fmt.Fprintln(stdout, usage())
		return nil
	default:
		return fmt.Errorf("meowthd: unknown subcommand %q\n\n%s", args[0], usage())
	}
}

func runInit(args []string, _ *os.File, _ *os.File) error {
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	skipToken := fs.Bool("skip-token", false,
		"skip the root token mint and produce a setup-code at <home>/runtime/setup_nonce.hash (path B)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("meowthd init: unexpected positional arguments %v", fs.Args())
	}
	h, err := resolveHome()
	if err != nil {
		return err
	}
	return initcmd.Run(context.Background(), h, initcmd.Options{SkipToken: *skipToken}, os.Stdout)
}

func runBootstrapToken(args []string, _ *os.File, _ *os.File) error {
	fs := flag.NewFlagSet("bootstrap-token", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("meowthd bootstrap-token: unexpected positional arguments %v", fs.Args())
	}
	h, err := resolveHome()
	if err != nil {
		return err
	}
	return bootstraptoken.Run(context.Background(), h, bootstraptoken.Options{}, os.Stdout)
}

// runServe boots the HTTP control plane. The listen address is
// derived from `[remote_access]` in the daemon config file (see
// home.Home.ConfigPath); see docs/architecture/05 for the schema
// and startup validation pipeline. `--listen-addr` is a test-only
// escape hatch (requires MEOWTH_TEST=1) that replaces the actual
// listener address without touching the parsed RemoteAccess —
// IsLocal() still reflects the config file so Phase 3.8's mint
// endpoint mount decision is audit-faithful.
func runServe(args []string, stdout, stderr *os.File) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(stderr)
	addrOverride := fs.String("listen-addr", "",
		"test-only listener override; requires MEOWTH_TEST=1. "+
			"Format host:port; host must be 127.0.0.1 or ::1; port 0..65535. "+
			"In production the listener is derived from [remote_access] in config.toml.")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("meowthd serve: unexpected positional arguments %v", fs.Args())
	}

	// Validate the override flag (gating + shape) BEFORE touching
	// home / config / DB so misuse never leaves files behind. The
	// flag is only honoured in MEOWTH_TEST=1; in production we
	// reject it up front.
	if *addrOverride != "" {
		if _, err := validateListenAddrOverride(*addrOverride); err != nil {
			return err
		}
	}

	h, err := resolveHome()
	if err != nil {
		return err
	}

	// docs/architecture/05 §5 + reviewer's "validation before
	// h.Ensure / store.Open" rule: nothing on disk is touched
	// until the config validates. If we hit a *StartupError, the
	// daemon exits cleanly without leaving a SQLite file or test
	// marker behind.
	ifaceAddrs, err := remoteaccess.LocalInterfaceAddrs()
	if err != nil {
		return fmt.Errorf("meowthd serve: interface addrs: %w", err)
	}
	ra, err := remoteaccess.Load(h.ConfigPath, ifaceAddrs)
	if err != nil {
		state := stateFromConfig(h.ConfigPath)
		_, _ = fmt.Fprint(stderr, remoteaccess.FormatStartupFailure(state, err))
		return errStartupValidation
	}

	listenAddr, err := resolveListenAddr(ra, *addrOverride)
	if err != nil {
		return err
	}

	if err := h.Ensure(); err != nil {
		return err
	}
	ctx := context.Background()
	db, err := store.Open(ctx, h)
	if err != nil {
		return fmt.Errorf("meowthd serve: open store: %w", err)
	}
	defer func() { _ = db.Close() }()

	listener, err := server.Listen(listenAddr)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(stderr, nil))
	// docs/architecture/05 §5 step 9: acknowledged_by is an audit
	// label, not a secret — log it as plaintext.
	logger.Info("remote_access startup",
		"mode", string(ra.Mode),
		"bind", ra.ListenAddr(),
		"acknowledged_by", ra.AcknowledgedBy,
		"listen_override", *addrOverride != "",
	)
	srv, err := server.New(server.Config{DB: db, Logger: logger})
	if err != nil {
		return err
	}
	signalCtx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	return srv.Serve(signalCtx, listener, func(a net.Addr) {
		// L2 harness greps stdout for `^listening: ` to discover the
		// actually-bound address when an OS-allocated port was used.
		_, _ = fmt.Fprintf(stdout, "listening: %s\n", a.String())
	})
}

// errStartupValidation is the sentinel main() prints with NO extra
// wrapping after FormatStartupFailure has already written the
// full three-section diagnostic to stderr.
var errStartupValidation = fmt.Errorf("meowthd: remote_access validation failed")

// stateFromConfig reads the config (best-effort) and renders a
// State value the diagnostic can echo back. Reading failures
// return an empty State; the formatter renders <unset> for the
// missing fields.
func stateFromConfig(path string) remoteaccess.State {
	data, err := os.ReadFile(path) //nolint:gosec // path is the daemon's resolved home config path
	if err != nil {
		return remoteaccess.State{}
	}
	// Single-pass cheap field extraction; we deliberately avoid
	// re-parsing the TOML here because the parse may have just
	// failed. The fragments below are enough to surface what the
	// user wrote without colouring the diagnostic with our own
	// re-parse interpretation.
	get := func(k string) string {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, k) {
				continue
			}
			rest := strings.TrimSpace(strings.TrimPrefix(line, k))
			if !strings.HasPrefix(rest, "=") {
				continue
			}
			val := strings.TrimSpace(strings.TrimPrefix(rest, "="))
			val = strings.Trim(val, `"`)
			return val
		}
		return ""
	}
	return remoteaccess.State{
		Mode:           get("mode"),
		BindAddr:       get("bind_addr"),
		BindPort:       get("bind_port"),
		AcknowledgedBy: get("acknowledged_by"),
	}
}

// resolveListenAddr returns the host:port the HTTP listener should
// bind to. By default it is ra.ListenAddr() — derived from the
// validated config. The --listen-addr flag is a test-only override
// (gated by MEOWTH_TEST=1) used by scripts/run-l2.ts to pick an
// OS-allocated port.
func resolveListenAddr(ra *remoteaccess.RemoteAccess, override string) (string, error) {
	if override == "" {
		return ra.ListenAddr(), nil
	}
	return validateListenAddrOverride(override)
}

// validateListenAddrOverride enforces the override's gating
// (MEOWTH_TEST=1) and its host/port shape. Returns the normalised
// host:port string the listener should use.
func validateListenAddrOverride(override string) (string, error) {
	if os.Getenv("MEOWTH_TEST") != "1" {
		return "", fmt.Errorf("meowthd serve: --listen-addr is a test-only override; set MEOWTH_TEST=1 to use it")
	}
	ap, err := netip.ParseAddrPort(override)
	if err != nil {
		return "", fmt.Errorf("meowthd serve: --listen-addr %q: %w", override, err)
	}
	host := ap.Addr().Unmap()
	if host != netip.MustParseAddr("127.0.0.1") && host != netip.MustParseAddr("::1") {
		return "", fmt.Errorf("meowthd serve: --listen-addr host must be 127.0.0.1 or ::1 (got %s)", host)
	}
	// netip.ParseAddrPort already enforces a uint16 port; we accept
	// port=0 because the test harness uses it to pick an OS port.
	return ap.String(), nil
}

// resolveHome picks production or test mode based on the documented
// MEOWTH_TEST=1 sentinel. The home package itself is responsible for
// rejecting the wrong env combinations; main.go only routes. We use
// the Resolve* variants so initcmd can run its idempotency check
// against a still-unprovisioned root.
func resolveHome() (*home.Home, error) {
	if os.Getenv("MEOWTH_TEST") == "1" {
		return home.ResolveTest()
	}
	return home.ResolveProduction()
}

func usage() string {
	return `meowthd — meowth daemon

usage:
  meowthd                  print version (probe)
  meowthd init             create ~/.meowth and mint the root token (path A)
  meowthd init --skip-token
                           create ~/.meowth without the root token; emit a setup-code
                           and persist setup_nonce.hash for the first-run mint (path B)
  meowthd bootstrap-token  mint an emergency root token into an existing ~/.meowth
                           (independent of mint window / remote_access / tokens-empty)
  meowthd serve [--listen-addr host:port]
                           start the HTTP control plane; listener is derived from
                           [remote_access] in config.toml. --listen-addr is a
                           test-only override (requires MEOWTH_TEST=1).
  meowthd help             print this message

env:
  MEOWTH_TEST=1            switch to the test home (~/.meowth-test); honoured by all subcommands.
  MEOWTH_TEST_HOME=<dir>   override the test home root (only honoured when MEOWTH_TEST=1).`
}
