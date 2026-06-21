package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// scopedDB provisions a private test home + opened store under
// MEOWTH_TEST=1, runs migrations, and returns the *sql.DB. The
// helper is local to this package so the auth tests do not depend
// on store's internal openTestStore export.
func scopedDB(t *testing.T) *sql.DB {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))
	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}
	bs, err := sql.Open(store.DriverName(), "file:"+h.DBPath)
	if err != nil {
		t.Fatalf("bootstrap sql.Open: %v", err)
	}
	if err := store.EnsureTestMarker(context.Background(), bs); err != nil {
		t.Fatalf("EnsureTestMarker: %v", err)
	}
	_ = bs.Close()
	db, err := store.Open(context.Background(), h)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// insertToken plants one tokens row and returns the cleartext secret,
// the persisted row id, and the digest used. The secret is the only
// way to authenticate against it later.
func insertToken(t *testing.T, db *sql.DB) (secret string, id string) {
	t.Helper()
	sec, salt, hash, err := store.GenerateTokenSecret()
	if err != nil {
		t.Fatalf("GenerateTokenSecret: %v", err)
	}
	row, err := store.InsertToken(context.Background(), db, store.InsertTokenParams{
		Name:       "test",
		Prefix:     store.Prefix(sec),
		TokenHash:  hash,
		Salt:       salt,
		CreatedVia: store.CreatedViaInit,
	})
	if err != nil {
		t.Fatalf("InsertToken: %v", err)
	}
	return sec, row.ID
}

// countingHasher wraps store.Argon2IDKey but counts the number of
// invocations so tests can assert "rows walked" and "dummy ran"
// without measuring wall-clock latency.
type countingHasher struct{ n atomic.Int32 }

func (c *countingHasher) hash(presented, salt []byte) []byte {
	c.n.Add(1)
	return store.Argon2IDKey(presented, salt)
}

// echoHandler is the next-handler used by tests; it copies the token
// id from context into the response body (or empty if absent).
var echoHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	id, _ := TokenIDFromContext(r.Context())
	_, _ = w.Write([]byte(id))
})

func newMiddleware(t *testing.T, db *sql.DB, h *countingHasher, touch func(string)) func(http.Handler) http.Handler {
	t.Helper()
	cfg := Config{DB: db, Hasher: h.hash, TouchHook: touch}
	mw, err := Middleware(cfg)
	if err != nil {
		t.Fatalf("Middleware: %v", err)
	}
	return mw
}

func doRequest(t *testing.T, mw func(http.Handler) http.Handler, authz string) (*httptest.ResponseRecorder, *http.Request) {
	t.Helper()
	return doRequestMethodPath(t, mw, http.MethodGet, "/v1/tokens", authz)
}

func doRequestMethodPath(t *testing.T, mw func(http.Handler) http.Handler, method, path, authz string) (*httptest.ResponseRecorder, *http.Request) {
	t.Helper()
	r := httptest.NewRequest(method, path, nil)
	if authz != "" {
		r.Header.Set("Authorization", authz)
	}
	rr := httptest.NewRecorder()
	mw(echoHandler).ServeHTTP(rr, r)
	return rr, r
}

func assertProblemJSON(t *testing.T, rr *httptest.ResponseRecorder, wantStatus int, wantKind problem.Kind) {
	t.Helper()
	if rr.Code != wantStatus {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, wantStatus, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); got != problem.ContentType {
		t.Fatalf("content-type = %q, want %q", got, problem.ContentType)
	}
	var b problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if b.Type != string(wantKind) {
		t.Fatalf("type = %q, want %q", b.Type, wantKind)
	}
	if b.Status != wantStatus {
		t.Fatalf("body.status = %d, want %d", b.Status, wantStatus)
	}
}

func TestMiddlewareRejectsMissingHeader(t *testing.T) {
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)
	rr, _ := doRequest(t, mw, "")
	assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
	if h.n.Load() != 0 {
		t.Fatalf("hasher calls = %d, want 0 (format reject must not query DB or hash)", h.n.Load())
	}
}

func TestMiddlewareRejectsBadScheme(t *testing.T) {
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)
	for _, header := range []string{
		"Basic xxx",
		"Token mwt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"bearer mwt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // lowercase
	} {
		t.Run(header, func(t *testing.T) {
			rr, _ := doRequest(t, mw, header)
			assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
		})
	}
	if h.n.Load() != 0 {
		t.Fatalf("hasher calls = %d, want 0", h.n.Load())
	}
}

func TestMiddlewareRejectsBadLengthOrPrefix(t *testing.T) {
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)
	for _, bad := range []string{
		"mwt_short",
		"mws_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"xyz_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		strings.Repeat("A", 60), // way too long, missing prefix
	} {
		t.Run(bad, func(t *testing.T) {
			rr, _ := doRequest(t, mw, "Bearer "+bad)
			assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
		})
	}
	if h.n.Load() != 0 {
		t.Fatalf("hasher calls = %d, want 0 (format reject)", h.n.Load())
	}
}

