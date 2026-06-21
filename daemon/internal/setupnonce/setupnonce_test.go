package setupnonce

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nocoo/meowth/daemon/internal/home"
)

// validNonceBodyExcept returns a syntactically-valid setup_nonce.hash
// JSON body with the given field overridden. fragment=="" omits the
// field entirely.
func validNonceBodyExcept(t *testing.T, field, fragment string) []byte {
	t.Helper()
	salt := base64.StdEncoding.EncodeToString(make([]byte, 16))
	digest := base64.StdEncoding.EncodeToString(make([]byte, 32))
	fields := map[string]string{
		"algorithm":   `"argon2id"`,
		"version":     `19`,
		"memory_kib":  `65536`,
		"time_cost":   `3`,
		"parallelism": `4`,
		"salt_b64":    `"` + salt + `"`,
		"digest_b64":  `"` + digest + `"`,
		"created_at":  `1`,
		"one_shot":    `true`,
	}
	if fragment == "" {
		delete(fields, field)
	} else {
		fields[field] = fragment
	}
	var parts []string
	for _, k := range []string{
		"algorithm", "version", "memory_kib", "time_cost", "parallelism",
		"salt_b64", "digest_b64", "created_at", "one_shot",
	} {
		v, ok := fields[k]
		if !ok {
			continue
		}
		parts = append(parts, `"`+k+`":`+v)
	}
	return []byte("{" + strings.Join(parts, ",") + "}")
}

func writeBody(t *testing.T, body []byte) string {
	t.Helper()
	tmp := t.TempDir()
	path := filepath.Join(tmp, "nonce.hash")
	if err := os.WriteFile(path, body, home.FileMode); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return path
}

func TestWriteAndParseRoundtrip(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "nonce.hash")
	salt := make([]byte, 16)
	for i := range salt {
		salt[i] = byte(i + 1)
	}
	digest := make([]byte, 32)
	for i := range digest {
		digest[i] = byte(255 - i)
	}
	if err := Write(path, salt, digest); err != nil {
		t.Fatalf("Write: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != home.FileMode {
		t.Fatalf("mode = %v, want %v", info.Mode().Perm(), home.FileMode)
	}
	parsed, err := Parse(path)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if string(parsed.Salt) != string(salt) {
		t.Fatalf("salt roundtrip mismatch")
	}
	if string(parsed.Digest) != string(digest) {
		t.Fatalf("digest roundtrip mismatch")
	}
	if parsed.Payload.Algorithm != "argon2id" {
		t.Fatalf("algorithm = %q", parsed.Payload.Algorithm)
	}
	if !parsed.Payload.OneShot {
		t.Fatal("one_shot must be true on freshly written file")
	}
}

func TestWriteRejectsBadInputs(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "nonce.hash")
	if err := Write(path, make([]byte, 8), make([]byte, 32)); err == nil {
		t.Fatal("short salt accepted")
	}
	if err := Write(path, make([]byte, 16), make([]byte, 8)); err == nil {
		t.Fatal("short digest accepted")
	}
}

func TestParseRejectsBadAlgorithm(t *testing.T) {
	body := validNonceBodyExcept(t, "algorithm", `"sha256"`)
	if _, err := Parse(writeBody(t, body)); err == nil {
		t.Fatal("non-argon2id algorithm accepted")
	}
}

func TestParseRejectsOneShotFalse(t *testing.T) {
	body := validNonceBodyExcept(t, "one_shot", "false")
	if _, err := Parse(writeBody(t, body)); err == nil {
		t.Fatal("one_shot=false accepted")
	}
}

func TestParseRequiresFields(t *testing.T) {
	cases := []struct {
		name     string
		field    string
		fragment string
	}{
		{"version missing", "version", ""},
		{"version zero", "version", "0"},
		{"version wrong", "version", "18"},
		{"memory_kib missing", "memory_kib", ""},
		{"memory_kib zero", "memory_kib", "0"},
		{"time_cost missing", "time_cost", ""},
		{"time_cost zero", "time_cost", "0"},
		{"parallelism missing", "parallelism", ""},
		{"parallelism zero", "parallelism", "0"},
		{"created_at missing", "created_at", ""},
		{"created_at zero", "created_at", "0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Parse(writeBody(t, validNonceBodyExcept(t, tc.field, tc.fragment))); err == nil {
				t.Fatalf("Parse accepted %s", tc.name)
			}
		})
	}
}

// Cost-parameter agility: the parser must accept memory_kib /
// time_cost / parallelism values that differ from the constants the
// daemon currently uses, as long as they are > 0.
func TestParseAcceptsAgileCostParameters(t *testing.T) {
	body := validNonceBodyExcept(t, "memory_kib", "131072") // 128 MiB
	body = []byte(strings.Replace(string(body), `"time_cost":3`, `"time_cost":5`, 1))
	body = []byte(strings.Replace(string(body), `"parallelism":4`, `"parallelism":8`, 1))
	parsed, err := Parse(writeBody(t, body))
	if err != nil {
		t.Fatalf("Parse rejected agile params: %v", err)
	}
	if parsed.Payload.MemoryKiB != 131072 {
		t.Fatalf("memory_kib = %d, want 131072", parsed.Payload.MemoryKiB)
	}
	if parsed.Payload.TimeCost != 5 || parsed.Payload.Parallelism != 8 {
		t.Fatalf("time_cost / parallelism not preserved: %+v", parsed.Payload)
	}
}

func TestParseRejectsTrailingData(t *testing.T) {
	body := validNonceBodyExcept(t, "", "")
	body = append(body, validNonceBodyExcept(t, "", "")...)
	if _, err := Parse(writeBody(t, body)); err == nil {
		t.Fatal("Parse accepted trailing JSON object")
	}
}

func TestParseRejectsUnknownField(t *testing.T) {
	body := []byte(`{"algorithm":"argon2id","version":19,"memory_kib":65536,"time_cost":3,"parallelism":4,"salt_b64":"` +
		base64.StdEncoding.EncodeToString(make([]byte, 16)) +
		`","digest_b64":"` + base64.StdEncoding.EncodeToString(make([]byte, 32)) +
		`","created_at":1,"one_shot":true,"extra_field":"surprise"}`)
	if _, err := Parse(writeBody(t, body)); err == nil {
		t.Fatal("Parse accepted unknown field")
	}
}

func TestParseRejectsBadBase64Salt(t *testing.T) {
	body := validNonceBodyExcept(t, "salt_b64", `"not-valid-base64==="`)
	if _, err := Parse(writeBody(t, body)); err == nil {
		t.Fatal("Parse accepted malformed salt")
	}
}

func TestParseRejectsShortSalt(t *testing.T) {
	body := validNonceBodyExcept(t, "salt_b64", `"`+base64.StdEncoding.EncodeToString(make([]byte, 8))+`"`)
	if _, err := Parse(writeBody(t, body)); err == nil {
		t.Fatal("Parse accepted short salt")
	}
}

func TestParseRejectsShortDigest(t *testing.T) {
	body := validNonceBodyExcept(t, "digest_b64", `"`+base64.StdEncoding.EncodeToString(make([]byte, 16))+`"`)
	if _, err := Parse(writeBody(t, body)); err == nil {
		t.Fatal("Parse accepted short digest")
	}
}

func TestParseMissingFile(t *testing.T) {
	tmp := t.TempDir()
	if _, err := Parse(filepath.Join(tmp, "nope")); err == nil {
		t.Fatal("Parse accepted missing file")
	}
}
