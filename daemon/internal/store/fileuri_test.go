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
	cases := []struct {
		in, want string
	}{
		{`C:\Users\meowth user\meowth.db`, `/C:/Users/meowth user/meowth.db`},
		{`C:/Users/meowth user/meowth.db`, `/C:/Users/meowth user/meowth.db`},
	}
	for _, tc := range cases {
		got, err := fileURIPath(tc.in, "windows")
		if err != nil {
			t.Fatalf("%q: %v", tc.in, err)
		}
		if got != tc.want {
			t.Fatalf("%q: got %q want %q", tc.in, got, tc.want)
		}
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
