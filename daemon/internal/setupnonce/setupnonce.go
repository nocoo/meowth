// Package setupnonce owns the on-disk shape of the setup_nonce.hash
// file (located under the daemon home's runtime/ directory; see
// home.Home.SetupNoncePath) per docs/architecture/04 §4.2 and the
// strict parser daemon's bootstrap mint window uses to load it.
//
// The file is parameter-agile: the argon2id memory_kib / time_cost /
// parallelism values are taken verbatim from the file so that
// `meowthd init --skip-token` and `meowthd serve` can be on
// different revisions without losing mint compatibility. The parser
// only enforces version == 19 (argon2 v1.3) and > 0 lower bounds on
// the cost parameters; everything else (salt / digest lengths) is
// pinned to the store.Argon2* constants.
//
// Two callers consume this package:
//   - internal/initcmd (path B writer) → WriteSetupNonce.
//   - internal/server/mint Probe (daemon startup reader) →
//     ParseSetupNonce.
package setupnonce

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// Payload is the exact docs/architecture/04 §4.2 JSON object.
type Payload struct {
	Algorithm   string `json:"algorithm"`
	Version     uint32 `json:"version"`
	MemoryKiB   uint32 `json:"memory_kib"`
	TimeCost    uint32 `json:"time_cost"`
	Parallelism uint8  `json:"parallelism"`
	SaltB64     string `json:"salt_b64"`
	DigestB64   string `json:"digest_b64"`
	CreatedAt   int64  `json:"created_at"`
	OneShot     bool   `json:"one_shot"`
}

// Parsed is the decoded + validated payload with salt/digest already
// base64-decoded into byte slices. Callers (mint Probe / handler)
// use Salt + Digest directly without re-decoding.
type Parsed struct {
	Payload Payload
	Salt    []byte
	Digest  []byte
}

// Write serialises a single-line JSON Payload to path with 0600
// mode per docs/architecture/04 §4.2. Single-line is the documented
// invariant — `encoding/json.Marshal` already produces compact
// output so this is automatic.
func Write(path string, salt, digest []byte) error {
	if len(salt) != store.Argon2SaltLen {
		return fmt.Errorf("setupnonce: salt must be %d bytes, got %d", store.Argon2SaltLen, len(salt))
	}
	if len(digest) != int(store.Argon2KeyLen) {
		return fmt.Errorf("setupnonce: digest must be %d bytes, got %d", store.Argon2KeyLen, len(digest))
	}
	p := Payload{
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
		return fmt.Errorf("setupnonce: marshal: %w", err)
	}
	if err := os.WriteFile(path, body, home.FileMode); err != nil {
		return fmt.Errorf("setupnonce: write: %w", err)
	}
	if err := home.EnsureFileMode(path, home.FileMode); err != nil {
		return err
	}
	return nil
}

// Parse reads and validates a setup_nonce.hash file. Validation
// rules per docs/architecture/04 §4.2:
//   - JSON object decodes with DisallowUnknownFields.
//   - No trailing data after the first object (a second Decode
//     must return io.EOF; this is what reliably catches `{...}{...}`).
//   - algorithm must be "argon2id".
//   - one_shot must be true.
//   - version must equal store.Argon2Version (19).
//   - memory_kib / time_cost / parallelism / created_at must be > 0.
//   - salt and digest base64 decode to the expected byte lengths.
//
// Parameter-agility: we only > 0 check the cost parameters here,
// not strict equality with current constants. The values inside
// the file are what mint must invoke argon2 with.
func Parse(path string) (*Parsed, error) {
	body, err := os.ReadFile(path) //nolint:gosec // path is derived from the daemon's home root
	if err != nil {
		return nil, fmt.Errorf("setupnonce: read: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	var p Payload
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("setupnonce: decode: %w", err)
	}
	var sink json.RawMessage
	if err := dec.Decode(&sink); !errors.Is(err, io.EOF) {
		return nil, errors.New("setupnonce: trailing data after JSON object")
	}
	if p.Algorithm != "argon2id" {
		return nil, fmt.Errorf("setupnonce: algorithm %q not supported", p.Algorithm)
	}
	if !p.OneShot {
		return nil, errors.New("setupnonce: one_shot must be true")
	}
	if p.Version != store.Argon2Version {
		return nil, fmt.Errorf("setupnonce: version %d != %d", p.Version, store.Argon2Version)
	}
	if p.MemoryKiB == 0 {
		return nil, errors.New("setupnonce: memory_kib must be > 0")
	}
	if p.TimeCost == 0 {
		return nil, errors.New("setupnonce: time_cost must be > 0")
	}
	if p.Parallelism == 0 {
		return nil, errors.New("setupnonce: parallelism must be > 0")
	}
	if p.CreatedAt <= 0 {
		return nil, errors.New("setupnonce: created_at must be > 0")
	}
	salt, err := base64.StdEncoding.DecodeString(p.SaltB64)
	if err != nil {
		return nil, fmt.Errorf("setupnonce: decode salt: %w", err)
	}
	if len(salt) != store.Argon2SaltLen {
		return nil, fmt.Errorf("setupnonce: salt decoded length %d != %d", len(salt), store.Argon2SaltLen)
	}
	digest, err := base64.StdEncoding.DecodeString(p.DigestB64)
	if err != nil {
		return nil, fmt.Errorf("setupnonce: decode digest: %w", err)
	}
	if len(digest) != int(store.Argon2KeyLen) {
		return nil, fmt.Errorf("setupnonce: digest decoded length %d != %d", len(digest), store.Argon2KeyLen)
	}
	return &Parsed{Payload: p, Salt: salt, Digest: digest}, nil
}
