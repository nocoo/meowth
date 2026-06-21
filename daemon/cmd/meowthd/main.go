package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/nocoo/meowth/daemon/internal/bootstraptoken"
	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/initcmd"
	"github.com/nocoo/meowth/daemon/internal/server"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// Version is set at build time via -ldflags; defaults to "dev" for local builds.
var Version = "dev"

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
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

// runServe boots the HTTP control plane (Phase 3.7). The bind address
// defaults to 127.0.0.1:7777; --listen-addr lets L2 ask for an OS-
// allocated port (":0") and read the real address from stdout.
//
// The remote_access config (docs/architecture/05) is NOT consulted
// here yet — that lands with Phase 3.9 and will replace the default
// with the resolved bind.
func runServe(args []string, stdout, _ *os.File) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	addr := fs.String("listen-addr", "127.0.0.1:7777",
		"TCP listen address (host:port). Use 127.0.0.1:0 to let the OS pick a port.")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("meowthd serve: unexpected positional arguments %v", fs.Args())
	}
	h, err := resolveHome()
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

	listener, err := server.Listen(*addr)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	srv, err := server.New(server.Config{DB: db, Logger: logger})
	if err != nil {
		return err
	}
	signalCtx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	return srv.Serve(signalCtx, listener, func(a net.Addr) {
		// L2 harness greps stdout for `^listening: ` to discover the
		// actually-bound address when --listen-addr=:0 was used.
		_, _ = fmt.Fprintf(stdout, "listening: %s\n", a.String())
	})
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
                           start the HTTP control plane (defaults to 127.0.0.1:7777)
  meowthd help             print this message

env:
  MEOWTH_TEST=1            switch to the test home (~/.meowth-test); honoured by all subcommands.
  MEOWTH_TEST_HOME=<dir>   override the test home root (only honoured when MEOWTH_TEST=1).`
}
