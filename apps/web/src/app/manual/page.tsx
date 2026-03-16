'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

const RELATIONSHIPS = [
  'family',
  'friend',
  'colleague',
  'client',
  'partner',
  'acquaintance',
  'other',
] as const;
const TONES = ['formal', 'semi_formal', 'friendly', 'warm', 'playful', 'neutral'] as const;
const SOURCES = [
  'manual_test',
  'manual',
  'google_contacts',
  'google_calendar',
  'gmail_parse',
  'linkedin_extension',
  'facebook_extension',
  'import_csv',
] as const;
const DRAFT_STATUSES = ['draft', 'approved', 'sent', 'failed'] as const;
const SEND_CHANNELS = ['email', 'telegram', 'whatsapp', 'instagram', 'facebook'] as const;
const MARK_SENT_CHANNELS = ['manual', ...SEND_CHANNELS] as const;

type Relationship = (typeof RELATIONSHIPS)[number];
type Tone = (typeof TONES)[number];
type Source = (typeof SOURCES)[number];
type DraftStatus = (typeof DRAFT_STATUSES)[number];
type SendChannel = (typeof SEND_CHANNELS)[number];
type MarkSentChannel = (typeof MARK_SENT_CHANNELS)[number];

type Contact = {
  id: string;
  name: string | null;
  email: string | null;
  birthdayDate: string;
  relationship: Relationship;
  tone: Tone;
  source: Source;
  createdAt: string;
  updatedAt: string;
};

type MessageDraft = {
  id: string;
  contactId: string;
  subject: string;
  text: string;
  status: DraftStatus;
  channel: MarkSentChannel | null;
  language: string;
  tone: Tone;
  maxWords: number;
  createdAt: string;
  updatedAt: string;
};

type MessageLog = {
  id: string;
  action: string;
  status: string;
  channel: string | null;
  externalMessageId: string | null;
  error: string | null;
  notes: string | null;
  timestamp: string;
};

type PaginatedResult<T> = {
  items: T[];
  nextCursor: string | null;
};

type BirthdaysResult = {
  date: string;
  items: Contact[];
};

type MessageDetailResult = {
  draft: MessageDraft;
  logs: MessageLog[];
};

type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  errorMessage: string | null;
};

type Feedback = {
  type: 'success' | 'error' | 'info';
  text: string;
};

const DEFAULT_LIMIT = 20;
const TODAY = new Date().toISOString().slice(0, 10);

