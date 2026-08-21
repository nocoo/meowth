//go:build windows

package store

import (
	"net/url"
	"strings"
	"testing"
)

func TestBuildDSNUsesWindowsFileURI(t *testing.T) {
	dsn, err := buildDSN(`C:\Users\meowth user\meowth.db`)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Scheme != "file" || parsed.Host != "" || parsed.Path != `/C:/Users/meowth user/meowth.db` {
		t.Fatalf("unexpected Windows file URI: %q", dsn)
	}
	if !strings.HasPrefix(dsn, "file:///C:/") {
		t.Fatalf("DSN must use file:///C:/ form: %q", dsn)
	}
}
