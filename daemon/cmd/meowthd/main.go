package main

import "fmt"

// Version is set at build time via -ldflags; defaults to "dev" for local builds.
var Version = "dev"

func main() {
	fmt.Printf("meowthd %s\n", Version)
}
