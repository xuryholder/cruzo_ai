CREATE TYPE "GenerationStatus" AS ENUM ('queued', 'processing_image', 'completed', 'failed', 'canceled');
CREATE TYPE "CreditLedgerType" AS ENUM ('grant', 'debit', 'refund');

CREATE TABLE "sessions" (
  "id" UUID PRIMARY KEY,
  "fingerprint_hash" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "credits" (
  "session_id" UUID PRIMARY KEY REFERENCES "sessions"("id") ON DELETE CASCADE,
  "balance" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credits_balance_non_negative CHECK (balance >= 0)
);

CREATE TABLE "generations" (
  "id" TEXT PRIMARY KEY,
  "session_id" UUID NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  "prompt" TEXT NOT NULL,
  "style" TEXT NOT NULL,
  "aspect_ratio" TEXT NOT NULL,
  "status" "GenerationStatus" NOT NULL,
  "error_code" TEXT,
  "image_url" TEXT,
  "video_url" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX generations_session_id_idx ON "generations"("session_id");
CREATE INDEX generations_status_idx ON "generations"("status");

CREATE TABLE "credit_ledger" (
  "id" TEXT PRIMARY KEY,
  "session_id" UUID NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  "generation_id" TEXT REFERENCES "generations"("id") ON DELETE SET NULL,
  "type" "CreditLedgerType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX credit_ledger_session_id_idx ON "credit_ledger"("session_id");
CREATE INDEX credit_ledger_generation_id_idx ON "credit_ledger"("generation_id");

CREATE TABLE "user_preferences" (
  "session_id" UUID PRIMARY KEY REFERENCES "sessions"("id") ON DELETE CASCADE,
  "default_tone" TEXT,
  "default_style" TEXT
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generations_updated_at
BEFORE UPDATE ON "generations"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_credits_updated_at
BEFORE UPDATE ON "credits"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
