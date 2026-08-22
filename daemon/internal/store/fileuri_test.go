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
