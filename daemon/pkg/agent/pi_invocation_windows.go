//go:build windows

package agent

import "log/slog"

// platformPiInvocation rewrites pi.cmd to PowerShell -File pi.ps1 so
// cmd.exe does not re-tokenise arguments.
func platformPiInvocation(lookedUp string, args []string, logger *slog.Logger) (string, []string, bool) {
	return rewriteCmdToPS1("pi", lookedUp, args, logger)
}
