//go:build windows

package agent

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestRewriteCmdToPS1PreservesArguments(t *testing.T) {
	dir := t.TempDir()
	cmdPath := filepath.Join(dir, "copilot.cmd")
	ps1Path := filepath.Join(dir, "copilot.ps1")
	for _, path := range []string{cmdPath, ps1Path} {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	previousLookup := powerShellLookup
	t.Cleanup(func() { powerShellLookup = previousLookup })
	powerShellLookup = func() (string, bool) { return `C:\PowerShell\pwsh.exe`, true }

	args := []string{"-p", "line one\nline two", "--workspace", `C:\work dir`}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	gotExe, gotArgs, ok := rewriteCmdToPS1("copilot", cmdPath, args, logger)
	if !ok {
		t.Fatal("expected Windows npm launcher rewrite")
	}
	if gotExe != `C:\PowerShell\pwsh.exe` {
		t.Fatalf("executable = %q", gotExe)
	}
	wantArgs := append([]string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Path}, args...)
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("arguments = %#v, want %#v", gotArgs, wantArgs)
	}
}

func TestRewriteCmdToPS1SkipsNativeExecutable(t *testing.T) {
	if _, _, ok := rewriteCmdToPS1("copilot", `C:\bin\copilot.exe`, nil, nil); ok {
		t.Fatal("native executable must not be rewritten")
	}
}
