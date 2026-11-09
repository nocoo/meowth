const { spawnSync } = require('node:child_process');

const MAX_ARG_BYTES = 32 * 1024;

// Match the dashboard's Biome exclusions for explicit staged paths.
const DASHBOARD_BIOME_IGNORE_RE = new RegExp(
  '^(?:.*/)?apps/dashboard/src/(?:' +
    'index\\.css|' +
    'lib/utils\\.ts|' +
    'components/ui/.*\\.tsx?' +
    ')$',
);

function argBytes(args) {
  return args.reduce((total, arg) => total + Buffer.byteLength(arg) + 1, 0);
}

function fileBatches(command, fixedArgs, files) {
  const prefixBytes = argBytes([command, ...fixedArgs]);
  if (prefixBytes > MAX_ARG_BYTES) {
    throw new Error(`${command}: fixed arguments exceed ${MAX_ARG_BYTES} bytes`);
  }

  const batches = [];
  let batch = [];
  let bytes = prefixBytes;
  for (const file of files) {
    const fileBytes = Buffer.byteLength(file) + 1;
    if (prefixBytes + fileBytes > MAX_ARG_BYTES) {
      throw new Error(`${command}: file argument exceeds ${MAX_ARG_BYTES} bytes`);
    }
    if (batch.length > 0 && bytes + fileBytes > MAX_ARG_BYTES) {
      batches.push(batch);
      batch = [];
      bytes = prefixBytes;
    }
    batch.push(file);
    bytes += fileBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) throw result.error;
  if (capture && result.stdout) process.stdout.write(result.stdout);
  if (capture && result.stderr) process.stderr.write(result.stderr);
  if (result.signal) throw new Error(`${command} terminated by signal ${result.signal}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }

  return result.stdout ?? '';
}

async function biomeCheck(files) {
  const checkable = files.filter((file) => !DASHBOARD_BIOME_IGNORE_RE.test(file));
  const fixedArgs = ['check', '--error-on-warnings'];
  for (const batch of fileBatches('biome', fixedArgs, checkable)) {
    run('biome', [...fixedArgs, ...batch]);
  }
}

async function goFmtCheck(files) {
  for (const batch of fileBatches('gofmt', ['-l'], files)) {
    const output = run('gofmt', ['-l', ...batch], { capture: true });
    if (output !== '') throw new Error('gofmt: files above are not formatted');
  }
}

module.exports = {
  '{apps,packages}/**/*.{ts,tsx}': {
    title: 'biome check --error-on-warnings',
    task: biomeCheck,
  },
  'daemon/**/*.go': {
    title: 'gofmt -l',
    task: goFmtCheck,
  },
};
