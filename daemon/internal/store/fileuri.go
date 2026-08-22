package store

import (
	"runtime"
	"strings"
)

// FileURIPath converts a local filesystem path into the Path component
// of a file: URI for modernc.org/sqlite. On Windows, backslashes become
// slashes and a leading slash is added so C:\a.db becomes /C:/a.db
// (file:///C:/a.db). Unix paths are returned unchanged.
func FileURIPath(path string) (string, error) {
	return fileURIPath(path, runtime.GOOS)
}

func fileURIPath(path, goos string) (string, error) {
	if goos != "windows" {
		return path, nil
	}
	return "/" + strings.ReplaceAll(path, "\\", "/"), nil
}
