package mint

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/setupnonce"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// newTestDB stands up a fresh test home + opened *sql.DB so probe
// SQL queries land against a real schema. Each test gets its own
// temp dir.
func newTestDB(t *testing.T) (*home.Home, *sql.DB) {
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
		t.Fatalf("bootstrap open: %v", err)
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
	return h, db
}

// seedToken inserts a single dummy token so the tokens table is
// non-empty (used to exercise the §5.3 stale-cleanup branch).
func seedToken(t *testing.T, db *sql.DB) {
	t.Helper()
	secret, salt, hash, err := store.GenerateTokenSecret()
	if err != nil {
		t.Fatalf("GenerateTokenSecret: %v", err)
	}
	if _, err := store.InsertToken(context.Background(), db, store.InsertTokenParams{
		Name:       "seed",
		Prefix:     store.Prefix(secret),
		TokenHash:  hash,
		Salt:       salt,
		CreatedVia: store.CreatedViaInit,
	}); err != nil {
		t.Fatalf("InsertToken: %v", err)
	}
}

func newProbeLogger() (*slog.Logger, *strings.Builder) {
	var sink strings.Builder
	return slog.New(slog.NewJSONHandler(&sink, nil)), &sink
}

func writeValidNonce(t *testing.T, path string) {
	t.Helper()
	salt := make([]byte, store.Argon2SaltLen)
	for i := range salt {
		salt[i] = byte(i + 1)
	}
	// digest does not need to match any particular code for Probe;
	// only Parse's structural validation needs to pass.
	digest := make([]byte, store.Argon2KeyLen)
	for i := range digest {
		digest[i] = byte(i + 200)
	}
	if err := setupnonce.Write(path, salt, digest); err != nil {
		t.Fatalf("setupnonce.Write: %v", err)
	}
}

func TestProbeRejectsNilArgs(t *testing.T) {
	if _, err := Probe(context.Background(), ProbeInput{}); err == nil {
		t.Fatal("Probe accepted nil home")
	}
}

func TestProbeRemoteMode(t *testing.T) {
	h, db := newTestDB(t)
	logger, sink := newProbeLogger()
	w, err := Probe(context.Background(), ProbeInput{
		Home:    h,
		DB:      db,
		IsLocal: false,
		Logger:  logger,
	})
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if w != nil {
		t.Fatal("Probe returned window for remote mode")
	}
	if !strings.Contains(sink.String(), "remote_access_mode") {
		t.Fatalf("missing reason: %s", sink.String())
	}
}

func TestProbeTokensNonEmptyClosesWindow(t *testing.T) {
	h, db := newTestDB(t)
	seedToken(t, db)
	logger, sink := newProbeLogger()
	w, err := Probe(context.Background(), ProbeInput{
		Home:    h,
		DB:      db,
		IsLocal: true,
		Logger:  logger,
	})
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if w != nil {
		t.Fatal("Probe returned window despite tokens non-empty")
	}
	if !strings.Contains(sink.String(), "token_exists") {
		t.Fatalf("missing reason: %s", sink.String())
	}
}

func TestProbeStaleCleanupRemovesNonceWhenTokensNonEmpty(t *testing.T) {
	h, db := newTestDB(t)
	seedToken(t, db)
	if err := os.MkdirAll(filepath.Dir(h.SetupNoncePath), 0o700); err != nil {
		t.Fatalf("mkdir runtime: %v", err)
	}
	writeValidNonce(t, h.SetupNoncePath)
	logger, sink := newProbeLogger()
	w, err := Probe(context.Background(), ProbeInput{
		Home:    h,
		DB:      db,
		IsLocal: true,
		Logger:  logger,
	})
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if w != nil {
		t.Fatal("Probe returned window after stale cleanup")
	}
	if _, err := os.Stat(h.SetupNoncePath); !os.IsNotExist(err) {
		t.Fatalf("stale nonce still on disk: %v", err)
	}
	if !strings.Contains(sink.String(), "cleaned stale setup_nonce.hash") {
		t.Fatalf("missing cleanup log: %s", sink.String())
	}
}

func TestProbeNoNonceFileClosesWindow(t *testing.T) {
	h, db := newTestDB(t)
	logger, sink := newProbeLogger()
	w, err := Probe(context.Background(), ProbeInput{
		Home:    h,
		DB:      db,
		IsLocal: true,
		Logger:  logger,
	})
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if w != nil {
		t.Fatal("Probe returned window despite missing nonce file")
	}
	if !strings.Contains(sink.String(), "no_nonce_file") {
		t.Fatalf("missing reason: %s", sink.String())
	}
}

func TestProbeInvalidNonceLeavesFileOnDisk(t *testing.T) {
	h, db := newTestDB(t)
	if err := os.MkdirAll(filepath.Dir(h.SetupNoncePath), 0o700); err != nil {
		t.Fatalf("mkdir runtime: %v", err)
	}
	// Corrupt payload — algorithm wrong.
	body := []byte(`{"algorithm":"sha256","version":19,"memory_kib":65536,"time_cost":3,"parallelism":4,"salt_b64":"AAAAAAAAAAAAAAAAAAAAAA==","digest_b64":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","created_at":1,"one_shot":true}`)
	if err := os.WriteFile(h.SetupNoncePath, body, home.FileMode); err != nil {
		t.Fatalf("write: %v", err)
	}
	logger, sink := newProbeLogger()
	w, err := Probe(context.Background(), ProbeInput{
		Home:    h,
		DB:      db,
		IsLocal: true,
		Logger:  logger,
	})
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if w != nil {
		t.Fatal("Probe returned window for invalid nonce")
	}
	if _, err := os.Stat(h.SetupNoncePath); err != nil {
		t.Fatalf("invalid nonce was deleted: %v", err)
	}
	if !strings.Contains(sink.String(), "nonce_invalid") {
		t.Fatalf("missing reason: %s", sink.String())
	}
}

func TestProbeValidNonceOpensWindow(t *testing.T) {
	h, db := newTestDB(t)
	if err := os.MkdirAll(filepath.Dir(h.SetupNoncePath), 0o700); err != nil {
		t.Fatalf("mkdir runtime: %v", err)
	}
	writeValidNonce(t, h.SetupNoncePath)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	w, err := Probe(context.Background(), ProbeInput{
		Home:    h,
		DB:      db,
		IsLocal: true,
		Logger:  logger,
	})
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if w == nil {
		t.Fatal("Probe should have returned an open window")
	}
	if w.IsClosed() {
		t.Fatal("Probe returned a window already Closed")
	}
}
