//go:build windows

package initcmd

import (
	"net/url"
	"testing"
)

func TestBuildBootstrapDSNUsesWindowsFileURI(t *testing.T) {
	dsn, err := buildBootstrapDSN(`C:\Users\meowth user\meowth.db`)
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
}
