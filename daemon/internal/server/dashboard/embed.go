// Package dashboard embeds the production dashboard build at
// daemon/internal/server/dashboard/dist via go:embed.
//
// docs/architecture/02 §3 + 06 §3.4 — daemon serves the same-origin
// dashboard from a single binary so the browser does not need CORS.
// The dist directory is populated by scripts/prepare-dashboard-embed.sh
// (which runs as part of `pnpm daemon:build`). The .gitkeep guard
// inside dist lets `go build ./...` succeed even before prepare ran;
// production builds verify index.html + a hashed asset exist before
// the binary ships (see the prepare script's fail-fast checks).
package dashboard

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var raw embed.FS

// DistFS returns the embedded dist tree rooted at "dist/".
// Callers should not assume the tree is non-empty when running
// against the .gitkeep-only compile guard; static.New is the right
// entry for actual serving and accepts whatever shape DistFS yields.
func DistFS() (fs.FS, error) {
	return fs.Sub(raw, "dist")
}
