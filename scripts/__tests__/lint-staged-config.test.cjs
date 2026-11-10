const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const config = require(path.join(repoRoot, 'lint-staged.config.cjs'));
const biomeTask = config['{apps,packages}/**/*.{ts,tsx}'].task;
const goTask = config['daemon/**/*.go'].task;
const hookPath = path.join(repoRoot, '.husky/pre-commit');
const MAX_ARG_BYTES = 32 * 1024;

function isolatedEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return Object.assign(env, extra);
}

function withoutParentGitEnv(t, external = {}) {
  const previous = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')),
  );
  Object.assign(process.env, external);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) delete process.env[key];
  }
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_')) delete process.env[key];
    }
    Object.assign(process.env, previous);
  });
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  assert.ok(
    relative === '' ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)),
    `${target} is outside owned fixture ${root}`,
  );
}

function ownedTemp(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'meowth-hook-test-')));
  const rootObject = lstatSync(root);
  assert.equal(rootObject.isDirectory(), true);
  if (process.getuid) assert.equal(rootObject.uid, process.getuid());
  const markerPath = path.join(root, '.owner-marker');
  const marker = randomUUID();
  writeFileSync(markerPath, marker, { flag: 'wx' });

  const owned = {
    root,
    path(...parts) {
      const target = path.resolve(root, ...parts);
      assertInside(root, target);
      return target;
    },
    verify(target) {
      const absolute = path.resolve(target);
      const actual = realpathSync(absolute);
      assertInside(root, actual);
      assert.equal(actual, absolute, 'owned paths must not traverse symlinks');
      const object = lstatSync(actual);
      if (process.getuid) assert.equal(object.uid, process.getuid());
      return { actual, object };
    },
    remove(target, options = {}) {
      const { actual, object } = owned.verify(target);
      const stillActual = lstatSync(actual);
      assert.equal(stillActual.dev, object.dev);
      assert.equal(stillActual.ino, object.ino);
      rmSync(actual, options);
    },
    cleanup() {
      const { actual, object } = owned.verify(root);
      assert.equal(object.dev, rootObject.dev);
      assert.equal(object.ino, rootObject.ino);
      assert.equal(readFileSync(markerPath, 'utf8'), marker, 'fixture owner marker changed');
      rmSync(actual, { recursive: true, force: true });
    },
  };

  t.after(() => owned.cleanup());
  return owned;
}

function spawn(command, args, { cwd, env = isolatedEnv(), encoding = 'utf8' } = {}) {
  assert.ok(path.isAbsolute(cwd), `subprocess cwd must be absolute: ${cwd}`);
  const result = spawnSync(command, args, { cwd, env, encoding });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} terminated by ${result.signal}`);
  return result;
}

function succeed(command, args, options) {
  const result = spawn(command, args, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function git(repo, args, options = {}) {
  return succeed('git', args, {
    cwd: repo,
    env: options.env ?? isolatedEnv(),
    encoding: options.encoding ?? 'utf8',
  });
}

function executable(file, source) {
  writeFileSync(file, source);
  chmodSync(file, 0o755);
}

function createGitFixture(t) {
  const fixture = ownedTemp(t);
  const repo = fixture.path('repo');
  const home = fixture.path('home');
  const xdg = fixture.path('xdg');
  mkdirSync(repo);
  mkdirSync(home);
  mkdirSync(xdg);
  const env = isolatedEnv({ HOME: home, XDG_CONFIG_HOME: xdg });
  git(repo, ['init', '-q'], { env });
  git(repo, ['config', 'user.name', 'Hook Test'], { env });
  git(repo, ['config', 'user.email', 'hook-test@example.invalid'], { env });
  return { fixture, repo, env };
}

function toolPath(name) {
  return path.join(repoRoot, 'node_modules', '.bin', name);
}

function withToolEnv(t, bin) {
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
  });
}

function createRecorder(fixture) {
  const bin = fixture.path('bin');
  const log = fixture.path('argv.jsonl');
  const mode = fixture.path('tool-mode');
  mkdirSync(bin);
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
if (Object.keys(process.env).some((key) => key.startsWith('GIT_'))) process.exit(91);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  command: path.basename(process.argv[1]),
  args: process.argv.slice(2),
}) + '\\n');
let mode = '';
try { mode = fs.readFileSync(${JSON.stringify(mode)}, 'utf8'); } catch {}
if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
if (mode === 'nonzero') process.exit(17);
if (mode === 'gofmt-output') process.stdout.write('not-formatted.go\\n');
`;
  for (const command of ['biome', 'gofmt']) executable(path.join(bin, command), source);
  return { bin, log, mode };
}

