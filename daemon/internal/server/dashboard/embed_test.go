package dashboard

import (
	"io/fs"
	"testing"
)

func TestDistFS_NonNil(t *testing.T) {
	sub, err := DistFS()
	if err != nil {
		t.Fatalf("DistFS error: %v", err)
	}
	if sub == nil {
		t.Fatal("DistFS returned nil fs.FS")
	}
}

func TestDistFS_HasAtLeastGitkeep(t *testing.T) {
	sub, err := DistFS()
	if err != nil {
		t.Fatalf("DistFS error: %v", err)
	}
	// At a minimum the .gitkeep compile guard must be embedded.
	if _, err := fs.Stat(sub, ".gitkeep"); err != nil {
		t.Fatalf("expected .gitkeep guard, got %v", err)
	}
}
