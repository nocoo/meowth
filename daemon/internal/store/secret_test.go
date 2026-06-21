package store

import (
	"context"
	"crypto/subtle"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func TestGenerateTokenSecretShape(t *testing.T) {
	secret, salt, hash, err := GenerateTokenSecret()
	if err != nil {
		t.Fatalf("GenerateTokenSecret: %v", err)
	}
	if !strings.HasPrefix(secret, "mwt_") {
		t.Fatalf("secret %q does not start with mwt_", secret)
	}
	if len(secret) != SecretTotalLen {
		t.Fatalf("secret length = %d, want %d", len(secret), SecretTotalLen)
	}
	if len(salt) != Argon2SaltLen {
		t.Fatalf("salt length = %d, want %d", len(salt), Argon2SaltLen)
	}
	if len(hash) != int(Argon2KeyLen) {
		t.Fatalf("hash length = %d, want %d", len(hash), Argon2KeyLen)
	}
	// Base32 alphabet check on the encoded tail (no padding).
	tail := secret[len("mwt_"):]
	if matched, _ := regexp.MatchString(`^[A-Z2-7]+$`, tail); !matched {
		t.Fatalf("base32 tail contains non-alphabet chars: %q", tail)
	}
	if len(tail) != SecretBase32Len {
		t.Fatalf("base32 tail length = %d, want %d", len(tail), SecretBase32Len)
	}
}

func TestGenerateSetupCodeShape(t *testing.T) {
	code, salt, hash, err := GenerateSetupCode()
	if err != nil {
		t.Fatalf("GenerateSetupCode: %v", err)
	}
	if !strings.HasPrefix(code, "mws_") {
		t.Fatalf("setup code %q does not start with mws_", code)
	}
	if len(code) != SecretTotalLen {
		t.Fatalf("setup code length = %d, want %d", len(code), SecretTotalLen)
	}
	if len(salt) != Argon2SaltLen {
		t.Fatalf("salt length = %d", len(salt))
	}
	if len(hash) != int(Argon2KeyLen) {
		t.Fatalf("hash length = %d", len(hash))
	}
}

func TestPrefixIsFirstNineChars(t *testing.T) {
	secret, _, _, err := GenerateTokenSecret()
	if err != nil {
		t.Fatalf("GenerateTokenSecret: %v", err)
	}
	got := Prefix(secret)
	if len(got) != SecretPrefixLen {
		t.Fatalf("Prefix length = %d, want %d", len(got), SecretPrefixLen)
	}
	if got != secret[:SecretPrefixLen] {
		t.Fatalf("Prefix = %q, want %q", got, secret[:SecretPrefixLen])
	}
	if !strings.HasPrefix(got, "mwt_") {
		t.Fatalf("Prefix %q lacks mwt_", got)
	}
}

func TestArgon2IDKeyDeterministic(t *testing.T) {
	password := []byte("mwt_4Z3KH2QJWNRY7L8XSPVCT5MGABDE6F9UABCDEFGHI")
	salt := []byte("0123456789ABCDEF")
	a := Argon2IDKey(password, salt)
	b := Argon2IDKey(password, salt)
	if subtle.ConstantTimeCompare(a, b) != 1 {
		t.Fatalf("argon2 not deterministic for same inputs")
	}
	if len(a) != int(Argon2KeyLen) {
		t.Fatalf("digest length = %d, want %d", len(a), Argon2KeyLen)
	}
}

func TestArgon2IDKeyParameterSensitivity(t *testing.T) {
	password := []byte("the-same-password")
	salt1 := []byte("0123456789ABCDEF")
	salt2 := []byte("FEDCBA9876543210")
	a := Argon2IDKey(password, salt1)
	b := Argon2IDKey(password, salt2)
	if subtle.ConstantTimeCompare(a, b) == 1 {
		t.Fatalf("argon2 digests collide across different salts")
	}
}

func TestGenerateTokenSecretIsUnique(t *testing.T) {
	seen := make(map[string]struct{})
	for i := 0; i < 16; i++ {
		s, _, _, err := GenerateTokenSecret()
		if err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if _, dup := seen[s]; dup {
			t.Fatalf("duplicate secret on iter %d: %q", i, s)
		}
		seen[s] = struct{}{}
	}
}

func TestTokenViewHasNoSecretOrHashField(t *testing.T) {
	// Compile-time wire safety per docs/architecture/03 §10.4 / §11
	// L1 reflect-assertion row: TokenView must not carry Secret / Hash
	// / Salt fields. If a future change adds one, this fails loudly.
	tt := reflect.TypeOf(TokenView{})
	for i := 0; i < tt.NumField(); i++ {
		name := tt.Field(i).Name
		if name == "Secret" || name == "TokenHash" || name == "Salt" {
			t.Fatalf("TokenView leaks field %q", name)
		}
	}
}

func TestInsertTokenWritesHashOnly(t *testing.T) {
	ctx := context.Background()
	db := openTestStore(t)
	secret, salt, hash, err := GenerateTokenSecret()
	if err != nil {
		t.Fatalf("GenerateTokenSecret: %v", err)
	}
	tok, err := InsertToken(ctx, db, InsertTokenParams{
		Name:       "bootstrap",
		Prefix:     Prefix(secret),
		TokenHash:  hash,
		Salt:       salt,
		CreatedVia: CreatedViaInit,
	})
	if err != nil {
		t.Fatalf("InsertToken: %v", err)
	}
	// The Token struct still carries hash/salt for in-process use, but
	// the DB row should never contain the secret literal anywhere.
	var n int
	if err := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tokens WHERE name = ? AND prefix = ?`,
		"bootstrap", tok.Prefix,
	).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("inserted rows = %d, want 1", n)
	}
	// Verify the persisted token_hash matches what we passed and that
	// neither the row nor name/prefix contains the plaintext secret.
	var (
		gotHash []byte
		gotSalt []byte
		gotVia  string
	)
	if err := db.QueryRowContext(ctx,
		`SELECT token_hash, salt, created_via FROM tokens WHERE id = ?`, tok.ID,
	).Scan(&gotHash, &gotSalt, &gotVia); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if subtle.ConstantTimeCompare(gotHash, hash) != 1 {
		t.Fatalf("persisted hash != input hash")
	}
	if subtle.ConstantTimeCompare(gotSalt, salt) != 1 {
		t.Fatalf("persisted salt != input salt")
	}
	if gotVia != string(CreatedViaInit) {
		t.Fatalf("created_via = %q, want init", gotVia)
	}
	// Hash and secret share no prefix — argon2 derivative is opaque.
	if strings.Contains(string(gotHash), secret) {
		t.Fatalf("token_hash contains plaintext secret (impossible-but-still-asserting)")
	}
}

func TestInsertTokenValidatesInputs(t *testing.T) {
	ctx := context.Background()
	db := openTestStore(t)
	secret, salt, hash, _ := GenerateTokenSecret()
	for _, tc := range []struct {
		name string
		mut  func(p *InsertTokenParams)
	}{
		{"missing name", func(p *InsertTokenParams) { p.Name = "" }},
		{"bad created_via", func(p *InsertTokenParams) { p.CreatedVia = CreatedVia("rogue") }},
		{"short hash", func(p *InsertTokenParams) { p.TokenHash = p.TokenHash[:8] }},
		{"short salt", func(p *InsertTokenParams) { p.Salt = p.Salt[:4] }},
		{"empty prefix", func(p *InsertTokenParams) { p.Prefix = "" }},
		{"wrong prefix scheme", func(p *InsertTokenParams) { p.Prefix = "mws_ABCDE" }},
		{"prefix too short", func(p *InsertTokenParams) { p.Prefix = "mwt_ABC" }},
		{"prefix too long", func(p *InsertTokenParams) { p.Prefix = "mwt_ABCDEF" }},
		{"prefix non-base32 char (1)", func(p *InsertTokenParams) { p.Prefix = "mwt_AB1CD" }},
		{"prefix lowercase", func(p *InsertTokenParams) { p.Prefix = "mwt_ABcDE" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := InsertTokenParams{Name: "bootstrap", Prefix: Prefix(secret), TokenHash: hash, Salt: salt, CreatedVia: CreatedViaInit}
			tc.mut(&p)
			if _, err := InsertToken(ctx, db, p); err == nil {
				t.Fatal("InsertToken returned nil error on invalid input")
			}
		})
	}
}

func TestListActiveTokensByPrefixHandlesCollisionAndRevocation(t *testing.T) {
	ctx := context.Background()
	db := openTestStore(t)

	// Plant two rows with the SAME prefix to simulate the §4.3 collision case.
	secretA, saltA, hashA, _ := GenerateTokenSecret()
	pfx := Prefix(secretA)
	if _, err := InsertToken(ctx, db, InsertTokenParams{Name: "a", Prefix: pfx, TokenHash: hashA, Salt: saltA, CreatedVia: CreatedViaInit}); err != nil {
		t.Fatalf("InsertToken a: %v", err)
	}
	_, saltB, hashB, _ := GenerateTokenSecret()
	tokB, err := InsertToken(ctx, db, InsertTokenParams{Name: "b", Prefix: pfx, TokenHash: hashB, Salt: saltB, CreatedVia: CreatedViaInit})
	if err != nil {
		t.Fatalf("InsertToken b: %v", err)
	}

	got, err := ListActiveTokensByPrefix(ctx, db, pfx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("active count = %d, want 2", len(got))
	}

	// Revoke b — list should drop to 1.
	ok, _, err := RevokeToken(ctx, db, tokB.ID)
	if err != nil || !ok {
		t.Fatalf("RevokeToken: ok=%v err=%v", ok, err)
	}
	got, err = ListActiveTokensByPrefix(ctx, db, pfx)
	if err != nil {
		t.Fatalf("List after revoke: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("active count after revoke = %d, want 1", len(got))
	}
	// A second revoke is a no-op.
	ok, _, err = RevokeToken(ctx, db, tokB.ID)
	if err != nil {
		t.Fatalf("RevokeToken second: %v", err)
	}
	if ok {
		t.Fatal("RevokeToken second time returned ok=true (expected idempotent no-op)")
	}
}

func TestValidateTokenPrefixAcceptsCanonical(t *testing.T) {
	// Sanity: Prefix() of every GenerateTokenSecret() output must pass
	// ValidateTokenPrefix. Run several rounds to cover random tails.
	for i := 0; i < 8; i++ {
		s, _, _, err := GenerateTokenSecret()
		if err != nil {
			t.Fatalf("GenerateTokenSecret: %v", err)
		}
		if err := ValidateTokenPrefix(Prefix(s)); err != nil {
			t.Fatalf("canonical prefix %q rejected: %v", Prefix(s), err)
		}
	}
}

func TestCountTokensIncludesRevoked(t *testing.T) {
	ctx := context.Background()
	db := openTestStore(t)
	if n, _ := CountTokens(ctx, db); n != 0 {
		t.Fatalf("initial count = %d, want 0", n)
	}
	for i := 0; i < 3; i++ {
		s, salt, hash, _ := GenerateTokenSecret()
		tok, err := InsertToken(ctx, db, InsertTokenParams{Name: "t", Prefix: Prefix(s), TokenHash: hash, Salt: salt, CreatedVia: CreatedViaInit})
		if err != nil {
			t.Fatalf("InsertToken %d: %v", i, err)
		}
		if i == 0 {
			if _, _, err := RevokeToken(ctx, db, tok.ID); err != nil {
				t.Fatalf("RevokeToken: %v", err)
			}
		}
	}
	n, err := CountTokens(ctx, db)
	if err != nil {
		t.Fatalf("CountTokens: %v", err)
	}
	// Per docs/architecture/04 §5.1 step 2: revoked rows still count.
	if n != 3 {
		t.Fatalf("count = %d, want 3 (revoked rows still counted)", n)
	}
}
