package agentfactory

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestProfilesAreNamesOnlyAndSorted(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"zeta", "alpha", "UPPER", ".private", "default"} {
		if err := os.MkdirAll(filepath.Join(root, "profiles", name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "profiles", "plain-file"), []byte("not a profile"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(root, filepath.Join(root, "profiles", "linked")); err != nil {
		t.Fatal(err)
	}
	got := profilesAt(root)
	want := []AgentProfile{{Name: "default"}, {Name: "alpha"}, {Name: "zeta"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if len(profilesAt(filepath.Join(root, "missing"))) != 0 {
		t.Fatal("invented profile")
	}
}

func TestHermesHomeResolutionMatchesCLI(t *testing.T) {
	native := filepath.Join(t.TempDir(), ".hermes")
	custom := t.TempDir()
	for _, test := range []struct{ override, want string }{
		{"", native}, {native, native}, {filepath.Join(native, "profiles", "work"), native},
		{custom, custom}, {filepath.Join(custom, "profiles", "work"), custom},
	} {
		if got := hermesRoot(native, test.override); got != test.want {
			t.Fatalf("got %q, want %q", got, test.want)
		}
	}
	if got := profilesAt(custom); !reflect.DeepEqual(got, []AgentProfile{{Name: "default"}}) {
		t.Fatalf("%v", got)
	}
}

func TestDiscoverHermesProfilesHonorsHermesHome(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HERMES_HOME", root)
	got := discoverHermesProfiles()
	want := []AgentProfile{{Name: "default"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
