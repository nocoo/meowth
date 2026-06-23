package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// runMeowthd invokes `go run ./cmd/meowthd <args...>` against the
// daemon module so the tests exercise the same binary path Phase 2 L2
// (scripts/run-l2.ts) uses. Returns stdout, stderr, exit code.
func runMeowthd(t *testing.T, env []string, args ...string) (string, string, int) {
	t.Helper()
	// Tests live in daemon/cmd/meowthd; binary is built from "." here.
	cmd := exec.Command("go", append([]string{"run", "."}, args...)...) //nolint:gosec // test invokes the daemon binary it owns under t.TempDir()
	cmd.Env = append(os.Environ(), env...)
	var stdoutBuf, stderrBuf strings.Builder
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	err := cmd.Run()
	code := 0
	if ee, ok := err.(*exec.ExitError); ok {
		code = ee.ExitCode()
	} else if err != nil {
		t.Fatalf("go run: %v\nstderr=%s", err, stderrBuf.String())
	}
	return stdoutBuf.String(), stderrBuf.String(), code
}

func TestNoArgPrintsVersionProbe(t *testing.T) {
	// Phase 2 L2 harness depends on `^meowthd ` matching the first
	// stdout line of `go run ./cmd/meowthd` with no args. Lock this
	// contract from drift.
	stdout, _, code := runMeowthd(t, nil)
	if code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
	if !regexp.MustCompile(`(?m)^meowthd `).MatchString(stdout) {
		t.Fatalf("stdout %q does not match ^meowthd ", stdout)
	}
}

func TestInitDefaultMintsRootToken(t *testing.T) {
	testHome := t.TempDir()
	root := filepath.Join(testHome, ".meowth-test")
	stdout, stderr, code := runMeowthd(t, []string{
		"MEOWTH_TEST=1",
		"MEOWTH_TEST_HOME=" + root,
	}, "init")
	if code != 0 {
		t.Fatalf("exit = %d, stderr=%s", code, stderr)
	}
	if !strings.Contains(stdout, "mwt_") {
		t.Fatalf("stdout missing mwt_ token; out=%q err=%q", stdout, stderr)
	}
	// DB exists at expected path.
	if _, err := os.Stat(filepath.Join(root, "meowth-test.db")); err != nil {
		t.Fatalf("stat db: %v", err)
	}
	// config.toml exists.
	if _, err := os.Stat(filepath.Join(root, "config.toml")); err != nil {
		t.Fatalf("stat config.toml: %v", err)
	}
	// setup_nonce.hash absent in path A.
	if _, err := os.Stat(filepath.Join(root, "runtime", "setup_nonce.hash")); err == nil {
		t.Fatal("setup_nonce.hash should not exist in path A")
	}
}

func TestInitSkipTokenWritesNonceAndPrintsSetupCode(t *testing.T) {
	testHome := t.TempDir()
	root := filepath.Join(testHome, ".meowth-test")
	stdout, stderr, code := runMeowthd(t, []string{
		"MEOWTH_TEST=1",
		"MEOWTH_TEST_HOME=" + root,
	}, "init", "--skip-token")
	if code != 0 {
		t.Fatalf("exit = %d, stderr=%s", code, stderr)
	}
	if !strings.Contains(stdout, "mws_") {
		t.Fatalf("stdout missing mws_ setup-code; out=%q err=%q", stdout, stderr)
	}
	if strings.Contains(stdout, "mwt_") {
		t.Fatalf("stdout leaked mwt_ token in path B: %q", stdout)
	}
	if _, err := os.Stat(filepath.Join(root, "runtime", "setup_nonce.hash")); err != nil {
		t.Fatalf("stat nonce: %v", err)
	}
}

func TestInitSecondCallIsIdempotentRefuse(t *testing.T) {
	testHome := t.TempDir()
	root := filepath.Join(testHome, ".meowth-test")
	if _, _, code := runMeowthd(t, []string{
		"MEOWTH_TEST=1",
		"MEOWTH_TEST_HOME=" + root,
	}, "init"); code != 0 {
		t.Fatalf("first init exit = %d", code)
	}
	_, stderr, code := runMeowthd(t, []string{
		"MEOWTH_TEST=1",
		"MEOWTH_TEST_HOME=" + root,
	}, "init")
	if code == 0 {
		t.Fatal("second init should refuse, got exit 0")
	}
	if !strings.Contains(stderr, "refusing to run") {
		t.Fatalf("stderr lacks refusal: %q", stderr)
	}
}

func TestInitRejectsUnknownSubcommand(t *testing.T) {
	_, stderr, code := runMeowthd(t, nil, "frobnicate")
	if code == 0 {
		t.Fatal("unknown subcommand should fail")
	}
	if !strings.Contains(stderr, "unknown subcommand") {
		t.Fatalf("stderr lacks unknown-subcommand message: %q", stderr)
	}
}

func TestInitRejectsPositionalArgs(t *testing.T) {
	_, stderr, code := runMeowthd(t, []string{"MEOWTH_TEST=1"}, "init", "extra")
	if code == 0 {
		t.Fatal("positional arg should fail")
	}
	if !strings.Contains(stderr, "unexpected positional") {
		t.Fatalf("stderr lacks positional message: %q", stderr)
	}
}

