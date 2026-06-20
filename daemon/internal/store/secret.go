package store

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters per docs/architecture/03-sqlite-schema-and-tokens.md §4.4.
const (
	Argon2Memory      uint32 = 65536 // KiB → 64 MiB
	Argon2Time        uint32 = 3
	Argon2Parallelism uint8  = 4
	Argon2KeyLen      uint32 = 32 // bytes
	Argon2SaltLen     int    = 16 // bytes
	Argon2Version     uint32 = 19 // argon2 v1.3 (0x13)

	// SecretEntropyBytes is the raw entropy size of a token / setup-code
	// (192 bits → 24 bytes → 39 base32 chars).
	SecretEntropyBytes = 24
	// SecretBase32Len is the encoded length without padding.
	SecretBase32Len = 39
	// SecretTotalLen is the full secret length including "mwt_"/"mws_" prefix.
	SecretTotalLen = 43
	// SecretPrefixLen is the byte/char length of "mwt_" + 5 chars stored
	// in tokens.prefix for indexed lookup. Per §4.1 / §4.3.
	SecretPrefixLen = 9
)

// secretEncoding is RFC 4648 base32 alphabet (A–Z, 2–7) with NoPadding,
// per §4.2.
var secretEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateTokenSecret returns a fresh root-token secret of the form
// "mwt_" + 39 base32 chars, the random salt used for the argon2id
// digest, and the digest itself.
//
// The caller must keep the secret bytes minimal-lifetime per
// docs/architecture/03 §10.1; this function never logs or persists it.
func GenerateTokenSecret() (secret string, salt, digest []byte, err error) {
	return generateSecret("mwt_")
}

// GenerateSetupCode returns a fresh setup-code of the form
// "mws_" + 39 base32 chars (path B of docs/architecture/04 §4.1).
// Salt and digest are computed against the setup-code so that callers
// (init --skip-token) can persist them in setup_nonce.hash.
func GenerateSetupCode() (code string, salt, digest []byte, err error) {
	return generateSecret("mws_")
}

func generateSecret(prefix string) (string, []byte, []byte, error) {
	raw := make([]byte, SecretEntropyBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, nil, fmt.Errorf("store.secret: rand: %w", err)
	}
	defer zero(raw)

	encoded := secretEncoding.EncodeToString(raw)
	if len(encoded) != SecretBase32Len {
		return "", nil, nil, fmt.Errorf("store.secret: unexpected base32 length %d", len(encoded))
	}
	secret := prefix + encoded
	if len(secret) != SecretTotalLen {
		return "", nil, nil, fmt.Errorf("store.secret: unexpected total length %d", len(secret))
	}

	salt := make([]byte, Argon2SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", nil, nil, fmt.Errorf("store.secret: salt rand: %w", err)
	}
	// secretBytes is the temporary []byte view of `secret` we pass into
	// argon2. Per docs/architecture/03 §10.1 we zero this best-effort
	// copy as soon as the digest is computed; the Go string `secret`
	// itself is immutable and remains in caller-controlled lifetime.
	secretBytes := []byte(secret)
	digest := Argon2IDKey(secretBytes, salt)
	zero(secretBytes)
	return secret, salt, digest, nil
}

// Argon2IDKey wraps argon2.IDKey with the locked parameters from §4.4
// so callers cannot accidentally drift.
func Argon2IDKey(password, salt []byte) []byte {
	return argon2.IDKey(password, salt, Argon2Time, Argon2Memory, Argon2Parallelism, Argon2KeyLen)
}

// Prefix returns the indexed-lookup prefix (e.g. "mwt_4Z3KH") of a
// full secret. It does NOT validate the secret beyond length.
func Prefix(secret string) string {
	if len(secret) < SecretPrefixLen {
		return secret
	}
	return secret[:SecretPrefixLen]
}

// ValidateTokenPrefix checks that p is exactly the 9-character form
// emitted by Prefix(GenerateTokenSecret()): "mwt_" + 5 chars from the
// RFC 4648 base32 alphabet (A-Z, 2-7). It is the input contract for
// InsertToken and any later bearer-auth lookup path; an invalid
// prefix would leak into tokens.prefix and silently mislead lookups.
func ValidateTokenPrefix(p string) error {
	if len(p) != SecretPrefixLen {
		return fmt.Errorf("store.secret: prefix must be %d chars, got %d", SecretPrefixLen, len(p))
	}
	if p[:4] != "mwt_" {
		return fmt.Errorf("store.secret: prefix must start with %q, got %q", "mwt_", p[:4])
	}
	tail := p[4:]
	for i := 0; i < len(tail); i++ {
		c := tail[i]
		if !isBase32Char(c) {
			return fmt.Errorf("store.secret: prefix tail char #%d (%q) is not in RFC 4648 base32 alphabet", i, c)
		}
	}
	return nil
}

func isBase32Char(c byte) bool {
	switch {
	case c >= 'A' && c <= 'Z':
		return true
	case c >= '2' && c <= '7':
		return true
	}
	return false
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
