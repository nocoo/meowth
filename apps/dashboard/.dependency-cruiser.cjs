// docs/architecture/06 §6.2 — MVVM import-boundary gate.
// Pinned dependency-cruiser@16.10.4 (engine compatible with
// node >=20).
//
// 3.13 lands the config; 3.17 adds pages/, models/, and viewmodels/
// directories that the forbidden rules below actually exercise.
// The depcruise CLI passes on an empty matched set, so the rule
// file is correct even before the directories exist.
module.exports = {
  forbidden: [
    {
      name: 'pages-must-not-import-models',
      severity: 'error',
      comment:
        'Pages own JSX only; they must consume models exclusively through viewmodels.',
      from: { path: '^src/pages/' },
      to: { path: '^src/models/' },
    },
    {
      name: 'pages-must-not-import-api',
      severity: 'error',
      comment:
        'Pages must not call fetch / api directly; viewmodels orchestrate that.',
      from: { path: '^src/pages/' },
      to: { path: '^src/lib/api' },
    },
    {
      name: 'models-must-not-import-react',
      severity: 'error',
      comment:
        'Models are pure TS data + fetch; React belongs in viewmodels/pages. The (/|$) suffix catches subpath imports like react-dom/client or react/jsx-runtime.',
      from: { path: '^src/models/' },
      to: { path: '^(react|react-dom|react-router)(/|$)' },
    },
    {
      name: 'viewmodels-must-not-import-pages',
      severity: 'error',
      comment: 'Viewmodels feed pages, never the other way around.',
      from: { path: '^src/viewmodels/' },
      to: { path: '^src/pages/' },
    },
    {
      name: 'models-must-not-import-pages-or-viewmodels',
      severity: 'error',
      comment: 'Models stay at the bottom of the MVVM stack.',
      from: { path: '^src/models/' },
      to: { path: '^src/(pages|viewmodels)/' },
    },
  ],
  options: {
    tsConfig: { fileName: './tsconfig.json' },
    moduleSystems: ['es6'],
    includeOnly: '^src/',
  },
};
