package handlers

import "os"

// processPID returns the OS pid; wrapped so handler tests can
// inject if needed without touching package state.
func processPID() int {
	return os.Getpid()
}
