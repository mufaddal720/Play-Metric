import { useEffect, useState } from 'react';
import { useStore } from '../core/store';
import { deleteMediaWithPrefix, listMediaKeys } from '../core/mediaStore';
import { AVAILABLE_LANGS, useT } from '../i18n';
import { Card, Notice, SectionTitle } from '../ui/kit';
import { UAE_TIMEZONE, formatUaeDateTime } from '../lib/time';

export function Settings() {
  const t = useT();
  const { settings, updateSettings, clearHistory, matches } = useStore();
  const [mediaCount, setMediaCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => listMediaKeys().then((k) => setMediaCount(k.length));
  useEffect(() => { refresh(); }, []);
  const toggle = (k: 'saveClips' | 'allowVoiceGuesses' | 'rtlPreview' | 'largeText', label: string, help: string) => (
    <label className="flex items-start gap-3 rounded-xl bg-ink-900 p-3">
      <input type="checkbox" className="mt-1 h-5 w-5" checked={settings[k]} onChange={(e) => updateSettings({ [k]: e.target.checked })} />
      <span><span className="font-semibold">{label}</span><br /><span className="text-sm text-ink-300">{help}</span></span>
    </label>
  );
  return (
    <div className="space-y-4">
      <SectionTitle>{t('settings')}</SectionTitle>
      <Card className="space-y-3">
        <h3 className="font-bold">Language & display</h3>
        <label className="label" htmlFor="set-lang">{t('language')}</label>
        <select id="set-lang" className="input max-w-sm" value={settings.lang} onChange={(e) => updateSettings({ lang: e.target.value as 'en' | 'ar' })}>
          {AVAILABLE_LANGS.map((l) => <option key={l.code} value={l.code} disabled={!l.ready}>{l.ready ? l.label : `${l.label} — ${t('arabicPending')}`}</option>)}
        </select>
        <p className="text-sm text-ink-300">Arabic will be enabled once a reviewed human translation is added — we do not show machine-translated Arabic.</p>
        {toggle('rtlPreview', 'Right-to-left layout preview', 'Checks that every screen mirrors correctly for Arabic (text stays in English).')}
        {toggle('largeText', 'Larger text', 'Increases the base font size across the app.')}
        <p className="text-sm text-ink-300">Time zone: {UAE_TIMEZONE} (Gulf Standard Time, UTC+4). Now: {formatUaeDateTime(Date.now())}.</p>
      </Card>
      <Card className="space-y-3">
        <h3 className="font-bold">Privacy & recordings</h3>
        {toggle('saveClips', 'Save round recordings on this device', 'Off by default. When on, each Freeze & Fool round and Action Detective turn is recorded (with a visible recording badge) and kept only in this browser for replay as evidence.')}
        {toggle('allowVoiceGuesses', 'Allow voice guesses in Action Detective', 'Off by default. Uses the browser’s speech service; in Chrome, audio is processed by Google.')}
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={async () => { const n = await deleteMediaWithPrefix(''); setMsg(`Deleted ${n} recordings/snapshots.`); refresh(); }}>
            Delete all recordings and snapshots{mediaCount !== null ? ` (${mediaCount})` : ''}
          </button>
          <button className="btn-danger" onClick={async () => {
            if (!confirm(`Delete all ${matches.length} matches from history? This cannot be undone.`)) return;
            clearHistory(); await deleteMediaWithPrefix(''); setMsg('Match history and media deleted.'); refresh();
          }}>Delete match history</button>
        </div>
        {msg && <Notice kind="ok">{msg}</Notice>}
        <a className="text-sm underline" href="#/privacy">Read the privacy notice</a>
      </Card>
    </div>
  );
}
