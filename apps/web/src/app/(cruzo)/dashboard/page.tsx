'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type ContactItem,
  type ListResult,
  type MessageDraftItem,
  apiRequest,
  createIdempotencyKey,
  formatDate,
  labelEnum,
  todayIsoDate,
} from '../_lib/manual-client';

type BirthdaysResult = {
  date: string;
  items: ContactItem[];
};

type UiMessage = {
  type: 'success' | 'error' | 'info';
  text: string;
};

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [birthdays, setBirthdays] = useState<ContactItem[]>([]);
  const [drafts, setDrafts] = useState<MessageDraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const birthdaysByContact = useMemo(() => {
    const map = new Map<string, ContactItem>();
    for (const contact of birthdays) {
      map.set(contact.id, contact);
    }

    return map;
  }, [birthdays]);

  const latestDraftByContact = useMemo(() => {
    const map = new Map<string, MessageDraftItem>();
    for (const draft of drafts) {
      if (!map.has(draft.contactId)) {
        map.set(draft.contactId, draft);
      }
    }

    return map;
  }, [drafts]);

  const actionQueue = useMemo(() => {
    const items: Array<{
      contact: ContactItem;
      draft: MessageDraftItem | null;
    }> = [];

    for (const contact of birthdays) {
      items.push({
        contact,
        draft: latestDraftByContact.get(contact.id) || null,
      });
    }

    return items;
  }, [birthdays, latestDraftByContact]);

  const counters = useMemo(() => {
    const totalBirthdays = birthdays.length;
    const needsApproval = drafts.filter((item) => item.status === 'draft').length;
    const failed = drafts.filter((item) => item.status === 'failed').length;
    const sent = drafts.filter((item) => item.status === 'sent').length;

    return { totalBirthdays, needsApproval, failed, sent };
  }, [birthdays, drafts]);

  const recentResults = useMemo(() => {
    return drafts.filter((item) => item.status === 'sent' || item.status === 'failed').slice(0, 8);
  }, [drafts]);

  useEffect(() => {
    void loadData();
  }, [selectedDate]);

  async function loadData() {
    setLoading(true);
    const [birthdaysResult, draftsResult] = await Promise.all([
      apiRequest<BirthdaysResult>(`/api/manual/birthdays/today?date=${selectedDate}`),
      apiRequest<ListResult<MessageDraftItem>>('/api/manual/messages?limit=100&sort=updated_at'),
    ]);

    setLoading(false);

    if (!birthdaysResult.ok || !birthdaysResult.data) {
      setMessage({ type: 'error', text: `Failed to load dashboard: ${birthdaysResult.errorMessage}` });
      return;
    }

    if (!draftsResult.ok || !draftsResult.data) {
      setMessage({ type: 'error', text: `Failed to load statuses: ${draftsResult.errorMessage}` });
      return;
    }

    setBirthdays(birthdaysResult.data.items);
    setDrafts(draftsResult.data.items);
  }

  async function generateForContact(contactId: string) {
    const result = await apiRequest<MessageDraftItem>('/api/manual/messages/generate', {
      method: 'POST',
      body: { contactId },
    });

    if (!result.ok) {
      setMessage({ type: 'error', text: `Generate error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Draft created' });
    await loadData();
  }

  async function approveDraft(draft: MessageDraftItem) {
    const result = await apiRequest<MessageDraftItem>(`/api/manual/messages/${draft.id}/approve`, {
      method: 'PATCH',
      body: {
        subject: draft.subject,
        text: draft.text,
      },
    });

    if (!result.ok) {
      setMessage({ type: 'error', text: `Approve error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Draft approved' });
    await loadData();
  }

  async function sendNow(draft: MessageDraftItem) {
    const result = await apiRequest<{ draft: MessageDraftItem; idempotent: boolean }>(
      `/api/manual/messages/${draft.id}/send-now`,
      {
        method: 'POST',
        headers: {
          'x-idempotency-key': createIdempotencyKey('dashboard-send'),
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

    setMessage({ type: 'success', text: result.data?.idempotent ? 'Repeated send (idempotent)' : 'Sent' });
    await loadData();
  }

  async function retryDraft(draft: MessageDraftItem) {
    const result = await apiRequest<{ draft: MessageDraftItem; idempotent: boolean }>(
      `/api/manual/messages/${draft.id}/retry`,
      {
        method: 'POST',
        headers: {
          'x-idempotency-key': createIdempotencyKey('dashboard-retry'),
        },
        body: {},
      },
    );

    if (!result.ok) {
      setMessage({ type: 'error', text: `Retry error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Retry completed' });
    await loadData();
  }

  return (
    <div className="crz-page">
      <div className="crz-page-head">
        <div>
          <h1 className="crz-page-title">Dashboard</h1>
          <p className="crz-page-subtitle">Main workspace for daily operations</p>
        </div>

        <div className="crz-inline-row">
          <input
            className="crz-input"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
          <button className="crz-btn" type="button" onClick={() => void loadData()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {message ? (
        <p className={`crz-alert crz-alert-${message.type}`}>{message.text}</p>
      ) : null}

      <div className="crz-kpi-grid">
        <article className="crz-kpi-card">
          <p className="crz-kpi-label">Birthdays Today</p>
          <p className="crz-kpi-value">{counters.totalBirthdays}</p>
        </article>
        <article className="crz-kpi-card">
          <p className="crz-kpi-label">Needs Approval</p>
          <p className="crz-kpi-value">{counters.needsApproval}</p>
        </article>
        <article className="crz-kpi-card">
          <p className="crz-kpi-label">Failed</p>
          <p className="crz-kpi-value">{counters.failed}</p>
        </article>
        <article className="crz-kpi-card">
          <p className="crz-kpi-label">Sent</p>
          <p className="crz-kpi-value">{counters.sent}</p>
        </article>
      </div>

      <section className="crz-section">
        <h2 className="crz-section-title">Today</h2>

        <div className="crz-list">
          {actionQueue.length === 0 ? <p className="crz-empty">No birthdays on the selected date</p> : null}
          {actionQueue.map(({ contact, draft }) => (
            <article className="crz-row" key={contact.id}>
              <div>
                <p className="crz-row-title">{contact.name || contact.email || 'Unnamed contact'}</p>
                <p className="crz-row-meta">
                  {contact.email || 'no-email'} | {labelEnum(contact.relationship)} | {labelEnum(contact.tone)}
                </p>
                <p className="crz-row-meta">
                  Status: <strong>{draft ? labelEnum(draft.status) : 'No Draft'}</strong>
                </p>
              </div>

              <div className="crz-row-actions">
                <button className="crz-btn" type="button" onClick={() => void generateForContact(contact.id)}>
                  Generate
                </button>
                <button
                  className="crz-btn"
                  type="button"
                  disabled={!draft || draft.status !== 'draft'}
                  onClick={() => {
                    if (draft) {
                      void approveDraft(draft);
                    }
                  }}
                >
                  Approve
                </button>
                <button
                  className="crz-btn crz-btn-primary"
                  type="button"
                  disabled={!draft || draft.status !== 'approved'}
                  onClick={() => {
                    if (draft) {
                      void sendNow(draft);
                    }
                  }}
                >
                  Send now
                </button>
                <button
                  className="crz-btn"
                  type="button"
                  disabled={!draft || draft.status !== 'failed'}
                  onClick={() => {
                    if (draft) {
                      void retryDraft(draft);
                    }
                  }}
                >
                  Retry
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="crz-section">
        <h2 className="crz-section-title">Recent Sends</h2>

        <div className="crz-list">
          {recentResults.length === 0 ? <p className="crz-empty">No sent messages yet</p> : null}
          {recentResults.map((draft) => (
            <article className="crz-row" key={draft.id}>
              <div>
                <p className="crz-row-title">{draft.subject}</p>
                <p className="crz-row-meta">
                  {labelEnum(draft.status)} | {draft.channel ? labelEnum(draft.channel) : 'N/A'} | {formatDate(draft.updatedAt)}
                </p>
                <p className="crz-row-meta">
                  {birthdaysByContact.get(draft.contactId)?.name || draft.contactId}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
