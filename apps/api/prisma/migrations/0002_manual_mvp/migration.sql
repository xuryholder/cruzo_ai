CREATE TYPE "ContactRelationship" AS ENUM (
  'family',
  'friend',
  'colleague',
  'client',
  'partner',
  'acquaintance',
  'other'
);

CREATE TYPE "ContactTone" AS ENUM (
  'formal',
  'semi_formal',
  'friendly',
  'warm',
  'playful',
  'neutral'
);

CREATE TYPE "ContactSource" AS ENUM (
  'manual_test',
  'manual',
  'google_contacts',
  'google_calendar',
  'gmail_parse',
  'linkedin_extension',
  'facebook_extension',
  'import_csv'
);

CREATE TYPE "MessageDraftStatus" AS ENUM (
  'draft',
  'approved',
  'sent',
  'failed'
);

CREATE TYPE "MessageChannel" AS ENUM (
  'email',
  'telegram',
  'whatsapp',
  'instagram',
  'facebook',
  'manual'
);

CREATE TYPE "MessageLogAction" AS ENUM (
  'generated',
  'edited',
  'approved',
  'send_requested',
  'send_attempt',
  'sent',
  'send_failed',
  'marked_sent',
  'deleted'
);

CREATE TYPE "MessageLogStatus" AS ENUM (
  'success',
  'failed'
);

CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "contacts" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT,
  "email" TEXT,
  "email_normalized" TEXT,
  "birthday_date" DATE NOT NULL,
  "relationship" "ContactRelationship" NOT NULL DEFAULT 'other',
  "tone" "ContactTone" NOT NULL DEFAULT 'neutral',
  "source" "ContactSource" NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX contacts_user_id_email_normalized_key
  ON "contacts"("user_id", "email_normalized");
CREATE INDEX contacts_user_id_created_at_idx ON "contacts"("user_id", "created_at");
CREATE INDEX contacts_user_id_updated_at_idx ON "contacts"("user_id", "updated_at");
CREATE INDEX contacts_user_id_birthday_date_idx ON "contacts"("user_id", "birthday_date");

CREATE TABLE "message_drafts" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "subject" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "status" "MessageDraftStatus" NOT NULL DEFAULT 'draft',
  "channel" "MessageChannel",
  "language" TEXT NOT NULL DEFAULT 'en',
  "tone" "ContactTone" NOT NULL DEFAULT 'neutral',
  "max_words" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_drafts_subject_len_check CHECK (char_length(subject) <= 120),
  CONSTRAINT message_drafts_text_len_check CHECK (char_length(text) <= 1000),
  CONSTRAINT message_drafts_max_words_positive_check CHECK (max_words > 0)
);

CREATE INDEX message_drafts_user_id_status_created_at_idx
  ON "message_drafts"("user_id", "status", "created_at");
CREATE INDEX message_drafts_user_id_created_at_idx
  ON "message_drafts"("user_id", "created_at");
CREATE INDEX message_drafts_user_id_updated_at_idx
  ON "message_drafts"("user_id", "updated_at");
CREATE INDEX message_drafts_contact_id_idx
  ON "message_drafts"("contact_id");

CREATE TABLE "message_logs" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "draft_id" TEXT REFERENCES "message_drafts"("id") ON DELETE SET NULL,
  "action" "MessageLogAction" NOT NULL,
  "status" "MessageLogStatus" NOT NULL,
  "channel" "MessageChannel",
  "external_message_id" TEXT,
  "error" TEXT,
  "notes" TEXT,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX message_logs_user_id_timestamp_idx
  ON "message_logs"("user_id", "timestamp");
CREATE INDEX message_logs_draft_id_timestamp_idx
  ON "message_logs"("draft_id", "timestamp");
CREATE INDEX message_logs_contact_id_timestamp_idx
  ON "message_logs"("contact_id", "timestamp");

CREATE TABLE "manual_idempotency_keys" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "idempotency_key" TEXT NOT NULL,
  "draft_id" TEXT NOT NULL REFERENCES "message_drafts"("id") ON DELETE CASCADE,
  "channel" "MessageChannel" NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manual_idempotency_keys_user_id_key_unique UNIQUE ("user_id", "idempotency_key")
);

CREATE INDEX manual_idempotency_keys_draft_id_idx
  ON "manual_idempotency_keys"("draft_id");

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON "users"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_contacts_updated_at
BEFORE UPDATE ON "contacts"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_message_drafts_updated_at
BEFORE UPDATE ON "message_drafts"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