function readCalls(log) {
  try {
    return readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function assertCommandBytes(args) {
  const bytes = args.reduce((total, arg) => total + Buffer.byteLength(arg) + 1, 0);
  assert.ok(bytes <= MAX_ARG_BYTES, `argv used ${bytes} bytes`);
}

function assertToolFailure(error, pattern) {
  assert.match(error.message, pattern);
  assert.doesNotMatch(error.message, /ENOENT/);
  return true;
}

function createIntegrationRepo(t) {
  const { fixture, repo, env } = createGitFixture(t);
  mkdirSync(path.join(repo, '.husky'), { recursive: true });
  mkdirSync(path.join(repo, 'apps/dashboard/src'), { recursive: true });
  mkdirSync(path.join(repo, 'daemon'), { recursive: true });

  writeFileSync(path.join(repo, '.husky/pre-commit'), readFileSync(hookPath));
  chmodSync(path.join(repo, '.husky/pre-commit'), 0o755);
  writeFileSync(
    path.join(repo, 'lint-staged.config.cjs'),
    readFileSync(path.join(repoRoot, 'lint-staged.config.cjs')),
  );
  writeFileSync(path.join(repo, 'biome.json'), readFileSync(path.join(repoRoot, 'biome.json')));
  writeFileSync(path.join(repo, 'package.json'), '{"name":"hook-fixture","private":true}\n');
  writeFileSync(path.join(repo, 'apps/dashboard/src/staged.ts'), 'export const value = 1;\n');
  writeFileSync(
    path.join(repo, 'daemon/staged.go'),
    'package fixture\n\nfunc value() int {\n\treturn 1\n}\n',
  );
  writeFileSync(path.join(repo, 'README.md'), 'initial\n');

  git(
    repo,
    [
      'add',
      '--',
      '.husky/pre-commit',
      'lint-staged.config.cjs',
      'biome.json',
      'package.json',
      'apps/dashboard/src/staged.ts',
      'daemon/staged.go',
      'README.md',
    ],
    { env },
  );
  git(repo, ['commit', '-qm', 'initial hook fixture'], { env });

  return { fixture, repo, env };
}

function integrationEnv(fixture, baseEnv, trace) {
  const pathWithTools = `${path.join(repoRoot, 'node_modules', '.bin')}:${baseEnv.PATH ?? process.env.PATH}`;
  const env = isolatedEnv({
    HOME: baseEnv.HOME,
    XDG_CONFIG_HOME: baseEnv.XDG_CONFIG_HOME,
    PATH: pathWithTools,
    GIT_TRACE: trace,
    MEOWTH_PRECOMMIT_SKIP_L1: '1',
  });
  fixture.verify(fixture.root);
  fixture.path(path.relative(fixture.root, trace));
  return env;
}

function snapshot(repo, env, sources) {
  const indexPath = path.resolve(
    repo,
    git(repo, ['rev-parse', '--git-path', 'index'], { env }).trim(),
  );
  return {
    sources: new Map(sources.map((source) => [source, readFileSync(path.join(repo, source))])),
    index: git(repo, ['ls-files', '--stage', '-z'], { env }),
    indexPath,
    indexBytes: readFileSync(indexPath),
  };
}

function assertSnapshot(repo, env, before) {
  for (const [source, bytes] of before.sources) {
    assert.deepEqual(readFileSync(path.join(repo, source)), bytes, `${source} bytes changed`);
  }
  assert.equal(
    git(repo, ['ls-files', '--stage', '-z'], { env }),
    before.index,
    'Git index changed',
  );
  assert.deepEqual(readFileSync(before.indexPath), before.indexBytes, 'Git index bytes changed');
}

function traceGitCommand(line) {
  const command = line.match(/\btrace: (?:built-in: git|run_command: git)\s+(.*)$/)?.[1];
  if (!command) return undefined;
  const args = [...command.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
  const optionsWithValues = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace']);
  for (let index = 0; index < args.length; index += 1) {
    if (optionsWithValues.has(args[index])) {
      index += 1;
      continue;
    }
    if (!args[index].startsWith('-')) return args[index];
  }
  return undefined;
}

function assertReadOnlyTrace(trace) {
  const forbidden = new Set([
    'stash',
    'restore',
    'add',
    'reset',
    'checkout',
    'apply',
    'update-index',
    'read-tree',
  ]);
  const allowed = new Set(['checkout-index']);
  const commands = readFileSync(trace, 'utf8').split('\n').map(traceGitCommand).filter(Boolean);
  assert.ok(commands.includes('status'), 'trace did not contain the hook status command');
  assert.deepEqual(
    commands.filter((command) => forbidden.has(command) && !allowed.has(command)),
    [],
    `read-only hook invoked mutating Git command(s): ${commands.join(', ')}`,
  );
}

test('real tools have healthy controls and reject formatting without writing', async (t) => {
  withoutParentGitEnv(t);
  const fixture = ownedTemp(t);
  const tsFile = fixture.path('apps/dashboard/src/formatted.ts');
  const goFile = fixture.path('daemon/formatted.go');
  mkdirSync(path.dirname(tsFile), { recursive: true });
  mkdirSync(path.dirname(goFile), { recursive: true });
  writeFileSync(fixture.path('biome.json'), readFileSync(path.join(repoRoot, 'biome.json')));
  writeFileSync(fixture.path('.gitignore'), '');
  git(fixture.root, ['init', '-q']);
  const previousCwd = process.cwd();
  process.chdir(fixture.root);
  t.after(() => process.chdir(previousCwd));

  succeed(toolPath('biome'), ['--version'], { cwd: fixture.root, env: isolatedEnv() });
  succeed('gofmt', ['-d'], { cwd: repoRoot, env: isolatedEnv() });

  const tsFormatted = 'export const value = { answer: 42 };\n';
  const goFormatted = 'package fixture\n\nfunc value() {\n\tprintln("x")\n}\n';
  writeFileSync(tsFile, tsFormatted);
  writeFileSync(goFile, goFormatted);
  await biomeTask([tsFile]);
  await goTask([goFile]);

  const tsBroken = 'export const value={answer:42}\n';
  const goBroken = 'package fixture\nfunc value( ){println("x")}\n';
  writeFileSync(tsFile, tsBroken);
  writeFileSync(goFile, goBroken);
  await assert.rejects(
    () => biomeTask([tsFile]),
    (error) => assertToolFailure(error, /biome exited with status 1/),
  );
  await assert.rejects(
    () => goTask([goFile]),
    (error) => assertToolFailure(error, /gofmt: files above are not formatted/),
  );
  assert.equal(readFileSync(tsFile, 'utf8'), tsBroken);
  assert.equal(readFileSync(goFile, 'utf8'), goBroken);
});

test('TaskFunction arguments are shell-free, batched, and bounded', async (t) => {
  withoutParentGitEnv(t);
  const fixture = ownedTemp(t);
  const { bin, log } = createRecorder(fixture);
  withToolEnv(t, bin);

  await biomeTask([]);
  await goTask([]);
  assert.deepEqual(readCalls(log), []);

  const marker = fixture.path('injected');
  const special = `apps/dashboard/src/quote "'; touch ${path.basename(marker)}; $.ts`;
  await biomeTask([special]);
  await goTask(['daemon/a file with spaces.go']);
  assert.deepEqual(readCalls(log), [
    { command: 'biome', args: ['check', '--error-on-warnings', special] },
    { command: 'gofmt', args: ['-l', 'daemon/a file with spaces.go'] },
  ]);
  fixture.verify(fixture.root);
  assert.equal(existsSync(marker), false);

  fixture.remove(log);
  const files = Array.from({ length: 800 }, (_, index) => `apps/${'x'.repeat(80)}-${index}.ts`);
  await biomeTask(files);
  const calls = readCalls(log);
  assert.ok(calls.length > 1, 'large input should be split across subprocesses');
  for (const call of calls) {
    assertCommandBytes([call.command, ...call.args]);
  }
  assert.deepEqual(
    calls.flatMap((call) => call.args.slice(2)),
    files,
  );

  fixture.remove(log);
  await assert.rejects(() => biomeTask(['x'.repeat(MAX_ARG_BYTES)]), /file argument exceeds/);
  assert.deepEqual(readCalls(log), []);
});

test('TaskFunction drops external Git pollution without touching real Git state', async (t) => {
  const fixture = ownedTemp(t);
  const { bin } = createRecorder(fixture);
  withToolEnv(t, bin);
  const sentinelIndex = fixture.path('external-index');
  writeFileSync(sentinelIndex, 'external-index-sentinel');
  const realGitDir = git(repoRoot, ['rev-parse', '--absolute-git-dir']).trim();
  const realIndex = path.resolve(
    repoRoot,
    git(repoRoot, ['rev-parse', '--git-path', 'index']).trim(),
  );
  const realIndexBytes = readFileSync(realIndex);
  const external = {
    GIT_DIR: realGitDir,
    GIT_INDEX_FILE: sentinelIndex,
    GIT_WORK_TREE: repoRoot,
  };
  withoutParentGitEnv(t, external);

  await biomeTask(['apps/dashboard/src/clean.ts']);
  await goTask(['daemon/clean.go']);
  assert.equal(readFileSync(sentinelIndex, 'utf8'), 'external-index-sentinel');
  assert.deepEqual(readFileSync(realIndex), realIndexBytes);
  assert.deepEqual(
    Object.keys(process.env).filter((key) => key.startsWith('GIT_')),
    [],
  );
});

test('TaskFunction fails on spawn errors, signals, nonzero exits, and gofmt output', async (t) => {
  withoutParentGitEnv(t);
  const fixture = ownedTemp(t);
  const { bin, log, mode } = createRecorder(fixture);
  withToolEnv(t, bin);

  writeFileSync(mode, 'signal');
  await assert.rejects(() => biomeTask(['signal.ts']), /terminated by signal SIGTERM/);
  writeFileSync(mode, 'nonzero');
  await assert.rejects(() => biomeTask(['nonzero.ts']), /exited with status 17/);
  writeFileSync(mode, 'gofmt-output');
  await assert.rejects(() => goTask(['output.go']), /files above are not formatted/);

  fixture.remove(log);
  writeFileSync(mode, 'nonzero');
  const manyFiles = Array.from({ length: 800 }, (_, index) => `apps/${'x'.repeat(80)}-${index}.ts`);
  await assert.rejects(() => biomeTask(manyFiles), /exited with status 17/);
  assert.equal(readCalls(log).length, 1, 'failure should stop before the next batch');
  fixture.remove(mode);

  const callsBefore = readCalls(log).length;
  process.env.PATH = fixture.path('empty-bin');
  mkdirSync(process.env.PATH);
  await assert.rejects(() => biomeTask(['missing.ts']), /ENOENT/);
  assert.equal(readCalls(log).length, callsBefore, 'spawn error must stop immediately');
});

test('hook parser fails closed and understands rename/copy XY records', (t) => {
  const fixture = ownedTemp(t);
  const bin = fixture.path('bin');
  const log = fixture.path('pnpm-args.json');
  const repo = fixture.path('repo');
  mkdirSync(bin);
  mkdirSync(repo);

  executable(
    path.join(bin, 'git'),
    `#!/usr/bin/env node
const output = process.env.FAKE_GIT_OUTPUT || '';
if (process.env.GIT_OPTIONAL_LOCKS !== '0') process.exit(24);
if (process.env.GIT_INDEX_FILE !== process.env.EXPECTED_GIT_INDEX_FILE) process.exit(25);
if (process.env.FAKE_GIT_ERROR) process.exit(23);
process.stdout.write(Buffer.from(output, 'base64'));
`,
  );
  executable(
    path.join(bin, 'pnpm'),
    `#!/usr/bin/env node
if (process.env.GIT_OPTIONAL_LOCKS !== '0') process.exit(26);
if (process.env.GIT_INDEX_FILE !== process.env.EXPECTED_GIT_INDEX_FILE) process.exit(27);
require('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
`,
  );

  const expectedIndex = fixture.path('alternate-index');
  const baseEnv = isolatedEnv({
    PATH: `${bin}:${process.env.PATH}`,
    GIT_INDEX_FILE: expectedIndex,
    EXPECTED_GIT_INDEX_FILE: expectedIndex,
    MEOWTH_PRECOMMIT_SKIP_L1: '1',
  });
  const runHook = (extra = {}) =>
    spawn('sh', [hookPath], { cwd: repo, env: isolatedEnv({ ...baseEnv, ...extra }) });

  const expectedArgs = [
    'exec',
    'lint-staged',
    '--no-stash',
    '--no-hide-partially-staged',
    '--fail-on-changes',
  ];
  for (const output of [
    ' M independent.ts\0',
    'R  renamed.ts\0old.ts\0',
    ' C copied.ts\0source.ts\0',
  ]) {
    const allowed = runHook({ FAKE_GIT_OUTPUT: Buffer.from(output).toString('base64') });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), expectedArgs);
    fixture.remove(log);
  }

  for (const xy of ['RM renamed.ts\0old.ts\0', 'CM copied.ts\0source.ts\0']) {
    const rejected = runHook({ FAKE_GIT_OUTPUT: Buffer.from(xy).toString('base64') });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /partially staged tracked changes are not allowed/);
    assert.deepEqual(readCalls(log), []);
  }

  for (const output of ['M  \0', 'R  renamed.ts\0\0', 'R  renamed.ts\0old.ts']) {
    const malformed = runHook({ FAKE_GIT_OUTPUT: Buffer.from(output).toString('base64') });
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /malformed Git (?:rename\/copy )?status output/);
    assert.deepEqual(readCalls(log), []);
  }

  const failedGit = runHook({ FAKE_GIT_ERROR: '1' });
  assert.notEqual(failedGit.status, 0);
  assert.match(failedGit.stderr, /unable to inspect Git status \(status 23\)/);
  assert.deepEqual(readCalls(log), []);
});

