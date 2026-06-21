package server

import (
	"context"
	"database/sql"

	"github.com/nocoo/meowth/daemon/internal/server/handlers"
)

// pumpRunner adapts pumpAgentSession to handlers.ExecRunner. It
// holds the *sql.DB and a reference to the cancel registry so the
// pump can ask "was this cancel a shutdown?" when its context
// fires. docs/architecture/02 §8.1: shutdown → status=aborted;
// user cancel / client disconnect → status=cancelled.
type pumpRunner struct {
	db       *sql.DB
	registry *cancelRegistry
}

func newPumpRunner(db *sql.DB, registry *cancelRegistry) pumpRunner {
	return pumpRunner{db: db, registry: registry}
}

// Run invokes pumpAgentSession and translates pumpResult into the
// ExecRunResult the handler reads.
func (r pumpRunner) Run(ctx context.Context, p handlers.ExecRunParams) handlers.ExecRunResult {
	sessionID := p.SessionID
	res := pumpAgentSession(ctx, pumpConfig{
		DB:          r.db,
		SessionID:   sessionID,
		BackendType: p.BackendType,
		Session:     p.Session,
		Writer:      p.Writer,
		Flusher:     p.Flusher,
		Logger:      p.Logger,
		IsShutdown: func() bool {
			if r.registry == nil {
				return false
			}
			return r.registry.IsShutdown(sessionID)
		},
	})
	return handlers.ExecRunResult{
		Status:     res.Status,
		Error:      res.Error,
		PersistErr: res.PersistErr,
	}
}
