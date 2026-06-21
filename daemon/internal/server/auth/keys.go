package auth

import (
	"crypto/rand"
	"sync"

	"github.com/nocoo/meowth/daemon/internal/store"
)

// dummySalt and dummyHash are the materials used by the
// 0-hit / no-row branch of Middleware to keep the wall-clock cost
// of "unknown token" comparable to "real argon2id verify". They are
// generated once per process via sync.Once so we never pay the cost
// in init() (argon2 64MiB×3 every test binary load) and so test
// hashers don't have to import a reset helper.
var (
	dummyOnce sync.Once
	dummySalt []byte
	dummyHash []byte
)

func ensureDummy() {
	dummyOnce.Do(func() {
		salt := make([]byte, store.Argon2SaltLen)
		if _, err := rand.Read(salt); err != nil {
			// crypto/rand failing is non-recoverable; this is a process-
			// wide setup path so panic is acceptable here. The only
			// other option is to lazy-fail every Middleware call, which
			// is strictly worse.
			panic("auth: crypto/rand: " + err.Error())
		}
		dummySalt = salt
		dummyHash = store.Argon2IDKey([]byte("__meowth_dummy__"), salt)
	})
}