test('real hook accepts staged TS/Go and unrelated user work without mutation', (t) => {
  const { fixture, repo, env } = createIntegrationRepo(t);
  writeFileSync(path.join(repo, 'apps/dashboard/src/staged.ts'), 'export const value = 2;\n');
  writeFileSync(
    path.join(repo, 'daemon/staged.go'),
    'package fixture\n\nfunc value() int {\n\treturn 2\n}\n',
  );
  git(repo, ['add', '--', 'apps/dashboard/src/staged.ts', 'daemon/staged.go'], { env });
  writeFileSync(path.join(repo, 'README.md'), 'unstaged user work\n');
  writeFileSync(path.join(repo, 'untracked user file.txt'), 'untracked user work\n');

  const sources = [
    'apps/dashboard/src/staged.ts',
    'daemon/staged.go',
    'README.md',
    'untracked user file.txt',
  ];
  const before = snapshot(repo, env, sources);
  const trace = fixture.path('git-trace.log');
  const hook = spawn('sh', [path.join(repo, '.husky/pre-commit')], {
    cwd: repo,
    env: integrationEnv(fixture, env, trace),
  });
  assert.equal(hook.status, 0, hook.stderr || hook.stdout);
  assert.match(hook.stdout, /pre-commit: OK/);
  assertSnapshot(repo, env, before);
  assert.equal(git(repo, ['stash', 'list'], { env }), '');
  assertReadOnlyTrace(trace);
});

