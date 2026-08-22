package store

import "testing"

func TestFileURIPathUnixUnchanged(t *testing.T) {
	got, err := fileURIPath("/Users/meowth/meowth.db", "darwin")
	if err != nil {
		t.Fatal(err)
	}
	if got != "/Users/meowth/meowth.db" {
		t.Fatalf("got %q", got)
	}
}

func TestFileURIPathWindowsDriveLetter(t *testing.T) {
	got, err := fileURIPath(`C:\Users\meowth user\meowth.db`, "windows")
	if err != nil {
		t.Fatal(err)
	}
	if got != `/C:/Users/meowth user/meowth.db` {
		t.Fatalf("got %q", got)
	}
}

func TestFileURIPathWindowsRejectsUNCAndDevice(t *testing.T) {
	for _, path := range []string{
		`\\server\share\meowth.db`,
		`\\?\C:\Users\meowth\meowth.db`,
		`\\.\pipe\meowth`,
		`C:meowth.db`,
		`\Users\meowth\meowth.db`,
		`meowth.db`,
	} {
		if _, err := fileURIPath(path, "windows"); err == nil {
			t.Fatalf("expected error for %q", path)
		}
	}
}
