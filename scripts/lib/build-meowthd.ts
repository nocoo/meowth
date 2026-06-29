// scripts/lib/build-meowthd.ts — helper to build the meowthd Go
// binary once into a deterministic path that L2 / E2E harnesses can
// spawn directly. Replaces `spawn('go', ['run', ...])` which leaves
// orphan meowthd processes after Kill() on macOS (the `go run`
// wrapper is killed but the daemon grandchild is reparented to
// launchd).
//
// Output binary path is stable per-script via the `outputName`
// argument so concurrent harnesses don't stomp each other.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts/run-l2-output');

export function buildMeowthd(outputName: string): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const binary = join(OUTPUT_DIR, outputName);
  const res = spawnSync('go', ['build', '-o', binary, './cmd/meowthd'], {
    cwd: join(REPO_ROOT, 'daemon'),
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`go build ${outputName} exit=${String(res.status)}`);
  }
  return binary;
}
