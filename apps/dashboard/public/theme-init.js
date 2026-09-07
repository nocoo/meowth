(function () {
  var stored = null;
  try {
    stored = window.localStorage.getItem('meowth_theme');
  } catch (e) {}
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isDark = stored === 'dark' || (stored !== 'light' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('light', !isDark);
  document.documentElement.setAttribute('data-mode', isDark ? 'dark' : 'light');
})();
