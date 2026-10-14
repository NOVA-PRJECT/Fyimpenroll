export const THEME_KEY = 'fyimp:theme'
export const THEME_POSITION_KEY = 'fyimp:theme-position'

export const THEME_INIT_SCRIPT = `(() => {
  let theme;
  try { theme = localStorage.getItem('${THEME_KEY}'); } catch {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();`