export default function ManualPage() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsNextCursor, setContactsNextCursor] = useState<string | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);

  const [contactQuery, setContactQuery] = useState('');
  const [contactRelationshipFilter, setContactRelationshipFilter] = useState<'all' | Relationship>('all');
  const [hasBirthdayTodayFilter, setHasBirthdayTodayFilter] = useState(false);

  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createBirthdayDate, setCreateBirthdayDate] = useState(TODAY);
  const [createRelationship, setCreateRelationship] = useState<Relationship>('other');
  const [createTone, setCreateTone] = useState<Tone>('neutral');
  const [createSource, setCreateSource] = useState<Source>('manual_test');

  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editBirthdayDate, setEditBirthdayDate] = useState(TODAY);
  const [editRelationship, setEditRelationship] = useState<Relationship>('other');
  const [editTone, setEditTone] = useState<Tone>('neutral');
  const [editSource, setEditSource] = useState<Source>('manual_test');

  const [birthdaysDate, setBirthdaysDate] = useState(TODAY);
  const [todayBirthdays, setTodayBirthdays] = useState<Contact[]>([]);
  const [birthdaysLoading, setBirthdaysLoading] = useState(false);

  const [drafts, setDrafts] = useState<MessageDraft[]>([]);
  const [draftsNextCursor, setDraftsNextCursor] = useState<string | null>(null);
  const [draftsLoading, setDraftsLoading] = useState(false);

  const [draftStatusFilter, setDraftStatusFilter] = useState<'all' | DraftStatus>('all');
  const [draftChannelFilter, setDraftChannelFilter] = useState<'all' | MarkSentChannel>('all');
  const [draftContactFilter, setDraftContactFilter] = useState('');
  const [draftDateFrom, setDraftDateFrom] = useState('');
  const [draftDateTo, setDraftDateTo] = useState('');
  const [draftSort, setDraftSort] = useState<'created_at' | 'updated_at'>('created_at');

  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draftDetail, setDraftDetail] = useState<MessageDetailResult | null>(null);
  const [draftDetailLoading, setDraftDetailLoading] = useState(false);

  const [detailSubject, setDetailSubject] = useState('');
  const [detailText, setDetailText] = useState('');

  const [sendChannel, setSendChannel] = useState<SendChannel>('email');
  const [markSentChannel, setMarkSentChannel] = useState<MarkSentChannel>('manual');
  const [markSentExternalId, setMarkSentExternalId] = useState('');
  const [markSentNotes, setMarkSentNotes] = useState('');

  const [generateContactId, setGenerateContactId] = useState('');
  const [generateTone, setGenerateTone] = useState<'default' | Tone>('default');
  const [generateLanguage, setGenerateLanguage] = useState('en');
  const [generateMaxWords, setGenerateMaxWords] = useState('100');

  const contactsById = useMemo(() => {
    return new Map(contacts.map((contact) => [contact.id, contact]));
  }, [contacts]);

  useEffect(() => {
    void loadContacts(true);
    void loadBirthdays();
    void loadDrafts(true);
  }, []);

  useEffect(() => {
    if (!generateContactId && contacts.length > 0) {
      setGenerateContactId(contacts[0].id);
    }
  }, [contacts, generateContactId]);

  useEffect(() => {
    if (!draftDetail) {
      setDetailSubject('');
      setDetailText('');
      return;
    }

    setDetailSubject(draftDetail.draft.subject);
    setDetailText(draftDetail.draft.text);
  }, [draftDetail]);

  async function loadContacts(reset: boolean) {
    if (!reset && !contactsNextCursor) {
      return;
    }

    setContactsLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(DEFAULT_LIMIT));

    const trimmedQuery = contactQuery.trim();
    if (trimmedQuery.length > 0) {
      params.set('q', trimmedQuery);
    }

    if (contactRelationshipFilter !== 'all') {
      params.set('relationship', contactRelationshipFilter);
    }

    if (hasBirthdayTodayFilter) {
      params.set('has_birthday_today', 'true');
    }

    if (!reset && contactsNextCursor) {
      params.set('cursor', contactsNextCursor);
    }

    const result = await apiRequest<PaginatedResult<Contact>>(`/api/manual/contacts?${params.toString()}`);
    setContactsLoading(false);

    if (!result.ok || !result.data) {
      setFeedback({ type: 'error', text: `Contacts load failed: ${result.errorMessage}` });
      return;
    }

    setContacts((prev) => (reset ? result.data!.items : [...prev, ...result.data!.items]));
    setContactsNextCursor(result.data.nextCursor);
  }

  async function loadBirthdays() {
    setBirthdaysLoading(true);
    const params = new URLSearchParams({ date: birthdaysDate });
    const result = await apiRequest<BirthdaysResult>(`/api/manual/birthdays/today?${params.toString()}`);
    setBirthdaysLoading(false);

    if (!result.ok || !result.data) {
      setFeedback({ type: 'error', text: `Birthdays load failed: ${result.errorMessage}` });
      return;
    }

    setTodayBirthdays(result.data.items);
  }

  async function loadDrafts(reset: boolean) {
    if (!reset && !draftsNextCursor) {
      return;
    }

    setDraftsLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(DEFAULT_LIMIT));
    params.set('sort', draftSort);

    if (draftStatusFilter !== 'all') {
      params.set('status', draftStatusFilter);
    }

    if (draftChannelFilter !== 'all') {
      params.set('channel', draftChannelFilter);
    }

    if (draftContactFilter.trim().length > 0) {
      params.set('contact_id', draftContactFilter.trim());
    }

    if (draftDateFrom.trim().length > 0) {
      params.set('date_from', draftDateFrom.trim());
    }

    if (draftDateTo.trim().length > 0) {
      params.set('date_to', draftDateTo.trim());
    }

    if (!reset && draftsNextCursor) {
      params.set('cursor', draftsNextCursor);
    }

    const result = await apiRequest<PaginatedResult<MessageDraft>>(`/api/manual/messages?${params.toString()}`);
    setDraftsLoading(false);

    if (!result.ok || !result.data) {
      setFeedback({ type: 'error', text: `Drafts load failed: ${result.errorMessage}` });
      return;
    }

    setDrafts((prev) => (reset ? result.data!.items : [...prev, ...result.data!.items]));
    setDraftsNextCursor(result.data.nextCursor);

    if (reset) {
      const firstDraftId = result.data.items[0]?.id || null;
      if (!firstDraftId) {
        setSelectedDraftId(null);
        setDraftDetail(null);
        return;
      }

      setSelectedDraftId(firstDraftId);
      void loadDraftDetail(firstDraftId);
    }
  }

  async function loadDraftDetail(messageId: string) {
    setDraftDetailLoading(true);
    const result = await apiRequest<MessageDetailResult>(`/api/manual/messages/${messageId}`);
    setDraftDetailLoading(false);

    if (!result.ok || !result.data) {
      setFeedback({ type: 'error', text: `Draft detail load failed: ${result.errorMessage}` });
      return;
    }

    setDraftDetail(result.data);
  }

  async function handleCreateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload: {
      name?: string;
      email?: string;
      birthdayDate: string;
      relationship: Relationship;
      tone: Tone;
      source: Source;
    } = {
      birthdayDate: createBirthdayDate,
      relationship: createRelationship,
      tone: createTone,
      source: createSource,
    };

    if (createName.trim().length > 0) {
      payload.name = createName.trim();
    }

    if (createEmail.trim().length > 0) {
      payload.email = createEmail.trim();
    }

    const result = await apiRequest<Contact>('/api/manual/contacts', {
      method: 'POST',
      body: payload,
    });

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Create contact failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: 'Contact created' });
    setCreateName('');
    setCreateEmail('');
    await loadContacts(true);
    await loadBirthdays();
  }

  function startEditContact(contact: Contact) {
    setEditingContactId(contact.id);
    setEditName(contact.name || '');
    setEditEmail(contact.email || '');
    setEditBirthdayDate(contact.birthdayDate);
    setEditRelationship(contact.relationship);
    setEditTone(contact.tone);
    setEditSource(contact.source);
  }

  async function handleUpdateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingContactId) {
      return;
    }

    const payload = {
      name: editName.trim().length > 0 ? editName.trim() : null,
      email: editEmail.trim().length > 0 ? editEmail.trim() : null,
      birthdayDate: editBirthdayDate,
      relationship: editRelationship,
      tone: editTone,
      source: editSource,
    };

    const result = await apiRequest<Contact>(`/api/manual/contacts/${editingContactId}`, {
      method: 'PATCH',
      body: payload,
    });

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Update contact failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: 'Contact updated' });
    setEditingContactId(null);
    await loadContacts(true);
    await loadBirthdays();
    await loadDrafts(true);
  }

  async function handleDeleteContact(contactId: string) {
    if (!window.confirm('Delete this contact and all its drafts/logs?')) {
      return;
    }

    const result = await apiRequest<null>(`/api/manual/contacts/${contactId}`, {
      method: 'DELETE',
    });

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Delete contact failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: 'Contact deleted' });
    await loadContacts(true);
    await loadBirthdays();
    await loadDrafts(true);
  }

  async function handleGenerateDraft(contactId: string) {
    const payload: {
      contactId: string;
      tone?: Tone;
      language?: string;
      maxWords?: number;
    } = {
      contactId,
    };

    if (generateTone !== 'default') {
      payload.tone = generateTone;
    }

    const language = generateLanguage.trim().toLowerCase();
    if (language.length > 0) {
      payload.language = language;
    }

    const maxWords = Number.parseInt(generateMaxWords, 10);
    if (Number.isFinite(maxWords) && maxWords > 0) {
      payload.maxWords = maxWords;
    }

    const result = await apiRequest<MessageDraft>('/api/manual/messages/generate', {
      method: 'POST',
      body: payload,
    });

    if (!result.ok || !result.data) {
      setFeedback({ type: 'error', text: `Generate draft failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: 'Draft generated' });
    await loadDrafts(true);
    setSelectedDraftId(result.data.id);
    await loadDraftDetail(result.data.id);
  }

  async function handleSaveDraftText() {
    if (!selectedDraftId) {
      return;
    }

    const result = await apiRequest<MessageDraft>(`/api/manual/messages/${selectedDraftId}`, {
      method: 'PATCH',
      body: {
        text: detailText,
      },
    });

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Save draft failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: 'Draft updated' });
    await loadDraftDetail(selectedDraftId);
    await loadDrafts(true);
  }

  async function handleApproveDraft() {
    if (!selectedDraftId) {
      return;
    }

    const result = await apiRequest<MessageDraft>(`/api/manual/messages/${selectedDraftId}/approve`, {
      method: 'PATCH',
      body: {
        subject: detailSubject,
        text: detailText,
      },
    });

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Approve draft failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: 'Draft approved' });
    await loadDraftDetail(selectedDraftId);
    await loadDrafts(true);
  }

  async function handleSendNow() {
    if (!selectedDraftId) {
      return;
    }

    const result = await apiRequest<{ draft: MessageDraft; idempotent: boolean }>(
      `/api/manual/messages/${selectedDraftId}/send-now`,
      {
        method: 'POST',
        headers: {
          'x-idempotency-key': createIdempotencyKey(),
        },
        body: {
          channel: sendChannel,
        },
      },
    );

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Send failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: result.data?.idempotent ? 'Already sent (idempotent)' : 'Sent' });
    await loadDraftDetail(selectedDraftId);
    await loadDrafts(true);
  }

  async function handleRetry() {
    if (!selectedDraftId) {
      return;
    }

    const result = await apiRequest<{ draft: MessageDraft; idempotent: boolean }>(
      `/api/manual/messages/${selectedDraftId}/retry`,
      {
        method: 'POST',
        headers: {
          'x-idempotency-key': createIdempotencyKey(),
        },
        body: {},
      },
    );

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Retry failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: result.data?.idempotent ? 'Retry idempotent hit' : 'Retry success' });
    await loadDraftDetail(selectedDraftId);
    await loadDrafts(true);
  }

  async function handleMarkSent() {
    if (!selectedDraftId) {
      return;
    }

    const result = await apiRequest<MessageDraft>(`/api/manual/messages/${selectedDraftId}/mark-sent`, {
      method: 'POST',
      body: {
        channel: markSentChannel,
        external_message_id: markSentExternalId.trim() || undefined,
        notes: markSentNotes.trim() || undefined,
      },
    });

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Mark sent failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: 'Marked as sent' });
    await loadDraftDetail(selectedDraftId);
    await loadDrafts(true);
  }

  async function handleDeleteDraft() {
    if (!selectedDraftId) {
      return;
    }

    if (!window.confirm('Delete selected draft?')) {
      return;
    }

    const result = await apiRequest<null>(`/api/manual/messages/${selectedDraftId}`, {
      method: 'DELETE',
    });

    if (!result.ok) {
      setFeedback({ type: 'error', text: `Delete draft failed: ${result.errorMessage}` });
      return;
    }

    setFeedback({ type: 'success', text: 'Draft deleted' });
    setSelectedDraftId(null);
    setDraftDetail(null);
    await loadDrafts(true);
  }

  const selectedDraft = draftDetail?.draft ?? null;
  const selectedLogs = draftDetail?.logs ?? [];

  return (
    <main className="manual-root">
      <header className="manual-header">
        <div>
          <p className="manual-kicker">Birthday Agent</p>
          <h1 className="manual-title">Manual Inbox</h1>
        </div>
        <Link className="manual-link" href="/">
          Open Studio
        </Link>
      </header>

      {feedback ? (
        <p className={`manual-feedback manual-feedback-${feedback.type}`}>{feedback.text}</p>
      ) : null}

      <div className="manual-grid">
        <section className="manual-card">
          <div className="manual-card-head">
            <h2>Contacts</h2>
            <button type="button" className="manual-btn" onClick={() => void loadContacts(true)}>
              Refresh
            </button>
          </div>

          <form
            className="manual-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void loadContacts(true);
            }}
          >
            <input
              className="manual-input"
              placeholder="Search name/email"
              value={contactQuery}
              onChange={(event) => setContactQuery(event.target.value)}
            />
            <select
              className="manual-select"
              value={contactRelationshipFilter}
              onChange={(event) =>
                setContactRelationshipFilter(event.target.value as 'all' | Relationship)
              }
            >
              <option value="all">Any relationship</option>
              {RELATIONSHIPS.map((value) => (
                <option key={value} value={value}>
                  {labelEnum(value)}
                </option>
              ))}
            </select>
            <label className="manual-checkbox">
              <input
                type="checkbox"
                checked={hasBirthdayTodayFilter}
                onChange={(event) => setHasBirthdayTodayFilter(event.target.checked)}
              />
              Birthday today
            </label>
            <button type="submit" className="manual-btn manual-btn-primary" disabled={contactsLoading}>
              Apply
            </button>
          </form>

          <div className="manual-list">
            {contacts.map((contact) => (
              <article className="manual-row" key={contact.id}>
                <div>
                  <p className="manual-row-title">{contact.name || 'Unnamed contact'}</p>
                  <p className="manual-row-meta">
                    {contact.email || 'no-email'} | {contact.birthdayDate} | {labelEnum(contact.relationship)} |{' '}
                    {labelEnum(contact.tone)}
                  </p>
                </div>
                <div className="manual-row-actions">
                  <button type="button" className="manual-btn" onClick={() => void handleGenerateDraft(contact.id)}>
                    Generate
                  </button>
                  <button type="button" className="manual-btn" onClick={() => startEditContact(contact)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="manual-btn manual-btn-danger"
                    onClick={() => void handleDeleteContact(contact.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>

          {contactsNextCursor ? (
            <button
              type="button"
              className="manual-btn"
              disabled={contactsLoading}
              onClick={() => void loadContacts(false)}
            >
              Load more
            </button>
          ) : null}

          <h3 className="manual-subtitle">Create Contact</h3>
          <form className="manual-stack-form" onSubmit={(event) => void handleCreateContact(event)}>
            <input
              className="manual-input"
              placeholder="Name (optional)"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
            <input
              className="manual-input"
              placeholder="Email (optional)"
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
            />
            <input
              className="manual-input"
              type="date"
              required
              value={createBirthdayDate}
              onChange={(event) => setCreateBirthdayDate(event.target.value)}
            />
            <select
              className="manual-select"
              value={createRelationship}
              onChange={(event) => setCreateRelationship(event.target.value as Relationship)}
            >
              {RELATIONSHIPS.map((value) => (
                <option key={value} value={value}>
                  {labelEnum(value)}
                </option>
              ))}
            </select>
            <select
              className="manual-select"
              value={createTone}
              onChange={(event) => setCreateTone(event.target.value as Tone)}
            >
              {TONES.map((value) => (
                <option key={value} value={value}>
                  {labelEnum(value)}
                </option>
              ))}
            </select>
            <select
              className="manual-select"
              value={createSource}
              onChange={(event) => setCreateSource(event.target.value as Source)}
            >
              {SOURCES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <button type="submit" className="manual-btn manual-btn-primary">
              Create
            </button>
          </form>

          {editingContactId ? (
            <>
              <h3 className="manual-subtitle">Edit Contact</h3>
              <form className="manual-stack-form" onSubmit={(event) => void handleUpdateContact(event)}>
                <input
                  className="manual-input"
                  placeholder="Name"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                />
                <input
                  className="manual-input"
                  placeholder="Email"
                  value={editEmail}
                  onChange={(event) => setEditEmail(event.target.value)}
                />
                <input
                  className="manual-input"
                  type="date"
                  required
                  value={editBirthdayDate}
                  onChange={(event) => setEditBirthdayDate(event.target.value)}
                />
                <select
                  className="manual-select"
                  value={editRelationship}
                  onChange={(event) => setEditRelationship(event.target.value as Relationship)}
                >
                  {RELATIONSHIPS.map((value) => (
                    <option key={value} value={value}>
                      {labelEnum(value)}
                    </option>
                  ))}
                </select>
                <select
                  className="manual-select"
                  value={editTone}
                  onChange={(event) => setEditTone(event.target.value as Tone)}
                >
                  {TONES.map((value) => (
                    <option key={value} value={value}>
                      {labelEnum(value)}
                    </option>
                  ))}
                </select>
                <select
                  className="manual-select"
                  value={editSource}
                  onChange={(event) => setEditSource(event.target.value as Source)}
                >
                  {SOURCES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <div className="manual-row-actions">
                  <button type="submit" className="manual-btn manual-btn-primary">
                    Save
                  </button>
                  <button
                    type="button"
                    className="manual-btn"
                    onClick={() => setEditingContactId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </>
          ) : null}
        </section>

        <section className="manual-card">
          <div className="manual-card-head">
            <h2>Today Birthdays</h2>
            <button type="button" className="manual-btn" onClick={() => void loadBirthdays()}>
              Refresh
            </button>
          </div>

          <div className="manual-inline-form">
            <input
              className="manual-input"
              type="date"
              value={birthdaysDate}
              onChange={(event) => setBirthdaysDate(event.target.value)}
            />
            <button
              type="button"
              className="manual-btn manual-btn-primary"
              disabled={birthdaysLoading}
              onClick={() => void loadBirthdays()}
            >
              Load
            </button>
          </div>

          <div className="manual-list">
            {todayBirthdays.length === 0 ? <p className="manual-empty">No birthdays for selected date</p> : null}
            {todayBirthdays.map((contact) => (
              <article className="manual-row" key={contact.id}>
                <div>
                  <p className="manual-row-title">{contact.name || 'Unnamed contact'}</p>
                  <p className="manual-row-meta">{contact.email || 'no-email'}</p>
                </div>
                <div className="manual-row-actions">
                  <button type="button" className="manual-btn" onClick={() => void handleGenerateDraft(contact.id)}>
                    Generate
                  </button>
                </div>
              </article>
            ))}
          </div>

          <h3 className="manual-subtitle">Generate Draft</h3>
          <form
            className="manual-stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (generateContactId) {
                void handleGenerateDraft(generateContactId);
              }
            }}
          >
            <select
              className="manual-select"
              value={generateContactId}
              onChange={(event) => setGenerateContactId(event.target.value)}
              required
            >
              <option value="">Select contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name || contact.email || contact.id}
                </option>
              ))}
            </select>
            <select
              className="manual-select"
              value={generateTone}
              onChange={(event) => setGenerateTone(event.target.value as 'default' | Tone)}
            >
              <option value="default">Tone: contact default</option>
              {TONES.map((value) => (
                <option key={value} value={value}>
                  Tone: {labelEnum(value)}
                </option>
              ))}
            </select>
            <input
              className="manual-input"
              placeholder="Language (default en)"
              value={generateLanguage}
              onChange={(event) => setGenerateLanguage(event.target.value)}
            />
            <input
              className="manual-input"
              type="number"
              min={1}
              max={1000}
              placeholder="Max words"
              value={generateMaxWords}
              onChange={(event) => setGenerateMaxWords(event.target.value)}
            />
            <button type="submit" className="manual-btn manual-btn-primary" disabled={!generateContactId}>
              Generate Draft
            </button>
          </form>
        </section>

        <section className="manual-card manual-card-wide">
          <div className="manual-card-head">
            <h2>Draft Inbox</h2>
            <button type="button" className="manual-btn" onClick={() => void loadDrafts(true)}>
              Refresh
            </button>
          </div>

          <form
            className="manual-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void loadDrafts(true);
            }}
          >
            <select
              className="manual-select"
              value={draftStatusFilter}
              onChange={(event) => setDraftStatusFilter(event.target.value as 'all' | DraftStatus)}
            >
              <option value="all">Any status</option>
              {DRAFT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {labelEnum(value)}
                </option>
              ))}
            </select>
            <select
              className="manual-select"
              value={draftChannelFilter}
              onChange={(event) => setDraftChannelFilter(event.target.value as 'all' | MarkSentChannel)}
            >
              <option value="all">Any channel</option>
              {MARK_SENT_CHANNELS.map((value) => (
                <option key={value} value={value}>
                  {labelEnum(value)}
                </option>
              ))}
            </select>
            <input
              className="manual-input"
              placeholder="contact_id"
              value={draftContactFilter}
              onChange={(event) => setDraftContactFilter(event.target.value)}
            />
            <input
              className="manual-input"
              type="date"
              value={draftDateFrom}
              onChange={(event) => setDraftDateFrom(event.target.value)}
            />
            <input
              className="manual-input"
              type="date"
              value={draftDateTo}
              onChange={(event) => setDraftDateTo(event.target.value)}
            />
            <select
              className="manual-select"
              value={draftSort}
              onChange={(event) => setDraftSort(event.target.value as 'created_at' | 'updated_at')}
            >
              <option value="created_at">Sort: created</option>
              <option value="updated_at">Sort: updated</option>
            </select>
            <button type="submit" className="manual-btn manual-btn-primary" disabled={draftsLoading}>
              Apply
            </button>
          </form>

          <div className="manual-drafts-layout">
            <div className="manual-list">
              {drafts.length === 0 ? <p className="manual-empty">No drafts</p> : null}
              {drafts.map((draft) => (
                <article
                  className={`manual-row ${selectedDraftId === draft.id ? 'manual-row-active' : ''}`}
                  key={draft.id}
                  onClick={() => {
                    setSelectedDraftId(draft.id);
                    void loadDraftDetail(draft.id);
                  }}
                >
                  <div>
                    <p className="manual-row-title">{draft.subject}</p>
                    <p className="manual-row-meta">
                      {labelEnum(draft.status)} | {draft.channel ? labelEnum(draft.channel) : 'N/A'} |{' '}
                      {formatDate(draft.createdAt)}
                    </p>
                    <p className="manual-row-meta">{contactsById.get(draft.contactId)?.name || draft.contactId}</p>
                  </div>
                </article>
              ))}

              {draftsNextCursor ? (
                <button
                  type="button"
                  className="manual-btn"
                  disabled={draftsLoading}
                  onClick={() => void loadDrafts(false)}
                >
                  Load more
                </button>
              ) : null}
            </div>

            <div className="manual-draft-detail">
              {draftDetailLoading ? <p className="manual-empty">Loading draft details...</p> : null}
              {!draftDetailLoading && !selectedDraft ? <p className="manual-empty">Select a draft</p> : null}

              {selectedDraft ? (
                <>
                  <p className="manual-row-meta">
                    Status: <strong>{labelEnum(selectedDraft.status)}</strong> | Channel:{' '}
                    <strong>{selectedDraft.channel ? labelEnum(selectedDraft.channel) : 'N/A'}</strong>
                  </p>
                  <input
                    className="manual-input"
                    value={detailSubject}
                    onChange={(event) => setDetailSubject(event.target.value)}
                    maxLength={120}
                  />
                  <textarea
                    className="manual-textarea"
                    value={detailText}
                    onChange={(event) => setDetailText(event.target.value)}
                    maxLength={1000}
                  />

                  <div className="manual-row-actions">
                    <button
                      type="button"
                      className="manual-btn"
                      onClick={() => void handleSaveDraftText()}
                      disabled={selectedDraft.status !== 'draft'}
                    >
                      Save Text
                    </button>
                    <button
                      type="button"
                      className="manual-btn manual-btn-primary"
                      onClick={() => void handleApproveDraft()}
                      disabled={selectedDraft.status !== 'draft'}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="manual-btn manual-btn-danger"
                      onClick={() => void handleDeleteDraft()}
                    >
                      Delete
                    </button>
                  </div>

                  <div className="manual-actions-block">
                    <h3 className="manual-subtitle">Send Now</h3>
                    <div className="manual-inline-form">
                      <select
                        className="manual-select"
                        value={sendChannel}
                        onChange={(event) => setSendChannel(event.target.value as SendChannel)}
                      >
                        {SEND_CHANNELS.map((channel) => (
                          <option key={channel} value={channel}>
                            {labelEnum(channel)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="manual-btn manual-btn-primary"
                        onClick={() => void handleSendNow()}
                        disabled={selectedDraft.status !== 'approved'}
                      >
                        Send Now
                      </button>
                    </div>
                    <p className="manual-hint">Requires approved status and x-idempotency-key.</p>
                  </div>

                  <div className="manual-actions-block">
                    <h3 className="manual-subtitle">Retry Failed</h3>
                    <button
                      type="button"
                      className="manual-btn"
                      onClick={() => void handleRetry()}
                      disabled={selectedDraft.status !== 'failed'}
                    >
                      Retry
                    </button>
                  </div>

                  <div className="manual-actions-block">
                    <h3 className="manual-subtitle">Mark Sent</h3>
                    <div className="manual-stack-form">
                      <select
                        className="manual-select"
                        value={markSentChannel}
                        onChange={(event) => setMarkSentChannel(event.target.value as MarkSentChannel)}
                      >
                        {MARK_SENT_CHANNELS.map((channel) => (
                          <option key={channel} value={channel}>
                            {labelEnum(channel)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="manual-input"
                        placeholder="External message id (optional)"
                        value={markSentExternalId}
                        onChange={(event) => setMarkSentExternalId(event.target.value)}
                      />
                      <input
                        className="manual-input"
                        placeholder="Notes (optional)"
                        value={markSentNotes}
                        onChange={(event) => setMarkSentNotes(event.target.value)}
                      />
                      <button
                        type="button"
                        className="manual-btn"
                        onClick={() => void handleMarkSent()}
                        disabled={selectedDraft.status !== 'approved'}
                      >
                        Mark Sent
                      </button>
                    </div>
                  </div>

                  <h3 className="manual-subtitle">Recent Logs</h3>
                  <div className="manual-list">
                    {selectedLogs.length === 0 ? <p className="manual-empty">No logs</p> : null}
                    {selectedLogs.map((log) => (
                      <article className="manual-row" key={log.id}>
                        <div>
                          <p className="manual-row-title">
                            {labelEnum(log.action)} ({labelEnum(log.status)})
                          </p>
                          <p className="manual-row-meta">
                            {formatDate(log.timestamp)} | channel: {log.channel ? labelEnum(log.channel) : 'N/A'}
                          </p>
                          {log.error ? <p className="manual-row-meta">error: {log.error}</p> : null}
                          {log.notes ? <p className="manual-row-meta">notes: {log.notes}</p> : null}
                          {log.externalMessageId ? (
                            <p className="manual-row-meta">external id: {log.externalMessageId}</p>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

async function apiRequest<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<ApiResult<T>> {
  const method = options?.method || 'GET';
  const hasBody = options?.body !== undefined;

  const response = await fetch(path, {
    method,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(options?.headers || {}),
    },
    body: hasBody ? JSON.stringify(options?.body) : undefined,
    cache: 'no-store',
  });

  const text = await response.text();
  const data = parseUnknown(text);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      errorMessage: extractErrorMessage(data, text, response.status),
    };
  }

  return {
    ok: true,
    status: response.status,
    data: (data as T) || null,
    errorMessage: null,
  };
}

function parseUnknown(text: string): unknown {
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractErrorMessage(payload: unknown, rawText: string, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const maybeMessage = (payload as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }

    if (Array.isArray(maybeMessage) && maybeMessage.length > 0) {
      return maybeMessage.map((item) => String(item)).join(', ');
    }

    const maybeError = (payload as { error?: unknown }).error;
    if (typeof maybeError === 'string' && maybeError.trim().length > 0) {
      return maybeError;
    }
  }

  if (rawText.trim().length > 0) {
    return rawText;
  }

  return `Request failed with status ${status}`;
}

function labelEnum(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `manual-${crypto.randomUUID()}`;
  }

  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
