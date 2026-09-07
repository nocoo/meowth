// Match the dashboard's Biome exclusions for explicit staged paths.
const DASHBOARD_BIOME_IGNORE_RE = new RegExp(
  '^(?:.*/)?apps/dashboard/src/(?:' +
    'index\\.css|' +
    'lib/utils\\.ts|' +
    'components/ui/.*\\.tsx?' +
    ')$',
);

function biomeCheck(files) {
  const formattable = files.filter((f) => !DASHBOARD_BIOME_IGNORE_RE.test(f));
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