func TestBootstrapTokenSucceedsOnInitializedHome(t *testing.T) {
	testHome := t.TempDir()
	root := filepath.Join(testHome, ".meowth-test")
	env := []string{
		"MEOWTH_TEST=1",
		"MEOWTH_TEST_HOME=" + root,
	}
	if _, _, code := runMeowthd(t, env, "init"); code != 0 {
		t.Fatalf("seed init exit = %d", code)
	}
	stdout, stderr, code := runMeowthd(t, env, "bootstrap-token")
	if code != 0 {
		t.Fatalf("bootstrap-token exit = %d, stderr=%s", code, stderr)
	}
	if !strings.Contains(stdout, "mwt_") {
		t.Fatalf("stdout missing mwt_ token: %q", stdout)
	}
	if !strings.Contains(stdout, "Emergency bootstrap") {
		t.Fatalf("stdout missing banner: %q", stdout)
	}
	if !strings.Contains(stdout, "http://127.0.0.1:7040") {
		t.Fatalf("stdout missing Dashboard URL: %q", stdout)
	}
}

func TestBootstrapTokenRefusesOnMissingHome(t *testing.T) {
	testHome := t.TempDir()
	root := filepath.Join(testHome, ".meowth-test")
	_, stderr, code := runMeowthd(t, []string{
		"MEOWTH_TEST=1",
		"MEOWTH_TEST_HOME=" + root,
	}, "bootstrap-token")
	if code == 0 {
		t.Fatal("bootstrap-token on missing home: want failure, got exit 0")
	}
	if !strings.Contains(stderr, "does not exist") {
		t.Fatalf("stderr lacks missing-home refusal: %q", stderr)
	}
}

func TestBootstrapTokenRejectsPositionalArgs(t *testing.T) {
	_, stderr, code := runMeowthd(t, []string{"MEOWTH_TEST=1"}, "bootstrap-token", "extra")
	if code == 0 {
		t.Fatal("positional arg should fail")
	}
	if !strings.Contains(stderr, "unexpected positional") {
		t.Fatalf("stderr lacks positional message: %q", stderr)
	}
}

// serveRunMeowthd spawns `meowthd serve ...` and waits one second
// for the child to either print `listening:` or fail. Returns the
// captured stdout / stderr / exit code; on long-running success the
// child is SIGKILLed before return.
func serveRunMeowthd(t *testing.T, env []string, args ...string) (string, string, int) {
	t.Helper()
	cmd := exec.Command("go", append([]string{"run", "."}, args...)...) //nolint:gosec // tests own this binary
	cmd.Env = append(os.Environ(), env...)
	var stdoutBuf, stderrBuf strings.Builder
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		code := 0
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else if err != nil {
			t.Fatalf("wait: %v\nstderr=%s", err, stderrBuf.String())
		}
		return stdoutBuf.String(), stderrBuf.String(), code
	case <-time.After(8 * time.Second):
		// The child is healthily running serve; we only intended to
		// observe startup behaviour.
		_ = cmd.Process.Kill()
		<-done
		return stdoutBuf.String(), stderrBuf.String(), 0
	}
}

// TestServeRejectsListenAddrInProduction asserts the --listen-addr
// override is rejected without MEOWTH_TEST=1, BEFORE the daemon
// touches home / config / DB. The flag-gating check is the very
// first thing runServe does after flag.Parse.
func TestServeRejectsListenAddrInProduction(t *testing.T) {
	_, stderr, code := serveRunMeowthd(t, nil, "serve", "--listen-addr=127.0.0.1:0")
	if code == 0 {
		t.Fatal("serve --listen-addr without MEOWTH_TEST=1: want failure")
	}
	if !strings.Contains(stderr, "test-only override") {
		t.Fatalf("stderr lacks test-only marker: %q", stderr)
	}
}

// TestServeListenAddrTestModeRejectsBadHost covers the override
// host allow-set (127.0.0.1 / ::1 only).
func TestServeListenAddrTestModeRejectsBadHost(t *testing.T) {
	_, stderr, code := serveRunMeowthd(t, []string{"MEOWTH_TEST=1"}, "serve", "--listen-addr=0.0.0.0:7040")
	if code == 0 {
		t.Fatal("serve --listen-addr=0.0.0.0: want failure")
	}
	if !strings.Contains(stderr, "127.0.0.1 or ::1") {
		t.Fatalf("stderr lacks host allow-set: %q", stderr)
	}
}

// TestServeListenAddrTestModeRejectsBlank covers empty / no-host
// overrides — netip.ParseAddrPort rejects these.
func TestServeListenAddrTestModeRejectsBlank(t *testing.T) {
	_, stderr, code := serveRunMeowthd(t, []string{"MEOWTH_TEST=1"}, "serve", "--listen-addr=:0")
	if code == 0 {
		t.Fatal("serve --listen-addr=:0 (no host): want failure")
	}
	if !strings.Contains(stderr, "--listen-addr") {
		t.Fatalf("stderr lacks --listen-addr context: %q", stderr)
	}
}
