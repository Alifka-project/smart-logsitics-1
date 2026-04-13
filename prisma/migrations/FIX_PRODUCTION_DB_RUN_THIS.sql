-- ============================================================
-- PRODUCTION DATABASE FIX — Run this in your Neon / Vercel
-- Postgres dashboard (SQL editor) BEFORE the next deploy.
--
-- All statements use IF NOT EXISTS / safe guards so it is
-- safe to run multiple times with no side effects.
-- ============================================================

-- ── 1. deliveries: PO Number ────────────────────────────────
ALTER TABLE "deliveries"
  ADD COLUMN IF NOT EXISTS "poNumber" VARCHAR(100);

CREATE INDEX IF NOT EXISTS "idx_delivery_po_number"
  ON "deliveries"("poNumber");

-- ── 2. deliveries: Delivery Number + Goods Movement Date ────
ALTER TABLE "deliveries"
  ADD COLUMN IF NOT EXISTS "delivery_number" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "goods_movement_date" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_delivery_number_key"
  ON "deliveries"("delivery_number");

CREATE INDEX IF NOT EXISTS "idx_delivery_delivery_number"
  ON "deliveries"("delivery_number");

CREATE INDEX IF NOT EXISTS "idx_delivery_gmd"
  ON "deliveries"("goods_movement_date");

-- ── 3. deliveries: Business Key (dedup) ─────────────────────
ALTER TABLE "deliveries"
  ADD COLUMN IF NOT EXISTS "business_key" VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_delivery_business_key"
  ON "deliveries"("business_key");

-- ── 4. deliveries: SMS Confirmation Token fields ─────────────
ALTER TABLE "deliveries"
  ADD COLUMN IF NOT EXISTS "confirmationToken"      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "confirmationStatus"     VARCHAR(50) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "customer_confirmed_at"  TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "available_delivery_dates" JSONB,
  ADD COLUMN IF NOT EXISTS "confirmed_delivery_date" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "token_expires_at"        TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_confirmationToken_key"
  ON "deliveries"("confirmationToken");

CREATE INDEX IF NOT EXISTS "idx_delivery_confirmation_token"
  ON "deliveries"("confirmationToken");

CREATE INDEX IF NOT EXISTS "idx_delivery_confirmation_status"
  ON "deliveries"("confirmationStatus");

-- ── 5. deliveries: SMS Sent At timestamp ────────────────────
ALTER TABLE "deliveries"
  ADD COLUMN IF NOT EXISTS "sms_sent_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_delivery_sms_sent_at"
  ON "deliveries"("sms_sent_at");

-- ── 6. deliveries: POD (Proof of Delivery) fields ───────────
ALTER TABLE "deliveries"
  ADD COLUMN IF NOT EXISTS "driver_signature"   TEXT,
  ADD COLUMN IF NOT EXISTS "customer_signature" TEXT,
  ADD COLUMN IF NOT EXISTS "photos"             JSONB,
  ADD COLUMN IF NOT EXISTS "condition_notes"    TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_notes"     TEXT,
  ADD COLUMN IF NOT EXISTS "delivered_by"       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "delivered_at"       TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "pod_completed_at"   TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_deliveries_pod_completed"
  ON "deliveries"("pod_completed_at");

CREATE INDEX IF NOT EXISTS "idx_deliveries_delivered_at"
  ON "deliveries"("delivered_at");

-- ── 7. sms_logs: drop old (wrong schema) and recreate ───────
-- The original migration created this table with camelCase column
-- names. Prisma expects snake_case. Drop and recreate correctly.
DROP TABLE IF EXISTS "sms_logs" CASCADE;

CREATE TABLE "sms_logs" (
  "id"                  BIGSERIAL     NOT NULL,
  "delivery_id"         UUID          NOT NULL
                          REFERENCES "deliveries"("id") ON DELETE CASCADE,
  "phone_number"        VARCHAR(32)   NOT NULL,
  "message_content"     TEXT          NOT NULL,
  "sms_provider"        VARCHAR(50)   NOT NULL,
  "external_message_id" VARCHAR(255),
  "status"              VARCHAR(32)   NOT NULL DEFAULT 'pending',
  "failure_reason"      TEXT,
  "sent_at"             TIMESTAMPTZ(6),
  "delivered_at"        TIMESTAMPTZ(6),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata"            JSONB,
  CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_sms_log_delivery" ON "sms_logs"("delivery_id");
CREATE INDEX "idx_sms_log_phone"    ON "sms_logs"("phone_number");
CREATE INDEX "idx_sms_log_status"   ON "sms_logs"("status");
CREATE INDEX "idx_sms_log_created"  ON "sms_logs"("created_at");

-- ── 8. sms_confirmations: drop old and recreate ─────────────
DROP TABLE IF EXISTS "sms_confirmations" CASCADE;

CREATE TABLE "sms_confirmations" (
  "id"             BIGSERIAL    NOT NULL,
  "delivery_id"    UUID         NOT NULL
                     REFERENCES "deliveries"("id") ON DELETE CASCADE,
  "phone"          VARCHAR(32),
  "provider"       VARCHAR(50),
  "message_id"     VARCHAR(128),
  "status"         VARCHAR(32),
  "attempts"       INTEGER      NOT NULL DEFAULT 0,
  "last_status_at" TIMESTAMPTZ(6),
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata"       JSONB,
  CONSTRAINT "sms_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_sms_conf_delivery" ON "sms_confirmations"("delivery_id");

-- ── 9. admin_notifications table ────────────────────────────
CREATE TABLE IF NOT EXISTS "admin_notifications" (
  "id"         BIGSERIAL    NOT NULL,
  "type"       VARCHAR(64)  NOT NULL,
  "title"      VARCHAR(255) NOT NULL,
  "message"    TEXT         NOT NULL,
  "payload"    JSONB,
  "is_read"    BOOLEAN      NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_admin_notif_unread"
  ON "admin_notifications"("is_read", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_admin_notif_created"
  ON "admin_notifications"("created_at" DESC);

-- ── Done ─────────────────────────────────────────────────────
-- After running this, redeploy to Vercel and test the PO upload.
