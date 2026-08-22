package initcmd

import (
	"net/url"

	"github.com/nocoo/meowth/daemon/internal/store"
)

// buildBootstrapDSN replicates store.buildDSN's URL-escape contract
// without duplicating the Windows file-URI rewrite. Used only to
// create the _test_marker row before store.Open's verifyTestStore runs.
func buildBootstrapDSN(path string) (string, error) {
	uriPath, err := store.FileURIPath(path)
	if err != nil {
		return "", err
	}
	u := &url.URL{Scheme: "file", Path: uriPath}
	return u.String(), nil
}
