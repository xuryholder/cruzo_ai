'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  RELATIONSHIPS,
  SOURCES,
  TONES,
  type ContactItem,
  type ContactRelationship,
  type ContactSource,
  type ContactTone,
  type ListResult,
  apiRequest,
  labelEnum,
  todayIsoDate,
} from '../_lib/manual-client';

type UiMessage = {
  type: 'success' | 'error';
  text: string;
};

const PAGE_LIMIT = 20;

export default function ContactsPage() {
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [q, setQ] = useState('');
  const [relationshipFilter, setRelationshipFilter] = useState<'all' | ContactRelationship>('all');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [birthdayDate, setBirthdayDate] = useState(todayIsoDate());
  const [relationship, setRelationship] = useState<ContactRelationship>('other');
  const [tone, setTone] = useState<ContactTone>('neutral');
  const [source, setSource] = useState<ContactSource>('manual_test');

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editBirthdayDate, setEditBirthdayDate] = useState(todayIsoDate());
  const [editRelationship, setEditRelationship] = useState<ContactRelationship>('other');
  const [editTone, setEditTone] = useState<ContactTone>('neutral');
  const [editSource, setEditSource] = useState<ContactSource>('manual_test');

  useEffect(() => {
    void loadContacts(true);
  }, []);

  async function loadContacts(reset: boolean) {
    if (!reset && !nextCursor) {
      return;
    }

    setLoading(true);

    const params = new URLSearchParams();
    params.set('limit', String(PAGE_LIMIT));

    if (q.trim().length > 0) {
      params.set('q', q.trim());
    }

    if (relationshipFilter !== 'all') {
      params.set('relationship', relationshipFilter);
    }

    if (!reset && nextCursor) {
      params.set('cursor', nextCursor);
    }

    const result = await apiRequest<ListResult<ContactItem>>(`/api/manual/contacts?${params.toString()}`);
    setLoading(false);

    if (!result.ok || !result.data) {
      setMessage({ type: 'error', text: `Failed to load contacts: ${result.errorMessage}` });
      return;
    }

    setContacts((prev) => (reset ? result.data!.items : [...prev, ...result.data!.items]));
    setNextCursor(result.data.nextCursor);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload: {
      name?: string;
      email?: string;
      birthdayDate: string;
      relationship: ContactRelationship;
      tone: ContactTone;
      source: ContactSource;
    } = {
      birthdayDate,
      relationship,
      tone,
      source,
    };

    if (name.trim().length > 0) {
      payload.name = name.trim();
    }

    if (email.trim().length > 0) {
      payload.email = email.trim();
    }

    const result = await apiRequest<ContactItem>('/api/manual/contacts', {
      method: 'POST',
      body: payload,
    });

    if (!result.ok) {
      setMessage({ type: 'error', text: `Contact creation error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Contact created' });
    setName('');
    setEmail('');
    await loadContacts(true);
  }

  function startEdit(contact: ContactItem) {
    setEditId(contact.id);
    setEditName(contact.name || '');
    setEditEmail(contact.email || '');
    setEditBirthdayDate(contact.birthdayDate);
    setEditRelationship(contact.relationship);
    setEditTone(contact.tone);
    setEditSource(contact.source);
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editId) {
      return;
    }

    const result = await apiRequest<ContactItem>(`/api/manual/contacts/${editId}`, {
      method: 'PATCH',
      body: {
        name: editName.trim().length > 0 ? editName.trim() : null,
        email: editEmail.trim().length > 0 ? editEmail.trim() : null,
        birthdayDate: editBirthdayDate,
        relationship: editRelationship,
        tone: editTone,
        source: editSource,
      },
    });

    if (!result.ok) {
      setMessage({ type: 'error', text: `Update error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Contact updated' });
    setEditId(null);
    await loadContacts(true);
  }

  async function handleDelete(contactId: string) {
    if (!window.confirm('Delete contact and all related history?')) {
      return;
    }

    const result = await apiRequest<null>(`/api/manual/contacts/${contactId}`, {
      method: 'DELETE',
    });

    if (!result.ok) {
      setMessage({ type: 'error', text: `Delete error: ${result.errorMessage}` });
      return;
    }

    setMessage({ type: 'success', text: 'Contact deleted' });
    await loadContacts(true);
  }

  return (
    <div className="crz-page">
      <div className="crz-page-head">
        <div>
          <h1 className="crz-page-title">Contacts</h1>
          <p className="crz-page-subtitle">Manage people and contact data quality</p>
        </div>

        <button className="crz-btn" type="button" onClick={() => void loadContacts(true)} disabled={loading}>
          Refresh
        </button>
      </div>

      {message ? <p className={`crz-alert crz-alert-${message.type}`}>{message.text}</p> : null}

      <section className="crz-section">
        <h2 className="crz-section-title">Search</h2>
        <form
          className="crz-inline-row"
          onSubmit={(event) => {
            event.preventDefault();
            void loadContacts(true);
          }}
        >
          <input
            className="crz-input"
            placeholder="Name or email"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          <select
            className="crz-select"
            value={relationshipFilter}
            onChange={(event) => setRelationshipFilter(event.target.value as 'all' | ContactRelationship)}
          >
            <option value="all">Any relationship</option>
            {RELATIONSHIPS.map((item) => (
              <option key={item} value={item}>
                {labelEnum(item)}
              </option>
            ))}
          </select>
          <button className="crz-btn crz-btn-primary" type="submit" disabled={loading}>
            Apply
          </button>
        </form>
      </section>

      <section className="crz-section">
        <h2 className="crz-section-title">Contact list</h2>
        <div className="crz-list">
          {contacts.length === 0 ? <p className="crz-empty">No contacts yet</p> : null}
          {contacts.map((contact) => (
            <article className="crz-row" key={contact.id}>
              <div>
                <p className="crz-row-title">{contact.name || 'Unnamed'}</p>
                <p className="crz-row-meta">
                  {contact.email || 'no-email'} | {contact.birthdayDate} | {labelEnum(contact.relationship)} |{' '}
                  {labelEnum(contact.tone)}
                </p>
              </div>

              <div className="crz-row-actions">
                <button className="crz-btn" type="button" onClick={() => startEdit(contact)}>
                  Edit
                </button>
                <button className="crz-btn crz-btn-danger" type="button" onClick={() => void handleDelete(contact.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>

        {nextCursor ? (
          <button className="crz-btn" type="button" onClick={() => void loadContacts(false)} disabled={loading}>
            Load more
          </button>
        ) : null}
      </section>

      <section className="crz-form-grid">
        <article className="crz-section">
          <h2 className="crz-section-title">Create Contact</h2>
          <form className="crz-stack" onSubmit={(event) => void handleCreate(event)}>
            <input
              className="crz-input"
              placeholder="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className="crz-input"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              className="crz-input"
              type="date"
              required
              value={birthdayDate}
              onChange={(event) => setBirthdayDate(event.target.value)}
            />
            <select
              className="crz-select"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value as ContactRelationship)}
            >
              {RELATIONSHIPS.map((item) => (
                <option key={item} value={item}>
                  {labelEnum(item)}
                </option>
              ))}
            </select>
            <select className="crz-select" value={tone} onChange={(event) => setTone(event.target.value as ContactTone)}>
              {TONES.map((item) => (
                <option key={item} value={item}>
                  {labelEnum(item)}
                </option>
              ))}
            </select>
            <select
              className="crz-select"
              value={source}
              onChange={(event) => setSource(event.target.value as ContactSource)}
            >
              {SOURCES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button className="crz-btn crz-btn-primary" type="submit">
              Create
            </button>
          </form>
        </article>

        <article className="crz-section">
          <h2 className="crz-section-title">Edit Contact</h2>
          {!editId ? <p className="crz-empty">Select a contact to edit</p> : null}
          {editId ? (
            <form className="crz-stack" onSubmit={(event) => void handleUpdate(event)}>
              <input
                className="crz-input"
                placeholder="Name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
              <input
                className="crz-input"
                placeholder="Email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
              />
              <input
                className="crz-input"
                type="date"
                required
                value={editBirthdayDate}
                onChange={(event) => setEditBirthdayDate(event.target.value)}
              />
              <select
                className="crz-select"
                value={editRelationship}
                onChange={(event) => setEditRelationship(event.target.value as ContactRelationship)}
              >
                {RELATIONSHIPS.map((item) => (
                  <option key={item} value={item}>
                    {labelEnum(item)}
                  </option>
                ))}
              </select>
              <select
                className="crz-select"
                value={editTone}
                onChange={(event) => setEditTone(event.target.value as ContactTone)}
              >
                {TONES.map((item) => (
                  <option key={item} value={item}>
                    {labelEnum(item)}
                  </option>
                ))}
              </select>
              <select
                className="crz-select"
                value={editSource}
                onChange={(event) => setEditSource(event.target.value as ContactSource)}
              >
                {SOURCES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <div className="crz-inline-row">
                <button className="crz-btn crz-btn-primary" type="submit">
                  Save
                </button>
                <button className="crz-btn" type="button" onClick={() => setEditId(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </article>
      </section>
    </div>
  );
}