func TestMiddlewarePrefixNoRowRunsExactlyOneDummy(t *testing.T) {
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)
	// Valid-looking but unknown token: hashing must run exactly once
	// against the dummy salt.
	unknown := "mwt_" + strings.Repeat("A", store.SecretBase32Len)
	rr, _ := doRequest(t, mw, "Bearer "+unknown)
	assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
	if got := h.n.Load(); got != 1 {
		t.Fatalf("hasher calls = %d, want 1 (dummy)", got)
	}
}

func TestMiddlewareValidTokenAcceptsAndExposesID(t *testing.T) {
	db := scopedDB(t)
	h := &countingHasher{}
	gotTouch := make(chan string, 1)
	mw := newMiddleware(t, db, h, func(id string) { gotTouch <- id })

	secret, id := insertToken(t, db)
	rr, _ := doRequest(t, mw, "Bearer "+secret)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != id {
		t.Fatalf("body = %q, want token id %q (ctx not propagated)", got, id)
	}
	if got := h.n.Load(); got != 1 {
		t.Fatalf("hasher calls = %d, want 1 (single matching row)", got)
	}

	// last_used_at update fires asynchronously; the TouchHook proves
	// the goroutine ran. Then verify the DB column is non-NULL too.
	select {
	case touchedID := <-gotTouch:
		if touchedID != id {
			t.Fatalf("TouchHook id = %q, want %q", touchedID, id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("TouchHook never fired within 2s")
	}
	rows, err := store.ListActiveTokensByPrefix(context.Background(), db, store.Prefix(secret))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("active rows = %d, want 1", len(rows))
	}
	if rows[0].LastUsedAt == nil {
		t.Fatalf("last_used_at still NULL after async touch")
	}
}

func TestMiddlewareRevokedTokenRejectedAsDummy(t *testing.T) {
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)

	secret, id := insertToken(t, db)
	ok, _, err := store.RevokeToken(context.Background(), db, id)
	if err != nil || !ok {
		t.Fatalf("RevokeToken: ok=%v err=%v", ok, err)
	}

	rr, _ := doRequest(t, mw, "Bearer "+secret)
	assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
	if got := h.n.Load(); got != 1 {
		t.Fatalf("hasher calls = %d, want 1 (revoked row not returned; one dummy)", got)
	}
}

func TestMiddlewarePrefixCollisionWalksAllRowsAndStillMatches(t *testing.T) {
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)

	// Plant two tokens with the SAME indexed prefix. Prefix uniqueness
	// is not enforced at the schema level (docs/architecture/03 §4.3),
	// so we forge the collision by reusing the first secret's prefix
	// on the second row even though the second row's hash material
	// belongs to a different secret. The auth path must walk both
	// rows even after a match is found, so the hasher is called
	// exactly twice. We send the first secret so the match arrives
	// on iteration 1; the second row's hash/salt still get hashed
	// (and rejected) on iteration 2 to confirm no short-circuit.
	first, salt1, hash1, _ := store.GenerateTokenSecret()
	pfx := store.Prefix(first)
	rowA, err := store.InsertToken(context.Background(), db, store.InsertTokenParams{
		Name:       "row-a",
		Prefix:     pfx,
		TokenHash:  hash1,
		Salt:       salt1,
		CreatedVia: store.CreatedViaInit,
	})
	if err != nil {
		t.Fatalf("insert a: %v", err)
	}
	_, salt2, hash2, _ := store.GenerateTokenSecret()
	if _, err := store.InsertToken(context.Background(), db, store.InsertTokenParams{
		Name:       "row-b",
		Prefix:     pfx, // forced collision; hash/salt belong to a different secret
		TokenHash:  hash2,
		Salt:       salt2,
		CreatedVia: store.CreatedViaInit,
	}); err != nil {
		t.Fatalf("insert b: %v", err)
	}

	rr, _ := doRequest(t, mw, "Bearer "+first)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != rowA.ID {
		t.Fatalf("body = %q, want token id %q", got, rowA.ID)
	}
	if got := h.n.Load(); got != 2 {
		t.Fatalf("hasher calls = %d, want 2 (both colliding rows walked, no short-circuit)", got)
	}
}

func TestMiddlewarePrefixRowsButNoMatchSkipsDummy(t *testing.T) {
	// Edge case: rows exist for the prefix but none hash-match. The
	// middleware already paid len(rows) verifications; adding a
	// dummy on top would over-pay. Lock the implementation's choice
	// (skip dummy) here so the optimisation does not silently flip.
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)

	// Plant one row with a known secret; then auth with a different
	// secret whose prefix happens to collide via brute-force search.
	_, salt, hash, _ := store.GenerateTokenSecret()
	const pfx = "mwt_AAAAA"
	if _, err := store.InsertToken(context.Background(), db, store.InsertTokenParams{
		Name:       "row",
		Prefix:     pfx,
		TokenHash:  hash,
		Salt:       salt,
		CreatedVia: store.CreatedViaInit,
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}

	// Construct a fake bearer whose prefix matches but whose digest
	// will not equal the stored hash (different bytes).
	presented := pfx + strings.Repeat("B", store.SecretTotalLen-store.SecretPrefixLen)
	rr, _ := doRequest(t, mw, "Bearer "+presented)
	assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
	if got := h.n.Load(); got != 1 {
		t.Fatalf("hasher calls = %d, want 1 (one real verify against the colliding row, no extra dummy)", got)
	}
}

