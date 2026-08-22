package store

import (
	"fmt"
	"runtime"
	"strings"
	"unicode"
)

// FileURIPath converts a local filesystem path into the Path component
// of a file: URI for modernc.org/sqlite. On Windows only drive-letter
// absolute paths (C:\… or C:/…) are accepted; UNC and device paths
// are rejected so they cannot silently open the wrong file. Unix
// paths are returned unchanged.
func FileURIPath(path string) (string, error) {
	return fileURIPath(path, runtime.GOOS)
}

func fileURIPath(path, goos string) (string, error) {
	if goos != "windows" {
		return path, nil
	}
	if !windowsDrivePath(path) {
		return "", fmt.Errorf("store: windows sqlite path must be a drive-letter absolute path (got %q)", path)
	}
	return "/" + strings.ReplaceAll(path, "\\", "/"), nil
}

func windowsDrivePath(path string) bool {
	if len(path) < 3 {
		return false
	}
	if !unicode.IsLetter(rune(path[0])) || path[1] != ':' {
		return false
	}
	return path[2] == '\\' || path[2] == '/'
}
