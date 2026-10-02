/** Colour mode: a person's choice of light, dark, or following the operating system. */
export type ColorMode = 'light' | 'dark' | 'system';
export const COLOR_MODES: readonly ColorMode[] = ['light', 'dark', 'system'];

const KEY = 'grids.colorMode';
const media = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** The mode remembered on this device (used before the server preference loads). */
export function storedColorMode(): ColorMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

let unsubscribe: (() => void) | undefined;

/**
 * Applies a mode by setting `data-theme` on <html>; "system" follows the OS live.
 * The choice is cached locally so the next page load paints in the right mode.
 */
export function applyColorMode(mode: ColorMode, root: HTMLElement = document.documentElement) {
  unsubscribe?.();
  unsubscribe = undefined;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable: the mode still applies for this page */
  }
  const set = (dark: boolean) => root.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (mode !== 'system') return set(mode === 'dark');
  const mq = media();
  set(!!mq?.matches);
  if (mq) {
    const onChange = (e: MediaQueryListEvent) => set(e.matches);
    mq.addEventListener('change', onChange);
    unsubscribe = () => mq.removeEventListener('change', onChange);
  }
}

/** Inline script for index.html <head>: applies the cached mode before first paint (no flash). */
export const COLOR_MODE_BOOT = `try{var m=localStorage.getItem('${KEY}')||'system';document.documentElement.setAttribute('data-theme',m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light')}catch(e){}`;