test('real hook rejects formatting failures before modifying source or index', (t) => {
  const { fixture, repo, env } = createIntegrationRepo(t);
  writeFileSync(
    path.join(repo, 'apps/dashboard/src/staged.ts'),
    'export const value={answer:42}\n',
  );
  writeFileSync(
    path.join(repo, 'daemon/staged.go'),
    'package fixture\n\nfunc value() int {\n\treturn 2\n}\n',
  );
  git(repo, ['add', '--', 'apps/dashboard/src/staged.ts', 'daemon/staged.go'], { env });

  const sources = ['apps/dashboard/src/staged.ts', 'daemon/staged.go'];
  const before = snapshot(repo, env, sources);
  const trace = fixture.path('git-trace.log');
  const hook = spawn('sh', [path.join(repo, '.husky/pre-commit')], {
    cwd: repo,
    env: integrationEnv(fixture, env, trace),
  });
  assert.notEqual(hook.status, 0);
  assert.match(`${hook.stdout}\n${hook.stderr}`, /biome check --error-on-warnings/);
  assertSnapshot(repo, env, before);
  assert.equal(git(repo, ['stash', 'list'], { env }), '');
  assertReadOnlyTrace(trace);
});

test('real hook rejects gofmt failures before modifying source or index', (t) => {
  const { fixture, repo, env } = createIntegrationRepo(t);
  writeFileSync(
    path.join(repo, 'apps/dashboard/src/staged.ts'),
    'export const value = { answer: 42 };\n',
  );
  writeFileSync(
    path.join(repo, 'daemon/staged.go'),
    'package fixture\nfunc value( ){println("x")}\n',
  );
  git(repo, ['add', '--', 'apps/dashboard/src/staged.ts', 'daemon/staged.go'], { env });

  const sources = ['apps/dashboard/src/staged.ts', 'daemon/staged.go'];
  const before = snapshot(repo, env, sources);
  const trace = fixture.path('git-trace.log');
  const hook = spawn('sh', [path.join(repo, '.husky/pre-commit')], {
    cwd: repo,
    env: integrationEnv(fixture, env, trace),
  });
  assert.notEqual(hook.status, 0);
  assert.match(`${hook.stdout}\n${hook.stderr}`, /gofmt: files above are not formatted/);
  assertSnapshot(repo, env, before);
  assert.equal(git(repo, ['stash', 'list'], { env }), '');
  assertReadOnlyTrace(trace);
});

test('real hook rejects partially staged files and preserves their exact bytes', (t) => {
  const { fixture, repo, env } = createIntegrationRepo(t);
  const ts = path.join(repo, 'apps/dashboard/src/staged.ts');
  writeFileSync(ts, 'export const value = 2;\n');
  git(repo, ['add', '--', 'apps/dashboard/src/staged.ts'], { env });
  writeFileSync(ts, 'export const value = 3;\n// unstaged user work\n');

  const before = snapshot(repo, env, ['apps/dashboard/src/staged.ts']);
  const trace = fixture.path('git-trace.log');
  const hook = spawn('sh', [path.join(repo, '.husky/pre-commit')], {
    cwd: repo,
    env: integrationEnv(fixture, env, trace),
  });
  assert.notEqual(hook.status, 0);
  assert.match(hook.stderr, /partially staged tracked changes are not allowed/);
  assertSnapshot(repo, env, before);
  assert.equal(git(repo, ['stash', 'list'], { env }), '');
  assertReadOnlyTrace(trace);
});
