# Feature 13: Expand HTTP Body Limit and Safe Stdin Transport for Pi

> Status: Implemented
> Driver: 李政 (nocoo) & Claude
> Context: Co-evolution with teams-native large context/ledger task; removing application-layer bottlenecks (HTTP body limit and OS ARG_MAX for Pi).

## 1. Background & Problem

In collaborative evolution runs with `teams-native`, input sizes easily exceed previous assumptions:
1. `daemon/internal/server/server.go`: `defaultBodyLimit = 1 << 20` (1 MiB), which causes requests larger than 1 MiB to fail with HTTP 413 `payload_too_large`.
2. `daemon/pkg/agent/pi.go`: `buildPiArgs` passed the entire user prompt and `--append-system-prompt <text>` directly via command-line arguments (`os.Args` / `argv`). On POSIX systems, `ARG_MAX` limits total argv size (typically 1 MiB or 256 KiB), causing `exec.Command` to fail with `E2BIG` ("argument list too long") when prompts or system instructions grow large.
3. Previously, `pi.go` attached a stdin pipe and closed it immediately upon start to avoid a known hang (#2188) under systemd where Pi awaited stdin. However, Pi (`@earendil-works/pi-coding-agent`) natively reads piped stdin in non-interactive/print mode (`readPipedStdin()` in `dist/main.js` and `buildInitialMessage()`). Furthermore, Pi's `--append-system-prompt` natively accepts a file path (`resolvePromptInput()` reads the file if it exists).

## 2. Implemented Architecture & Design

### 2.1 HTTP Body Limit
- Updated `defaultBodyLimit` in `daemon/internal/server/server.go` from `1 << 20` (1 MiB) to `64 << 20` (64 MiB).
- Updated OpenAPI specifications and documentation (`docs/architecture/02-daemon-http-protocol.md`, `openapi.yaml`, `openapi-types.ts`) to reflect the 64 MiB limit.

### 2.2 Pi Backend Transport
- **Prompt via Stdin (`cmd.Stdin = strings.NewReader(prompt)`)**:
  - Removed positional `prompt` from argv in `buildPiArgs`.
  - Configured `cmd.Stdin = strings.NewReader(prompt)`. Go's `os/exec` automatically manages an `os.Pipe`, copies data concurrently via an internal goroutine, and closes the pipe (sending EOF) upon completion.
  - This avoids passing prompts through argv (completely eliminating `E2BIG` / `ARG_MAX`), prevents deadlocks against stdout backpressure, and maintains FIFO EOF semantics to prevent #2188 hangs.
- **System Prompt via Temporary File**:
  - If `opts.SystemPrompt != ""` is provided, writes it to a temporary file (`os.CreateTemp("", "meowth-pi-sysprompt-*.txt")`) with file mode `0600` and resolves its absolute path (`filepath.Abs`).
  - Passes `--append-system-prompt <abs-path>` in `buildPiArgs`.
  - Cleaned up deterministically in all execution termination paths: `cmd.Start` failure, normal completion, context cancellation, timeout, or stream read errors.
- **Unlimited Stdout Reading (`bufio.Reader.ReadBytes('\n')`)**:
  - Replaced `bufio.Scanner` (which had a hard 32 MiB buffer ceiling) with `bufio.Reader.ReadBytes('\n')`.
  - Can read arbitrary single-line JSON events without buffer exhaustion or silent stalls.
  - On non-EOF read error when process is still running, kills child process to avoid hanging during `cmd.Wait()`.
- **Argv Redaction (`argvPromptNone`)**:
  - Added `argvPromptNone` to `argv_log.go` for Pi since no prompt is present in argv, ensuring logs don't redact innocent flags.

## 3. 6DQ Quality Plan

1. **Deterministic / Zero-Leak**:
   - Temporary system prompt files are always deleted via `defer cleanupSystemPrompt()` and explicit cleanup before error returns.
   - Child process is terminated on context cancellation, timeout, or unrecoverable stdout read errors.
2. **Regression & Safety**:
   - Verified prompt > 2 MiB passes through stdin with SHA-256 byte-level fidelity.
   - Verified system prompt read from 0600 tempfile with SHA-256 byte-level fidelity.
   - Verified server body limit allows payloads up to 64 MiB and rejects > 64 MiB with 413.
   - Verified child process ignoring stdin terminates cleanly on cancel/timeout and cleans temporary files.
   - Verified stdout event lines > 33 MiB (exceeding old 32 MiB scanner cap) are parsed cleanly without truncation.
   - Verified trailing partial line without trailing newline at EOF is handled without error or hang.
   - Verified `cmd.Start` failure cleans up temporary system prompt file immediately.

## 4. Atomic Commit Plan

1. **Commit 1**: `docs(architecture): document 64MiB body limit and Pi stdin transport`
2. **Commit 2**: `fix(server): expand default HTTP body limit to 64MiB`
3. **Commit 3**: `fix(agent): stream Pi prompt via stdin and write system prompt via tempfile`
4. **Commit 4**: `test(agent): add large prompt and system prompt regression tests for Pi and server`
