package initcmd

import (
	"net/url"
	"runtime"
	"strings"
)

// buildBootstrapDSN replicates store.buildDSN's URL-escape contract
// without importing the unexported helper. Used only to create the
// _test_marker row before store.Open's verifyTestStore runs.
func buildBootstrapDSN(path string) (string, error) {
	uriPath := path
	if runtime.GOOS == "windows" {
		uriPath = "/" + strings.ReplaceAll(path, "\\", "/")
	}
	u := &url.URL{Scheme: "file", Path: uriPath}
	return u.String(), nil
}
