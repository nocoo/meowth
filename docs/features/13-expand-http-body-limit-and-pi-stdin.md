# Feature 13: Expand HTTP Body Limit and Safe Stdin Transport for Pi

> Status: Approved & In Progress
> Driver: Claude
> Context: Co-evolution with teams-native large context/ledger task; removing application-layer bottlenecks (HTTP body limit and OS ARG_MAX for Pi).

## 1. Background & Problem

In collaborative evolution runs with `teams-native`, input sizes easily exceed previous assumptions:
1. `daemon/internal/server/server.go`: `defaultBodyLimit = 1 << 20` (1 MiB), which causes requests larger than 1 MiB to fail with HTTP 413 `payload_too_large`.
2. `daemon/pkg/agent/pi.go`: `buildPiArgs` passed the entire user prompt and `--append-system-prompt <text>` directly via command-line arguments (`os.Args` / `argv`). On POSIX systems, `ARG_MAX` limits total argv size (typically 1 MiB or 256 KiB), causing `exec.Command` to fail with `E2BIG` ("argument list too long") when prompts or system instructions grow large.
3. Previously, `pi.go` attached a stdin pipe and closed it immediately upon start to avoid a known hang (#2188) under systemd where Pi awaited stdin. However, Pi (`@earendil-works/pi-coding-agent`) natively reads piped stdin in non-interactive/print mode (`readPipedStdin()` in `dist/main.js` and `buildInitialMessage()`). Furthermore, Pi's `--append-system-prompt` natively accepts a file path (`resolvePromptInput()` reads the file if it exists).

## 2. Proposed Architecture & Design

### 2.1 HTTP Body Limit
- Update `defaultBodyLimit` in `daemon/internal/server/server.go` from `1 << 20` (1 MiB) to `64 << 20` (64 MiB).
- Update OpenAPI specifications and documentation (`docs/architecture/02-daemon-http-protocol.md`, `openapi.yaml`, `openapi-types.ts`) to reflect the 64 MiB limit.

### 2.2 Pi Backend Transport
- **Prompt via Stdin**:
  - Remove positional `prompt` from argv in `buildPiArgs`.
  - When spawning the child process, launch a concurrent goroutine to write `prompt` to `cmd.StdinPipe()` and close it (`Close()` sends EOF).
  - Writing concurrently ensures that even if stdout fills OS buffers or Pi begins streaming output before consuming all input, neither side deadlocks.
  - EOF on stdin preserves the fix for #2188 (Pi will see EOF and proceed normally).
  - If writing fails or context is cancelled, close pipe cleanly.
- **System Prompt via Temporary File**:
  - If `opts.SystemPrompt != ""` is provided, write it to a temporary file (`os.CreateTemp("", "meowth-pi-sysprompt-*.txt")`) with permissions `0600`.
  - Pass `--append-system-prompt <filepath>` in `buildPiArgs`.
  - Remove/unlink the temporary file immediately upon process exit (using `defer os.Remove(...)` in the caller or cleanup block).
  - If creation of the temp file fails, fail fast before starting the process.
- **Argv Redaction**:
  - Since the prompt is no longer in argv, update `argvPromptMode` for Pi (or remove argv prompt redaction for Pi if no prompt is passed via argv) so logs stay clean and don't mis-redact flags.

## 3. 6DQ Quality Plan

1. **Deterministic / Zero-Leak**:
   - Temporary system prompt files are always deleted via `defer` or explicit cleanup.
   - Stdin goroutines exit cleanly on EOF, error, or context cancellation without leaking goroutines or file descriptors.
2. **Regression & Safety**:
   - Verify prompt > 1 MiB and > 256 KiB passes through without `E2BIG`.
   - Verify server body limit allows payloads > 1 MiB and rejects payloads > 64 MiB with 413.
   - Verify Pi stdin EOF unblocks execution without hanging (#2188 regression guard).
   - Verify cancelling context terminates the process and unblocks all goroutines.

## 4. Atomic Commit Plan

1. **Commit 1**: `docs(architecture): document 64MiB body limit and Pi stdin transport`
2. **Commit 2**: `fix(server): expand default HTTP body limit to 64MiB`
3. **Commit 3**: `fix(agent): stream Pi prompt via stdin and write system prompt via tempfile`
4. **Commit 4**: `test(agent): add large prompt and system prompt regression tests for Pi and server`
