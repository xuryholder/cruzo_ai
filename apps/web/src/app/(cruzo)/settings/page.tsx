'use client';

import { useEffect, useState } from 'react';
import { TONES, type ContactTone } from '../_lib/manual-client';

type UiMessage = {
  type: 'success' | 'error';
  text: string;
};

type SettingsState = {
  timezone: string;
  defaultLanguage: string;
  defaultTone: ContactTone;
  defaultMaxWords: string;
};

const STORAGE_KEY = 'cruzo.settings.v1';

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>({
    timezone: 'UTC',
    defaultLanguage: 'en',
    defaultTone: 'neutral',
    defaultMaxWords: '100',
  });
  const [message, setMessage] = useState<UiMessage | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      setSettings((prev) => ({
        ...prev,
        ...parsed,
      }));
    } catch {
      // ignore localStorage parse issues
    }
  }, []);

  function saveSettings() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    setMessage({ type: 'success', text: 'Settings saved' });
  }

  function resetDefaults() {
    setSettings({
      timezone: 'UTC',
      defaultLanguage: 'en',
      defaultTone: 'neutral',
      defaultMaxWords: '100',
    });
    setMessage({ type: 'success', text: 'Default values restored' });
  }

  return (
    <div className="crz-page">
      <div className="crz-page-head">
        <div>
          <h1 className="crz-page-title">Settings</h1>
          <p className="crz-page-subtitle">Generation defaults and core system parameters</p>
        </div>
      </div>

      {message ? <p className={`crz-alert crz-alert-${message.type}`}>{message.text}</p> : null}

      <section className="crz-section crz-settings-grid">
        <article className="crz-panel">
          <h2 className="crz-section-title">Profile Defaults</h2>
          <div className="crz-stack">
            <label className="crz-label">
              Timezone
              <input
                className="crz-input"
                value={settings.timezone}
                onChange={(event) => setSettings((prev) => ({ ...prev, timezone: event.target.value }))}
              />
            </label>

            <label className="crz-label">
              Default language
              <input
                className="crz-input"
                value={settings.defaultLanguage}
                onChange={(event) => setSettings((prev) => ({ ...prev, defaultLanguage: event.target.value }))}
              />
            </label>

            <label className="crz-label">
              Default tone
              <select
                className="crz-select"
                value={settings.defaultTone}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    defaultTone: event.target.value as ContactTone,
                  }))
                }
              >
                {TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </select>
            </label>

            <label className="crz-label">
              Default max words
              <input
                className="crz-input"
                type="number"
                min={1}
                max={1000}
                value={settings.defaultMaxWords}
                onChange={(event) => setSettings((prev) => ({ ...prev, defaultMaxWords: event.target.value }))}
              />
            </label>

            <div className="crz-inline-row">
              <button className="crz-btn crz-btn-primary" type="button" onClick={saveSettings}>
                Save settings
              </button>
              <button className="crz-btn" type="button" onClick={resetDefaults}>
                Reset defaults
              </button>
            </div>
          </div>
        </article>

        <article className="crz-panel">
          <h2 className="crz-section-title">Security</h2>
          <div className="crz-stack">
            <p className="crz-row-meta">Access revocation and data deletion will be added in the next phase.</p>
            <button className="crz-btn" type="button" disabled>
              Revoke all tokens
            </button>
            <button className="crz-btn crz-btn-danger" type="button" disabled>
              Delete account data
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
