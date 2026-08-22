//go:build windows

package agent

import "log/slog"

// platformCopilotInvocation rewrites copilot.cmd to PowerShell -File
// copilot.ps1 so cmd.exe does not re-tokenise multi-line prompts.
func platformCopilotInvocation(lookedUp string, args []string, logger *slog.Logger) (string, []string, bool) {
	return rewriteCmdToPS1("copilot", lookedUp, args, logger)
}
