package handlers

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/nocoo/meowth/daemon/internal/server/mint"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// jitter window per docs/architecture/04 §6.5 — counted failures
// sleep 200..500 ms before responding so attackers cannot time the
// branch they hit.
const (
	jitterMinMs = 200
	jitterMaxMs = 500
)

// MintHandler bundles dependencies for POST /bootstrap/mint. The
// Sleep field is injectable so tests can verify jitter range
// without burning wall-clock; production wiring leaves it nil and
// time.Sleep is used.
type MintHandler struct {
	Window *mint.MintWindow
	DB     *sql.DB
	Logger *slog.Logger
	// Sleep is called when a counted failure outcome fires; if nil
	// time.Sleep is used.
	Sleep func(time.Duration)
}

// NewMintHandler is the constructor used by server.New and tests.
func NewMintHandler(w *mint.MintWindow, db *sql.DB, logger *slog.Logger) *MintHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &MintHandler{Window: w, DB: db, Logger: logger}
}

// Mint is the docs/architecture/04 §6 handler. All failures share
// the same 404 problem+json wire shape (§6.5); the reason is only
// logged.
func (h *MintHandler) Mint(w http.ResponseWriter, r *http.Request) {
	defer func() { _ = r.Body.Close() }()

	// §6.2 — socket-level loopback gate. r.RemoteAddr is the
	// connection's actual peer; we deliberately do NOT consult
	// X-Forwarded-For (a proxy would have to live on this host
	// to forward to loopback anyway, and the first-door §5.1
	// step 1 already excludes that case).
	if !isLoopback(r.RemoteAddr) {
		h.notCountedNotFound(w, r, "non_loopback_remote")
		return
	}

	// §6.6 — Origin / Sec-Fetch-Site browser-source gate. Sec-
	// Fetch-Site is browser-only and cannot be forged from JS, so
	// cross-site / same-site flips reject. Origin must match the
	// daemon's r.Host when present (curl etc. send no Origin and
	// pass through).
	if !originGatePasses(r) {
		h.notCountedNotFound(w, r, "origin_gate")
		return
	}

	// Window-level guards. The mint window may have closed (lock-
	// out / consumed) between server.New and this request.
	if h.Window == nil || h.Window.IsClosed() {
		h.notCountedNotFound(w, r, "window_closed")
		return
	}

	// §6.3 step 1 — parse body. body_limit middleware caps the
	// request; an http.MaxBytesError surfaces here as a counted
	// "body too large" failure ALWAYS routes to 413 in middleware
	// already, so by the time we are here the body is ≤ 1 MiB.
	var req struct {
		SetupCode string `json:"setup_code"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			h.notCountedProblem(w, r, http.StatusRequestEntityTooLarge, problem.KindPayloadTooLarge, "request body exceeds the per-request size limit", "body_too_large")
			return
		}
		h.countedFailure(w, r, "body_malformed")
		return
	}
	var sink json.RawMessage
	if err := dec.Decode(&sink); !errors.Is(err, io.EOF) {
		h.countedFailure(w, r, "body_trailing_data")
		return
	}

	// §6.3 step 4 — handler builds the Recheck + Commit callbacks
	// so the entire SQL transaction lives inside MintWindow.Mu.
	// secret/salt/hash are minted upfront so Commit's body is the
	// minimum amount of work under the lock.
	secret, salt, hash, err := store.GenerateTokenSecret()
	if err != nil {
		h.logger().Error("mint: generate token secret", "err", err)
		h.uncountedProblem(w, r, http.StatusInternalServerError, problem.KindInternal, "internal", "mint_internal")
		return
	}
	prefix := store.Prefix(secret)

	var minted *store.Token
	outcome, reason := h.Window.Consume(r.Context(), mint.ConsumeRequest{
		SetupCode: req.SetupCode,
		Recheck: func(ctx context.Context) (bool, error) {
			// Use a fresh transaction here even though we only do a
			// COUNT — keeping the same tx for COUNT + INSERT below
			// is the only way SQLite gives us read-then-write
			// atomicity. We start the tx in Commit so failure paths
			// here do not leave an empty tx open.
			n, err := store.CountTokens(ctx, h.DB)
			if err != nil {
				return false, err
			}
			return n == 0, nil
		},
		Commit: func(ctx context.Context) error {
			tx, err := h.DB.BeginTx(ctx, nil)
			if err != nil {
				return err
			}
			defer func() { _ = tx.Rollback() }()
			n, err := store.CountTokensTx(ctx, tx)
			if err != nil {
				return err
			}
			if n != 0 {
				return errors.New("mint: tokens table populated between recheck and commit")
			}
			tok, err := store.InsertTokenTx(ctx, tx, store.InsertTokenParams{
				Name:       "bootstrap",
				Prefix:     prefix,
				TokenHash:  hash,
				Salt:       salt,
				CreatedVia: store.CreatedViaFirstRunMint,
			})
			if err != nil {
				return err
			}
			if err := tx.Commit(); err != nil {
				return err
			}
			minted = tok
			return nil
		},
	})

	switch outcome {
	case mint.OutcomeOK:
		_ = h.respondSuccess(w, minted, secret)
	case mint.OutcomeFormatError, mint.OutcomeMismatch:
		// Counted + jittered.
		h.jitter()
		h.logger().Info("mint: 404 (counted)", "reason", reason)
		_ = problem.Write(w, http.StatusNotFound, problem.KindNotFound, "Not Found", r.URL.Path)
	case mint.OutcomeRecheckFailed, mint.OutcomeClosed:
		h.logger().Info("mint: 404 (uncounted)", "reason", reason)
		_ = problem.Write(w, http.StatusNotFound, problem.KindNotFound, "Not Found", r.URL.Path)
	case mint.OutcomeInternal:
		h.logger().Error("mint: 404 (internal)", "reason", reason)
		_ = problem.Write(w, http.StatusNotFound, problem.KindNotFound, "Not Found", r.URL.Path)
	}
}

// respondSuccess writes the docs/architecture/04 §4.3 201 body.
// The struct shape is local to keep the contract documented next
// to its serialisation point.
func (h *MintHandler) respondSuccess(w http.ResponseWriter, tok *store.Token, secret string) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "")
	body := struct {
		ID         string    `json:"id"`
		Name       string    `json:"name"`
		Prefix     string    `json:"prefix"`
		Secret     string    `json:"secret"`
		CreatedAt  time.Time `json:"created_at"`
		CreatedVia string    `json:"created_via"`
	}{
		ID:         tok.ID,
		Name:       tok.Name,
		Prefix:     tok.Prefix,
		Secret:     secret,
		CreatedAt:  tok.CreatedAt,
		CreatedVia: string(tok.CreatedVia),
	}
	return enc.Encode(&body) //nolint:gosec // docs/architecture/04 §4.3 mandates one-shot Secret in this exact response
}

func (h *MintHandler) jitter() {
	d := jitterDuration()
	if h.Sleep != nil {
		h.Sleep(d)
		return
	}
	time.Sleep(d)
}

// jitterDuration returns a crypto-rand integer in [200,500] ms.
func jitterDuration() time.Duration {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(jitterMaxMs-jitterMinMs+1)))
	if err != nil {
		// crypto/rand failure on macOS is essentially impossible;
		// pick the max to be safe rather than 0.
		return time.Duration(jitterMaxMs) * time.Millisecond
	}
	return time.Duration(jitterMinMs+int(n.Int64())) * time.Millisecond
}

// countedFailure is the §6.5 row "is" path: counted + jittered.
// The handler itself owns the failure bookkeeping (FailureCount
// belongs to the window, but body-shape errors never run
// Window.Consume — we bump the count here via Consume on a known-
// bad code so the window stays the single source of truth).
//
// Implementation: we call Consume with the same provided code but
// short-circuit by passing a Recheck that should never run, since
// the shape check fails first. This keeps the failure bookkeeping
// in MintWindow.
func (h *MintHandler) countedFailure(w http.ResponseWriter, r *http.Request, reason string) {
	// Convert this branch into a Window.Consume call so the
	// failure counter ticks. We pass an empty setup-code which
	// trivially fails the shape gate inside Consume.
	_, _ = h.Window.Consume(r.Context(), mint.ConsumeRequest{
		SetupCode: "",
		Recheck:   func(context.Context) (bool, error) { return false, errors.New("unreachable") },
		Commit:    func(context.Context) error { return errors.New("unreachable") },
	})
	h.jitter()
	h.logger().Info("mint: 404 (counted)", "reason", reason)
	_ = problem.Write(w, http.StatusNotFound, problem.KindNotFound, "Not Found", r.URL.Path)
}

func (h *MintHandler) notCountedNotFound(w http.ResponseWriter, r *http.Request, reason string) {
	h.logger().Info("mint: 404 (uncounted)", "reason", reason)
	_ = problem.Write(w, http.StatusNotFound, problem.KindNotFound, "Not Found", r.URL.Path)
}

func (h *MintHandler) notCountedProblem(w http.ResponseWriter, r *http.Request, status int, kind problem.Kind, detail, reason string) {
	h.logger().Info("mint: problem", "status", status, "reason", reason)
	_ = problem.Write(w, status, kind, detail, r.URL.Path)
}

func (h *MintHandler) uncountedProblem(w http.ResponseWriter, r *http.Request, status int, kind problem.Kind, detail, reason string) {
	h.logger().Error("mint: problem", "status", status, "reason", reason)
	_ = problem.Write(w, status, kind, detail, r.URL.Path)
}

func (h *MintHandler) logger() *slog.Logger {
	if h.Logger != nil {
		return h.Logger
	}
	return slog.Default()
}

// isLoopback parses the RemoteAddr host and reports whether it is
// 127.0.0.0/8, ::1, or ::ffff:127.0.0.1 form.
func isLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		// httptest sometimes leaves the port off; try the raw value.
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	// IPv4-mapped IPv6 form: ::ffff:127.0.0.1
	if v4 := ip.To4(); v4 != nil && v4.IsLoopback() {
		return true
	}
	return false
}

// originGatePasses applies docs/architecture/04 §6.6.
func originGatePasses(r *http.Request) bool {
	fetchSite := r.Header.Get("Sec-Fetch-Site")
	switch fetchSite {
	case "cross-site", "same-site":
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	expected := "http://" + r.Host
	// Some HTTP clients send Origin with a trailing slash; treat
	// the string match leniently by stripping a single trailing
	// slash from the inbound value.
	if strings.TrimSuffix(origin, "/") == expected {
		return true
	}
	return false
}
