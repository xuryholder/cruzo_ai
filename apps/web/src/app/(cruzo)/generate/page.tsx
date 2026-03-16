'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  TONES,
  type ContactItem,
  type ContactTone,
  type ListResult,
  type MessageDraftItem,
  type MessageLogItem,
  apiRequest,
  createIdempotencyKey,
  formatDate,
  labelEnum,
} from '../_lib/manual-client';

type MessageDetailResult = {
  draft: MessageDraftItem;
  logs: MessageLogItem[];
};

type UiMessage = {
  type: 'success' | 'error' | 'info';
  text: string;
};

const VISUAL_THEMES = [
  'linear-gradient(145deg, #fff4db, #ffd4c0)',
  'linear-gradient(145deg, #dff7ff, #d9e4ff)',
  'linear-gradient(145deg, #e9ffd9, #d4ffe7)',
  'linear-gradient(145deg, #ffe3f5, #f6ddff)',
] as const;

export default function GeneratePage() {
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [recentDrafts, setRecentDrafts] = useState<MessageDraftItem[]>([]);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [toneOverride, setToneOverride] = useState<'default' | ContactTone>('default');
  const [language, setLanguage] = useState('en');
  const [maxWords, setMaxWords] = useState('100');

  const [draft, setDraft] = useState<MessageDraftItem | null>(null);
  const [logs, setLogs] = useState<MessageLogItem[]>([]);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [visualTheme, setVisualTheme] = useState<string>(VISUAL_THEMES[0]);

  const contactName = useMemo(() => {
    if (!selectedContactId) {
      return 'Contact';
    }

    const found = contacts.find((item) => item.id === selectedContactId);
    return found?.name || found?.email || 'Contact';
  }, [contacts, selectedContactId]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (contacts.length > 0 && !selectedContactId) {
      setSelectedContactId(contacts[0].id);
    }
  }, [contacts, selectedContactId]);

  async function bootstrap() {
    setLoading(true);
    const [contactsResult, draftsResult] = await Promise.all([
      apiRequest<ListResult<ContactItem>>('/api/manual/contacts?limit=100&sort=updated_at'),
      apiRequest<ListResult<MessageDraftItem>>('/api/manual/messages?limit=20&sort=updated_at'),
    ]);

    setLoading(false);

    if (!contactsResult.ok || !contactsResult.data) {
      setMessage({ type: 'error', text: `Failed to load contacts: ${contactsResult.errorMessage}` });
      return;
    }

    if (!draftsResult.ok || !draftsResult.data) {
      setMessage({ type: 'error', text: `Failed to load drafts: ${draftsResult.errorMessage}` });
      return;
    }

    setContacts(contactsResult.data.items);
    setRecentDrafts(draftsResult.data.items);
  }

  async function loadDraft(messageId: string) {
    const result = await apiRequest<MessageDetailResult>(`/api/manual/messages/${messageId}`);
    if (!result.ok || !result.data) {
      setMessage({ type: 'error', text: `Failed to open draft: ${result.errorMessage}` });
      return;
    }

    setDraft(result.data.draft);
    setLogs(result.data.logs);
    setSubject(result.data.draft.subject);
    setText(result.data.draft.text);
    setSelectedContactId(result.data.draft.contactId);
  }

  async function refreshDraftAndList(messageId: string) {
    await Promise.all([loadDraft(messageId), refreshRecentDrafts()]);
  }

  async function refreshRecentDrafts() {
    const result = await apiRequest<ListResult<MessageDraftItem>>('/api/manual/messages?limit=20&sort=updated_at');
    if (result.ok && result.data) {
      setRecentDrafts(result.data.items);
    }
  }

  async function generateDraft() {
    if (!selectedContactId) {
      setMessage({ type: 'error', text: 'Select a contact to generate a message' });
      return;
    }

    const parsedMaxWords = Number.parseInt(maxWords, 10);
    const payload: {
      contactId: string;
      tone?: ContactTone;
      language?: string;
      maxWords?: number;
    } = {
      contactId: selectedContactId,
    };

    if (toneOverride !== 'default') {
      payload.tone = toneOverride;
    }

    const normalizedLanguage = language.trim().toLowerCase();
    if (normalizedLanguage.length > 0) {
      payload.language = normalizedLanguage;
    }

    if (Number.isFinite(parsedMaxWords) && parsedMaxWords > 0) {
      payload.maxWords = parsedMaxWords;
    }

    const result = await apiRequest<MessageDraftItem>('/api/manual/messages/generate', {
      method: 'POST',
      body: payload,
    });

    if (!result.ok || !result.data) {
      setMessage({ type: 'error', text: `Generate error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Draft created' });
    await refreshDraftAndList(result.data.id);
  }

  async function saveDraftText() {
    if (!draft) {
      return;
    }

    const result = await apiRequest<MessageDraftItem>(`/api/manual/messages/${draft.id}`, {
      method: 'PATCH',
      body: {
        text,
      },
    });

    if (!result.ok) {
      setMessage({ type: 'error', text: `Save error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Draft text updated' });
    await refreshDraftAndList(draft.id);
  }

  async function approveDraft() {
    if (!draft) {
      return;
    }

    const result = await apiRequest<MessageDraftItem>(`/api/manual/messages/${draft.id}/approve`, {
      method: 'PATCH',
      body: {
        subject,
        text,
      },
    });

    if (!result.ok) {
      setMessage({ type: 'error', text: `Approve error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Draft approved' });
    await refreshDraftAndList(draft.id);
  }

  async function sendNow() {
    if (!draft) {
      return;
    }

    const result = await apiRequest<{ draft: MessageDraftItem; idempotent: boolean }>(
      `/api/manual/messages/${draft.id}/send-now`,
      {
        method: 'POST',
        headers: {
          'x-idempotency-key': createIdempotencyKey('generate-send'),
        },
        body: {
          channel: 'email',
        },
      },
    );

    if (!result.ok) {
      setMessage({ type: 'error', text: `Send error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Sent successfully' });
    await refreshDraftAndList(draft.id);
  }

  async function retryDraft() {
    if (!draft) {
      return;
    }

    const result = await apiRequest<{ draft: MessageDraftItem; idempotent: boolean }>(
      `/api/manual/messages/${draft.id}/retry`,
      {
        method: 'POST',
        headers: {
          'x-idempotency-key': createIdempotencyKey('generate-retry'),
        },
        body: {},
      },
    );

    if (!result.ok) {
      setMessage({ type: 'error', text: `Retry error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Retry sent successfully' });
    await refreshDraftAndList(draft.id);
  }

  function regenerateVisual() {
    const index = Math.floor(Math.random() * VISUAL_THEMES.length);
    setVisualTheme(VISUAL_THEMES[index]);
  }

  return (
    <div className="crz-page">
      <div className="crz-page-head">
        <div>
          <h1 className="crz-page-title">Generate</h1>
          <p className="crz-page-subtitle">Unified space to generate card text and visuals</p>
        </div>

        <button className="crz-btn" type="button" onClick={() => void bootstrap()} disabled={loading}>
          Refresh
        </button>
      </div>

      {message ? <p className={`crz-alert crz-alert-${message.type}`}>{message.text}</p> : null}

      <section className="crz-section crz-generate-grid">
        <article className="crz-panel">
          <h2 className="crz-section-title">Parameters</h2>
          <div className="crz-stack">
            <select
              className="crz-select"
              value={selectedContactId}
              onChange={(event) => setSelectedContactId(event.target.value)}
            >
              <option value="">Select contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name || contact.email || contact.id}
                </option>
              ))}
            </select>

            <select
              className="crz-select"
              value={toneOverride}
              onChange={(event) => setToneOverride(event.target.value as 'default' | ContactTone)}
            >
              <option value="default">Tone: contact default</option>
              {TONES.map((toneItem) => (
                <option key={toneItem} value={toneItem}>
                  Tone: {labelEnum(toneItem)}
                </option>
              ))}
            </select>

            <input
              className="crz-input"
              placeholder="Language (default en)"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            />

            <input
              className="crz-input"
              type="number"
              min={1}
              max={1000}
              value={maxWords}
              onChange={(event) => setMaxWords(event.target.value)}
            />

            <div className="crz-inline-row">
              <button className="crz-btn crz-btn-primary" type="button" onClick={() => void generateDraft()}>
                Generate message
              </button>
              <button className="crz-btn" type="button" onClick={regenerateVisual}>
                Generate visual
              </button>
            </div>
          </div>
        </article>

        <article className="crz-panel">
          <h2 className="crz-section-title">Result</h2>

          {!draft ? <p className="crz-empty">Generate a draft first</p> : null}
          {draft ? (
            <div className="crz-stack">
              <p className="crz-row-meta">
                Status: <strong>{labelEnum(draft.status)}</strong> | Updated: {formatDate(draft.updatedAt)}
              </p>

              <input
                className="crz-input"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={120}
              />

              <textarea
                className="crz-textarea"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={1000}
              />

              <div className="crz-inline-row">
                <button className="crz-btn" type="button" onClick={() => void saveDraftText()} disabled={draft.status !== 'draft'}>
                  Save draft
                </button>
                <button
                  className="crz-btn crz-btn-primary"
                  type="button"
                  onClick={() => void approveDraft()}
                  disabled={draft.status !== 'draft'}
                >
                  Approve
                </button>
                <button
                  className="crz-btn crz-btn-primary"
                  type="button"
                  onClick={() => void sendNow()}
                  disabled={draft.status !== 'approved'}
                >
                  Send now
                </button>
                <button className="crz-btn" type="button" onClick={() => void retryDraft()} disabled={draft.status !== 'failed'}>
                  Retry
                </button>
              </div>

              <p className="crz-note">Subject is saved on Approve. Save draft updates text only.</p>
            </div>
          ) : null}
        </article>
      </section>

      <section className="crz-section crz-generate-grid">
        <article className="crz-panel">
          <h2 className="crz-section-title">Visual Preview</h2>
          <div className="crz-visual-card" style={{ background: visualTheme }}>
            <p className="crz-visual-title">{subject || `Happy Birthday, ${contactName}`}</p>
            <p className="crz-visual-text">{text || 'Generated message preview will be shown here.'}</p>
          </div>
        </article>

        <article className="crz-panel">
          <h2 className="crz-section-title">Recent Drafts</h2>
          <div className="crz-list">
            {recentDrafts.length === 0 ? <p className="crz-empty">No drafts yet</p> : null}
            {recentDrafts.map((item) => (
              <article className="crz-row" key={item.id}>
                <div>
                  <p className="crz-row-title">{item.subject}</p>
                  <p className="crz-row-meta">
                    {labelEnum(item.status)} | {formatDate(item.updatedAt)}
                  </p>
                </div>
                <button className="crz-btn" type="button" onClick={() => void loadDraft(item.id)}>
                  Open
                </button>
              </article>
            ))}
          </div>

          <h2 className="crz-section-title">Recent Logs</h2>
          <div className="crz-list">
            {logs.length === 0 ? <p className="crz-empty">No logs</p> : null}
            {logs.map((log) => (
              <article className="crz-row" key={log.id}>
                <div>
                  <p className="crz-row-title">
                    {labelEnum(log.action)} ({labelEnum(log.status)})
                  </p>
                  <p className="crz-row-meta">
                    {formatDate(log.timestamp)} | channel: {log.channel ? labelEnum(log.channel) : 'N/A'}
                  </p>
                  {log.error ? <p className="crz-row-meta">error: {log.error}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
