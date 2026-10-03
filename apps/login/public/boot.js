// Applies the remembered colour mode before first paint (external file: the CSP forbids inline scripts).
try {
  var m = localStorage.getItem('grids.colorMode') || 'system';
  document.documentElement.setAttribute(
    'data-theme',
    m === 'dark' || (m === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light',
  );
} catch (e) {}
