package agent

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"syscall"
)

// logAgentCommandRedacted logs the invocation without echoing prompt-
// bearing argv tails. argv transports (pi, copilot) put the user prompt
// in args; logging them would leak full task text into meowthd logs.
func logAgentCommandRedacted(logger *slog.Logger, execPath string, args []string, promptInArgv bool) {
	if logger == nil {
		return
	}
	if !promptInArgv || len(args) == 0 {
		logger.Info("agent command", "exec", execPath, "args", args)
		return
	}
	safe := append([]string(nil), args...)
	safe[len(safe)-1] = fmt.Sprintf("<prompt %d bytes>", len(args[len(args)-1]))
	logger.Info("agent command", "exec", execPath, "args", safe)
}

func wrapStartError(backend string, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, syscall.E2BIG) || strings.Contains(strings.ToLower(err.Error()), "argument list too long") {
		return fmt.Errorf("start %s: argument list too long (prompt/args exceed OS ARG_MAX for argv transport): %w", backend, err)
	}
	return fmt.Errorf("start %s: %w", backend, err)
}
