// Package server wires the meowth daemon's HTTP control plane. It
// owns the chi router, the v1 middleware chain, and the small set of
// handlers landed in Phase 3.7 (healthz + token CRUD). Bearer auth
// itself lives in internal/server/auth; problem+json bodies in
// internal/server/problem.
//
// The order of the middleware chain is the contract from
// docs/architecture/02-daemon-http-protocol.md §12. Phase 3.7 lands
// the first five rungs and bearer wiring; 3.10 inserts nosniff and
// security_headers; mint/exec/sessions/messages routes land with
// 3.8 / 3.11 commits.
package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nocoo/meowth/daemon/internal/agentfactory"
	"github.com/nocoo/meowth/daemon/internal/server/auth"
	"github.com/nocoo/meowth/daemon/internal/server/handlers"
	"github.com/nocoo/meowth/daemon/internal/server/mint"
	"github.com/nocoo/meowth/daemon/internal/server/secheaders"
)

// Config carries everything Server.New needs. Production wiring fills
// DB + Logger; tests inject AuthConfig hooks so they can observe
// last_used_at without sleeping.
type Config struct {
	DB         *sql.DB
	Logger     *slog.Logger
	AuthConfig auth.Config // DB defaulted from cfg.DB; Hasher/TouchHook tests override

	// BodyLimit is the max request body in bytes per docs/architecture/02
	// §12. Defaults to 1 MiB when zero.
	BodyLimit int64

	// MintWindow is the resolved Phase 3.8 bootstrap mint state.
	// nil → POST /bootstrap/mint is NOT mounted; the router-level
	// NotFound returns the standard /problems/not_found 404 instead.
	// docs/architecture/04 §5.1 / §6.1 — server.New does not gate
	// on Closed() at mount time; that is a runtime handler concern.
	MintWindow *mint.MintWindow

	// AgentFactory resolves agent.Backend instances per /v1/agents/
	// {type}/exec request. REQUIRED — server.New rejects a nil
	// factory so production wiring cannot silently omit the v1
	// exec routes. Use agentfactory.FromEnv at startup; tests pass
	// fake / unavailable factories explicitly.
	AgentFactory agentfactory.Factory
}

const defaultBodyLimit int64 = 1 << 20

// Server bundles the chi router, the resolved Config, and the
// http.Server-ready handler.
type Server struct {
	cfg     Config
	handler http.Handler
	cancels *cancelRegistry
}

// CancelRegistry exposes the process-local cancel registry so the
// graceful-shutdown path in cmd/meowthd serve can fire every
// running session's CancelFunc before the daemon exits.
func (s *Server) CancelRegistry() *cancelRegistry { return s.cancels }

