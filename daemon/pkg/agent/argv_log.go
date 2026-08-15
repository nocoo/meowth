package agent

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"syscall"
)

// argvPromptMode selects how a backend embeds the user prompt in argv.
type argvPromptMode int

const (
	// argvPromptLast is used by pi: the prompt is the final positional arg.
	argvPromptLast argvPromptMode = iota
	// argvPromptFlagP is used by copilot: `-p <prompt>` early in argv.
	argvPromptFlagP
)

// logAgentCommandRedacted logs the invocation without echoing prompt-
// bearing argv values. argv transports put the user prompt in args;
// logging them would leak full task text into meowthd logs.
func logAgentCommandRedacted(logger *slog.Logger, execPath string, args []string, mode argvPromptMode) {
	if logger == nil {
		return
	}
	safe := redactArgvPrompts(args, mode)
	logger.Info("agent command", "exec", execPath, "args", safe)
}

func redactArgvPrompts(args []string, mode argvPromptMode) []string {
	if len(args) == 0 {
		return args
	}
	safe := append([]string(nil), args...)
	switch mode {
	case argvPromptFlagP:
		for i := 0; i+1 < len(safe); i++ {
			if safe[i] == "-p" || safe[i] == "--prompt" {
				safe[i+1] = fmt.Sprintf("<prompt %d bytes>", len(args[i+1]))
			}
		}
	default: // argvPromptLast
		safe[len(safe)-1] = fmt.Sprintf("<prompt %d bytes>", len(args[len(args)-1]))
	}
	return safe
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
