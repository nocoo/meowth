package initcmd

import (
	"errors"
	"testing"
)

func TestBuildBootstrapDSNPropagatesFileURIPathError(t *testing.T) {
	orig := fileURIPath
	t.Cleanup(func() { fileURIPath = orig })
	want := errors.New("injected file uri")
	fileURIPath = func(string) (string, error) { return "", want }

	_, err := buildBootstrapDSN("/tmp/meowth.db")
	if !errors.Is(err, want) {
		t.Fatalf("got %v, want %v", err, want)
	}
}
