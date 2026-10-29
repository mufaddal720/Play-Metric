import { useEffect, useState } from 'react';

/** Minimal hash router: works on any static host (GitHub Pages, a .ae domain, a sub-path) without server rewrites. */
export function useRoute(): string[] {
  const parse = () => (window.location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => { setR(parse()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path: string) => { window.location.hash = path.startsWith('/') ? path : `/${path}`; };
