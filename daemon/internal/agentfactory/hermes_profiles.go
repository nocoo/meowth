package agentfactory

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

type AgentProfile struct {
	Name string `json:"name"`
}

var hermesProfileName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

func hermesRoot(nativeHome, override string) string {
	if override == "" {
		return nativeHome
	}
	override = filepath.Clean(override)
	if relative, err := filepath.Rel(nativeHome, override); err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nativeHome
	}
	if filepath.Base(filepath.Dir(override)) == "profiles" {
		return filepath.Dir(filepath.Dir(override))
	}
	return override
}

func discoverHermesProfiles() []AgentProfile {
	home, err := os.UserHomeDir()
	if err != nil {
		return []AgentProfile{}
	}
	native := filepath.Join(home, ".hermes")
	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			native = filepath.Join(local, "hermes")
		}
	}
	return profilesAt(hermesRoot(native, os.Getenv("HERMES_HOME")))
}

func profilesAt(root string) []AgentProfile {
	profiles := []AgentProfile{}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() {
		return profiles
	}
	profiles = append(profiles, AgentProfile{Name: "default"})
	entries, err := os.ReadDir(filepath.Join(root, "profiles"))
	if err != nil {
		return profiles
	}
	for _, entry := range entries {
		if entry.IsDir() && entry.Name() != "default" && hermesProfileName.MatchString(entry.Name()) {
			profiles = append(profiles, AgentProfile{Name: entry.Name()})
		}
	}
	return profiles
}
