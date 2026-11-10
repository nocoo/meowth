const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const hookPath = path.join(repoRoot, '.husky/pre-commit');
const l1Path = path.join(repoRoot, 'scripts/hooks/pre-commit-l1.sh');

function git(cwd, args, env) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}

function succeed(cwd, args, env) {
  const result = git(cwd, args, env);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function materializeRepo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'meowth-l1-hook-'));
  const repo = path.join(root, 'repo');
  mkdirSync(repo);
  const gomodcache = path.join(repo, '.gomodcache');
  mkdirSync(gomodcache);
  const env = {
    ...process.env,
    HOME: path.join(repo, '.home'),
    GOMODCACHE: gomodcache,
  };
  mkdirSync(env.HOME);
  succeed(repo, ['init', '-q'], env);
  succeed(repo, ['config', 'user.name', 'L1 Hook'], env);
  succeed(repo, ['config', 'user.email', 'l1-hook@example.invalid'], env);
  mkdirSync(path.join(repo, '.husky'), { recursive: true });
  mkdirSync(path.join(repo, 'scripts/hooks'), { recursive: true });
  writeFileSync(path.join(repo, '.husky/pre-commit'), readFileSync(hookPath));
  writeFileSync(path.join(repo, 'scripts/hooks/pre-commit-l1.sh'), readFileSync(l1Path));
  chmodSync(path.join(repo, '.husky/pre-commit'), 0o755);
  chmodSync(path.join(repo, 'scripts/hooks/pre-commit-l1.sh'), 0o755);
  mkdirSync(path.join(repo, 'daemon'), { recursive: true });
  writeFileSync(
    path.join(repo, 'daemon/snapshot.go'),
    'package daemon\n\nfunc SnapshotValue() int { return 1 }\n',
  );
  writeFileSync(
    path.join(repo, 'daemon/snapshot_test.go'),
    'package daemon\n\nimport "testing"\n\nfunc TestSnapshotValue(t *testing.T) {\n\tif SnapshotValue() != 1 {\n\t\tt.Fatalf("expected 1")\n\t}\n}\n',
  );
  writeFileSync(path.join(repo, 'package.json'), '{"name":"l1-fixture","private":true}\n');
  writeFileSync(
    path.join(repo, 'daemon/go.mod'),
    'module example.com/meowth-l1-fixture\n\ngo 1.26.0\n',
  );
  return { repo, env, root };
}

function runHook(repo, env, { skipPartial = false } = {}) {
  return spawnSync('sh', [path.join(repo, '.husky/pre-commit')], {
    cwd: repo,
    env: {
      ...env,
      MEOWTH_PRECOMMIT_L1_FIXTURE: '1',
      ...(skipPartial ? { MEOWTH_PRECOMMIT_SKIP_PARTIAL: '1' } : {}),
    },
    encoding: 'utf8',
  });
}

test('index snapshot rejects failing unit tests while the worktree is healthy', (t) => {
  const { repo, env } = materializeRepo(t);
  const stagedTest = path.join(repo, 'daemon/snapshot_test.go');
  writeFileSync(
    stagedTest,
    'package daemon\n\nimport "testing"\n\nfunc TestSnapshotValue(t *testing.T) { t.Fatalf("staged UT failure") }\n',
  );
  succeed(repo, ['add', '--', '.'], env);
  const fail = runHook(repo, env);
  assert.notEqual(fail.status, 0);
  assert.match(`${fail.stdout}\n${fail.stderr}`, /staged UT failure|FAIL/);
});

test('index snapshot rejects coverage regression while the worktree is healthy', (t) => {
  const { repo, env } = materializeRepo(t);
  const stagedTest = path.join(repo, 'daemon/snapshot_test.go');
  writeFileSync(
    stagedTest,
    'package daemon\n\nimport "testing"\n\nfunc TestSnapshotValue(t *testing.T) {}\n',
  );
  succeed(repo, ['add', '--', '.'], env);
  writeFileSync(
    stagedTest,
    'package daemon\n\nimport "testing"\n\nfunc TestSnapshotValue(t *testing.T) {\n\tif SnapshotValue() != 1 {\n\t\tt.Fatalf("expected 1")\n\t}\n}\n',
  );
  const fail = runHook(repo, env);
  assert.notEqual(fail.status, 0);
});

test('index snapshot rejects badly staged Go while worktree formatting is healthy', (t) => {
  const { repo, env } = materializeRepo(t);
  const stagedGo = path.join(repo, 'daemon/snapshot.go');
  writeFileSync(stagedGo, 'package daemon\nfunc SnapshotValue()int{return 1}\n');
  succeed(repo, ['add', '--', 'daemon/snapshot.go'], env);
  writeFileSync(
    stagedGo,
    'package daemon\n\nfunc SnapshotValue() int { return 1 }\n',
  );
  const fail = runHook(repo, env, { skipPartial: true });
  assert.notEqual(fail.status, 0);
  assert.match(`${fail.stdout}\n${fail.stderr}`, /not formatted|gofmt/);
});

test('index snapshot accepts a healthy staged commit', (t) => {
  const { repo, env } = materializeRepo(t);
  succeed(repo, ['add', '--', '.'], env);
  const ok = runHook(repo, env);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
});
