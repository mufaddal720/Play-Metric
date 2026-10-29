import { useEffect } from 'react';
import { en, type Dict } from './en';
import { useStore } from '../core/store';

/**
 * Translation layer. Only English ships today. An Arabic dictionary will be added here once a
 * native speaker has reviewed it — we deliberately do not show machine-translated Arabic.
 * The layout already supports right-to-left via the `dir` attribute (see Settings → RTL preview).
 */
const dictionaries: Record<'en' | 'ar', Partial<Dict>> = { en, ar: {} };
export const AVAILABLE_LANGS = [
  { code: 'en' as const, label: 'English', ready: true },
  { code: 'ar' as const, label: 'العربية', ready: false },
];

export function useT() {
  const lang = useStore((s) => s.settings.lang);
  return (k: keyof Dict) => dictionaries[lang][k] ?? en[k];
}

export function useDocumentDirection() {
  const { lang, rtlPreview, largeText } = useStore((s) => s.settings);
  useEffect(() => {
    const rtl = lang === 'ar' || rtlPreview;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.style.fontSize = largeText ? '18px' : '16px';
  }, [lang, rtlPreview, largeText]);
}
