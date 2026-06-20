package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
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
	if !strings.Contains(stdout, "http://127.0.0.1:7777") {
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
