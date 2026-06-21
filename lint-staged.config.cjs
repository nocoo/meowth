// Per-file lint-staged config. Excludes basalt source-copies
// from biome formatting so they stay byte-for-byte verbatim
// per docs/architecture/06 §4.1.1 (the per-app biome.json
// `ignore` already covers `biome check` and `pnpm fmt:check`;
// lint-staged passes explicit file paths so we filter here too).
const BASALT_VERBATIM_RE = new RegExp(
  '^(?:.*/)?apps/dashboard/src/(?:' +
    'index\\.css|' +
    'lib/(?:utils|palette)\\.ts|' +
    'components/ui/.*\\.tsx?' +
    ')$',
);

function biomeCheck(files) {
  const formattable = files.filter((f) => !BASALT_VERBATIM_RE.test(f));
  if (formattable.length === 0) return [];
  return [`biome check --write --error-on-warnings ${formattable.map((f) => `"${f}"`).join(' ')}`];
}

function goFmt(files) {
  if (files.length === 0) return [];
  return [`gofmt -w ${files.map((f) => `"${f}"`).join(' ')}`];
}

module.exports = {
  '{apps,packages}/**/*.{ts,tsx}': biomeCheck,
  'daemon/**/*.go': goFmt,
};
