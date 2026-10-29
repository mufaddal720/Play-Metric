import { type ReactNode, useEffect, useState } from 'react';
import { Logo } from './Logo';
import { useT, AVAILABLE_LANGS } from '../i18n';
import { useStore } from '../core/store';
import { UAE_TIMEZONE } from '../lib/time';

function UaeClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(i); }, []);
  const txt = new Intl.DateTimeFormat('en-AE', { timeZone: UAE_TIMEZONE, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).format(now);
  return <span title="Asia/Dubai (GST, UTC+4)" className="tabular-nums">{txt} GST</span>;
}

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const t = useT();
  const { settings, updateSettings } = useStore();
  const [menu, setMenu] = useState(false);
  const links = [['#/', t('home')], ['#/how', t('howToPlay')], ['#/history', t('history')], ['#/settings', t('settings')]] as const;
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flag-bar h-1 w-full" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <a href="#/" className="flex min-w-0 items-center gap-3" aria-label={t('appName')}>
            <Logo />
            <div className="min-w-0 leading-tight">
              <div className="truncate font-extrabold tracking-tight">{t('appName')}</div>
              <div className="truncate text-xs text-ink-300">{t('location')} · <UaeClock /></div>
            </div>
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map(([href, label]) => <a key={href} href={href} className="rounded-lg px-3 py-2 text-sm text-ink-200 hover:bg-ink-700 hover:text-white">{label}</a>)}
            <label className="sr-only" htmlFor="lang">{t('language')}</label>
            <select id="lang" className="ms-2 rounded-lg border border-ink-600 bg-ink-800 px-2 py-2 text-sm" value={settings.lang}
              onChange={(e) => updateSettings({ lang: e.target.value as 'en' | 'ar' })}>
              {AVAILABLE_LANGS.map((l) => <option key={l.code} value={l.code} disabled={!l.ready}>{l.ready ? l.label : `${l.label} — ${t('arabicPending')}`}</option>)}
            </select>
          </nav>
          <button className="btn-ghost md:hidden" aria-expanded={menu} aria-controls="mobile-nav" onClick={() => setMenu(!menu)}>☰<span className="sr-only">Menu</span></button>
        </div>
        {menu && (
          <nav id="mobile-nav" className="border-t border-ink-700 px-4 py-2 md:hidden" aria-label="Mobile">
            {links.map(([href, label]) => <a key={href} href={href} onClick={() => setMenu(false)} className="block rounded-lg px-3 py-3 text-ink-100 hover:bg-ink-700">{label}</a>)}
          </nav>
        )}
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-6 ${wide ? 'max-w-7xl' : 'max-w-6xl'}`}>{children}</main>
      <footer className="border-t border-ink-700 px-4 py-5 text-center text-xs text-ink-300">
        <div>{t('appName')} · {t('gameTitle')} · {t('location')}</div>
        <div className="mt-1">{t('onDevice')} · <a className="underline" href="#/privacy">{t('privacy')}</a> · Times shown in {t('uaeTime')}</div>
      </footer>
    </div>
  );
}
