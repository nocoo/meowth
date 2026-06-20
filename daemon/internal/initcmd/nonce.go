package initcmd

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"time"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// SetupNoncePayload is the exact JSON shape docs/architecture/04
// §4.2 declares for setup_nonce.hash. Fields are documented in order;
// daemon's mint window reader (Phase 3.8 / task #5) parses the same
// shape with the same strictness.
type SetupNoncePayload struct {
	Algorithm   string `json:"algorithm"` // fixed "argon2id"
	Version     uint32 `json:"version"`   // argon2 v1.3 → decimal 19
	MemoryKiB   uint32 `json:"memory_kib"`
	TimeCost    uint32 `json:"time_cost"`
	Parallelism uint8  `json:"parallelism"`
	SaltB64     string `json:"salt_b64"`
	DigestB64   string `json:"digest_b64"`
	CreatedAt   int64  `json:"created_at"`
	OneShot     bool   `json:"one_shot"`
}

// WriteSetupNonce serialises the docs/architecture/04 §4.2 JSON
// object onto disk at path with mode 0600. Single-line JSON (no
// pretty-print) is the documented invariant.
func WriteSetupNonce(path string, salt, digest []byte) error {
	if len(salt) != store.Argon2SaltLen {
		return fmt.Errorf("initcmd: salt must be %d bytes, got %d", store.Argon2SaltLen, len(salt))
	}
	if len(digest) != int(store.Argon2KeyLen) {
		return fmt.Errorf("initcmd: digest must be %d bytes, got %d", store.Argon2KeyLen, len(digest))
	}
	p := SetupNoncePayload{
		Algorithm:   "argon2id",
		Version:     store.Argon2Version,
		MemoryKiB:   store.Argon2Memory,
		TimeCost:    store.Argon2Time,
		Parallelism: store.Argon2Parallelism,
		SaltB64:     base64.StdEncoding.EncodeToString(salt),
		DigestB64:   base64.StdEncoding.EncodeToString(digest),
		CreatedAt:   time.Now().UTC().Unix(),
		OneShot:     true,
	}
	body, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("initcmd: marshal setup nonce: %w", err)
	}
	if err := os.WriteFile(path, body, home.FileMode); err != nil {
		return fmt.Errorf("initcmd: write setup nonce: %w", err)
	}
	// Re-assert 0600 in case umask widened it.
	if err := home.EnsureFileMode(path, home.FileMode); err != nil {
		return err
	}
	return nil
}

// ParseSetupNonce reads and validates a setup_nonce.hash file. Used
// by tests today; Phase 3.8 mintWindow loader will reuse the same
// strictness. Validation rules:
//   - JSON object decodes with DisallowUnknownFields.
//   - No trailing data after the first object (a second Decode must
//     return io.EOF; this is what reliably catches `{...}{...}` etc.).
//   - algorithm must be "argon2id".
//   - one_shot must be true.
//   - version must equal store.Argon2Version (19).
//   - memory_kib / time_cost / parallelism / created_at must be > 0.
//   - salt and digest base64 decode to the expected byte lengths.
//
// Per docs/architecture/04 §4.2 the file is "parameter-agile": the
// memory_kib / time_cost / parallelism values inside the file are what
// argon2 must be invoked with. We therefore only check > 0 here, not
// strict equality, so future writers can rotate parameters without
// rewriting this parser. version is a different story — it identifies
// the argon2 algorithm revision and is currently locked at 19.
func ParseSetupNonce(path string) (*SetupNoncePayload, error) {
	body, err := os.ReadFile(path) //nolint:gosec // initcmd derives path from home.SetupNoncePath under the meowth-owned root
	if err != nil {
		return nil, fmt.Errorf("initcmd: read setup nonce: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	var p SetupNoncePayload
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("initcmd: decode setup nonce: %w", err)
	}
	// Reject any trailing data; json.Decoder.More only inspects the
	// current array/object level, so an extra top-level object slips
	// past it. The canonical pattern is to Decode a sink and require
	// io.EOF.
	var sink json.RawMessage
	if err := dec.Decode(&sink); !errors.Is(err, io.EOF) {
		return nil, errors.New("initcmd: setup nonce: trailing data after JSON object")
	}
	if p.Algorithm != "argon2id" {
		return nil, fmt.Errorf("initcmd: setup nonce: algorithm %q not supported", p.Algorithm)
	}
	if !p.OneShot {
		return nil, errors.New("initcmd: setup nonce: one_shot must be true")
	}
	if p.Version != store.Argon2Version {
		return nil, fmt.Errorf("initcmd: setup nonce: version %d != %d", p.Version, store.Argon2Version)
	}
	if p.MemoryKiB == 0 {
		return nil, errors.New("initcmd: setup nonce: memory_kib must be > 0")
	}
	if p.TimeCost == 0 {
		return nil, errors.New("initcmd: setup nonce: time_cost must be > 0")
	}
	if p.Parallelism == 0 {
		return nil, errors.New("initcmd: setup nonce: parallelism must be > 0")
	}
	if p.CreatedAt <= 0 {
		return nil, errors.New("initcmd: setup nonce: created_at must be > 0")
	}
	salt, err := base64.StdEncoding.DecodeString(p.SaltB64)
	if err != nil {
		return nil, fmt.Errorf("initcmd: decode salt: %w", err)
	}
	if len(salt) != store.Argon2SaltLen {
		return nil, fmt.Errorf("initcmd: salt decoded length %d != %d", len(salt), store.Argon2SaltLen)
	}
	digest, err := base64.StdEncoding.DecodeString(p.DigestB64)
	if err != nil {
		return nil, fmt.Errorf("initcmd: decode digest: %w", err)
	}
	if len(digest) != int(store.Argon2KeyLen) {
		return nil, fmt.Errorf("initcmd: digest decoded length %d != %d", len(digest), store.Argon2KeyLen)
	}
	return &p, nil
}

// buildBootstrapDSN replicates store.buildDSN's URL-escape contract
// without importing the unexported helper. Used only to create the
// _test_marker row before store.Open's verifyTestStore runs.
func buildBootstrapDSN(path string) (string, error) {
	u := &url.URL{Scheme: "file", Path: path}
	return u.String(), nil
}