func TestMiddlewareRejectsNilDB(t *testing.T) {
	_, err := Middleware(Config{DB: nil})
	if err == nil {
		t.Fatal("Middleware accepted nil DB")
	}
}

func TestRedactedPrefix(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"", "<invalid>"},
		{"mwt_", "<invalid>"},
		{"mwt_ABCD", "<invalid>"}, // < 9
		{"xyz_ABCDE", "<invalid>"},
		{"mwt_ABCDEFGHIJKL", "mwt_ABCDE"},
	} {
		t.Run(tc.in, func(t *testing.T) {
			if got := RedactedPrefix(tc.in); got != tc.want {
				t.Fatalf("RedactedPrefix(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestTokenIDFromContextFalseOnEmpty(t *testing.T) {
	if _, ok := TokenIDFromContext(context.Background()); ok {
		t.Fatal("TokenIDFromContext on empty ctx returned true")
	}
	if _, ok := TokenIDFromContext(nil); ok { //nolint:staticcheck // explicit nil-ctx defensiveness
		t.Fatal("TokenIDFromContext on nil ctx returned true")
	}
}

func TestMiddlewarePassesThroughNonV1Paths(t *testing.T) {
	// docs/architecture/02 §12: bearer middleware protects /v1/* only.
	// /healthz, /, /bootstrap/*, /problems/*, and static must reach
	// next handler without DB queries or hasher calls even without
	// an Authorization header.
	db := scopedDB(t)
	for _, path := range []string{
		"/healthz",
		"/",
		"/bootstrap/mint",
		"/problems/unauthorized",
		"/some/static/asset.js",
	} {
		t.Run(path, func(t *testing.T) {
			h := &countingHasher{}
			mw := newMiddleware(t, db, h, nil)
			rr, _ := doRequestMethodPath(t, mw, http.MethodGet, path, "")
			if rr.Code != http.StatusOK {
				t.Fatalf("%s: status = %d, want 200 (body=%s)", path, rr.Code, rr.Body.String())
			}
			if got := h.n.Load(); got != 0 {
				t.Fatalf("%s: hasher calls = %d, want 0", path, got)
			}
		})
	}
}

func TestMiddlewarePassesThroughOptionsPreflight(t *testing.T) {
	// 02 §12: OPTIONS preflight is exempt regardless of path. CORS
	// preflight does not carry Authorization, so requiring bearer
	// here would break the only chance browsers have to negotiate
	// CORS for /v1/*.
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)
	rr, _ := doRequestMethodPath(t, mw, http.MethodOptions, "/v1/tokens", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("OPTIONS /v1/tokens: status = %d, want 200", rr.Code)
	}
	if got := h.n.Load(); got != 0 {
		t.Fatalf("hasher calls = %d, want 0 for OPTIONS preflight", got)
	}
}

func TestMiddlewareStillEnforcesV1WithoutAuthz(t *testing.T) {
	// Regression guard: the exemption above must NOT relax /v1/*.
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)
	rr, _ := doRequestMethodPath(t, mw, http.MethodGet, "/v1/tokens", "")
	assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
	if got := h.n.Load(); got != 0 {
		t.Fatalf("hasher calls = %d, want 0 for missing header", got)
	}
}

func TestMiddlewareEnforcesV1RootPath(t *testing.T) {
	// /v1 (no trailing slash) is also a v1-protected path; some
	// routers map it to /v1/.
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)
	rr, _ := doRequestMethodPath(t, mw, http.MethodGet, "/v1", "")
	assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
	if got := h.n.Load(); got != 0 {
		t.Fatalf("hasher calls = %d, want 0", got)
	}
}

func TestExtractBearerRejectsWhitespaceVariants(t *testing.T) {
	// 03 §5.1 wire contract: `Bearer <43-char mwt_ token>` exactly.
	// We must NOT trim whitespace; trailing/leading bytes break the
	// length+prefix check and surface as 401 with calls=0.
	db := scopedDB(t)
	h := &countingHasher{}
	mw := newMiddleware(t, db, h, nil)
	tok := "mwt_" + strings.Repeat("A", store.SecretBase32Len)
	for _, header := range []string{
		"Bearer  " + tok,       // double space after scheme
		"Bearer\t" + tok,       // tab after scheme
		"Bearer " + tok + " ",  // trailing space
		"Bearer " + tok + "\t", // trailing tab
		"Bearer " + tok + "\n", // trailing newline
	} {
		t.Run(header, func(t *testing.T) {
			rr, _ := doRequest(t, mw, header)
			assertProblemJSON(t, rr, http.StatusUnauthorized, problem.KindUnauthorized)
		})
	}
	if got := h.n.Load(); got != 0 {
		t.Fatalf("hasher calls = %d, want 0 (length/prefix should fail before any hash)", got)
	}
}

// belt-and-braces: stop the linter from removing the errors import
// after we delete a previous defensive use.
var _ = errors.New