// New builds the Server with the canonical middleware chain. Returns
// an error when the config is missing required dependencies.
func New(cfg Config) (*Server, error) {
	if cfg.DB == nil {
		return nil, errors.New("server: nil DB")
	}
	if cfg.AgentFactory == nil {
		return nil, errors.New("server: nil AgentFactory; pass agentfactory.FromEnv result or a test fake")
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.BodyLimit == 0 {
		cfg.BodyLimit = defaultBodyLimit
	}
	if cfg.AuthConfig.DB == nil {
		cfg.AuthConfig.DB = cfg.DB
	}

	bearer, err := auth.Middleware(cfg.AuthConfig)
	if err != nil {
		return nil, fmt.Errorf("server: build auth middleware: %w", err)
	}

	r := chi.NewRouter()
	// Chain order locked by docs/architecture/02 §12 + docs/
	// architecture/07 §4.1:
	//   request_id → access_log → recover → nosniff → body_limit
	//   → bearer_auth → router
	// nosniff runs before body_limit so 413 responses also carry
	// the header.
	r.Use(requestIDMiddleware)
	r.Use(accessLogMiddleware(cfg.Logger))
	r.Use(recoverMiddleware(cfg.Logger))
	r.Use(secheaders.Nosniff())
	r.Use(bodyLimitMiddleware(cfg.BodyLimit))
	r.Use(bearer)

	// Routes. /healthz is exempt from bearer per the auth middleware's
	// requiresBearer rule (02 §12); the route still goes through every
	// other middleware (request_id / access_log / recover / body_limit).
	r.Get("/healthz", handlers.Healthz)

	r.Route("/v1/tokens", func(r chi.Router) {
		h := handlers.NewTokensHandler(cfg.DB)
		r.Get("/", h.List)
		r.Post("/", h.Create)
		r.Delete("/{id}", h.Delete)
	})

	// docs/architecture/02 §6 sessions + §4 exec endpoints. The
	// cancel registry is process-local — see CancelRegistry().
	cancels := newCancelRegistry()
	sessionsH := &handlers.SessionsHandler{
		DB:     cfg.DB,
		Logger: cfg.Logger,
		Cancel: func(sessionID string) handlers.CancelOutcome {
			switch cancels.Cancel(sessionID) {
			case CancelOutcomeFired:
				return handlers.CancelOutcomeFired
			case CancelOutcomeAlreadyRequested:
				return handlers.CancelOutcomeAlreadyRequested
			default:
				return handlers.CancelOutcomeUnknown
			}
		},
	}
	agentsH := &handlers.AgentsHandler{
		Factory: cfg.AgentFactory,
		Logger:  cfg.Logger,
	}
	execH := &handlers.AgentExecHandler{
		DB:      cfg.DB,
		Factory: cfg.AgentFactory,
		Logger:  cfg.Logger,
		Runner:  newPumpRunner(cfg.DB, cancels),
		RegisterCancel: func(sessionID string, cancel context.CancelFunc) func() {
			return cancels.Register(sessionID, cancel)
		},
	}
	r.Get("/v1/agents", agentsH.List)
	r.Post("/v1/agents/{type}/exec", execH.Exec)
	r.Route("/v1/sessions", func(r chi.Router) {
		r.Get("/", sessionsH.List)
		r.Get("/{id}", sessionsH.Get)
		r.Get("/{id}/messages", sessionsH.Messages)
		r.Post("/{id}/cancel", sessionsH.CancelHandler)
	})

	// docs/architecture/04 §6.1 — POST /bootstrap/mint is mounted
	// only when the startup probe surfaced an open mint window.
	// When nil, the router-level NotFound returns the standard
	// /problems/not_found 404 (locked by
	// TestUnmountedBootstrapMintRoutesToGenericNotFound).
	if cfg.MintWindow != nil {
		mh := handlers.NewMintHandler(cfg.MintWindow, cfg.DB, cfg.Logger)
		r.Post("/bootstrap/mint", mh.Mint)
	}

	// 404 / 405 fall through to problem+json defaults; chi's default
	// 404 returns "404 page not found" plaintext, so we override.
	r.NotFound(handlers.NotFound)
	r.MethodNotAllowed(handlers.MethodNotAllowed)

	return &Server{cfg: cfg, handler: r, cancels: cancels}, nil
}

// Handler returns the assembled http.Handler. Tests use this directly
// with httptest.NewRequest.
func (s *Server) Handler() http.Handler { return s.handler }

// Serve binds the listener and runs the HTTP server until ctx is
// cancelled. The returned error wraps a shutdown error if the graceful
// shutdown deadline expires.
//
// The chosen listener is returned via listenerReady (when non-nil) so
// callers like the `serve` CLI subcommand can print the bound address
// once the OS has allocated a port (when bind requested :0).
func (s *Server) Serve(ctx context.Context, listener net.Listener, listenerReady func(net.Addr)) error {
	if listener == nil {
		return errors.New("server: nil listener")
	}
	httpServer := &http.Server{
		Handler:           s.handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if listenerReady != nil {
		listenerReady(listener.Addr())
	}
	errCh := make(chan error, 1)
	go func() {
		errCh <- httpServer.Serve(listener)
	}()
	select {
	case <-ctx.Done():
		// docs/architecture/02 §8.1 shutdown ordering:
		//   1. Close the listener so no new connections /
		//      Register calls slip in between CancelAll and
		//      Shutdown.
		//   2. CancelAll active exec contexts so backends learn
		//      to stop immediately (this also marks each
		//      affected session as shutdown so the pump's
		//      finalizeStream writes status=aborted).
		//   3. Shutdown drains in-flight handlers with a grace
		//      window. CancelAll'd pumps return promptly.
		_ = listener.Close()
		n := s.cancels.CancelAll()
		if n > 0 {
			s.cfg.Logger.Info("shutdown: cancelled active exec streams", "count", n)
		}
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("server: shutdown: %w", err)
		}
		<-errCh
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("server: serve: %w", err)
	}
}

// Listen is a thin convenience that resolves and binds addr (typically
// "127.0.0.1:7777" or "127.0.0.1:0" for OS-allocated). Tests use it to
// get a *net.Listener whose Addr() reflects the actually-bound port.
func Listen(addr string) (net.Listener, error) {
	if addr == "" {
		return nil, errors.New("server: empty listen addr")
	}
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("server: listen %s: %w", addr, err)
	}
	if _, ok := l.Addr().(*net.TCPAddr); !ok {
		_ = l.Close()
		return nil, fmt.Errorf("server: unexpected listener type %T", l.Addr())
	}
	return l, nil
}
