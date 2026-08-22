//go:build windows

package agent

import (
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var powerShellLookup = defaultPowerShellLookup

// rewriteCmdToPS1 bypasses npm's .cmd launcher so Go can pass every argv
// element, including multi-line prompts, to the sibling .ps1 unchanged.
func rewriteCmdToPS1(toolName, lookedUp string, args []string, logger *slog.Logger) (string, []string, bool) {
	ext := strings.ToLower(filepath.Ext(lookedUp))
	if ext != ".cmd" && ext != ".bat" {
		return "", nil, false
	}

	ps1 := filepath.Join(filepath.Dir(lookedUp), toolName+".ps1")
	if st, err := os.Stat(ps1); err != nil || st.IsDir() {
		return "", nil, false
	}

	psExe, ok := powerShellLookup()
	if !ok {
		return "", nil, false
	}

	full := make([]string, 0, 5+len(args))
	full = append(full, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1)
	full = append(full, args...)

	if logger != nil {
		logger.Info(toolName+": routing through powershell -File to preserve argv tokens",
			"powershell", psExe,
			"ps1", ps1,
			"original", lookedUp,
		)
	}
	return psExe, full, true
}

func defaultPowerShellLookup() (string, bool) {
	for _, name := range []string{"pwsh.exe", "powershell.exe"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, true
		}
	}

	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	candidate := filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
		return candidate, true
	}
	return "", false
}
