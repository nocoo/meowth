package initcmd

import (
	"net/url"

	"github.com/nocoo/meowth/daemon/internal/store"
)

// fileURIPath is store.FileURIPath; tests swap it because the real
// helper cannot return an error on unix.
var fileURIPath = store.FileURIPath

// buildBootstrapDSN replicates store.buildDSN's URL-escape contract
// without duplicating the Windows file-URI rewrite. Used only to
// create the _test_marker row before store.Open's verifyTestStore runs.
func buildBootstrapDSN(path string) (string, error) {
	uriPath, err := fileURIPath(path)
	if err != nil {
		return "", err
	}
	u := &url.URL{Scheme: "file", Path: uriPath}
	return u.String(), nil
}
