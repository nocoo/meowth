package initcmd

import "net/url"

// buildBootstrapDSN replicates store.buildDSN's URL-escape contract
// without importing the unexported helper. Used only to create the
// _test_marker row before store.Open's verifyTestStore runs.
func buildBootstrapDSN(path string) (string, error) {
	u := &url.URL{Scheme: "file", Path: path}
	return u.String(), nil
}
