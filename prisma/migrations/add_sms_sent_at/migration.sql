-- Add sms_sent_at column to deliveries table.
-- Tracks when the confirmation SMS/WhatsApp was last sent to the customer.
-- Used by the admin portal to distinguish:
--   'sms_sent'    — SMS sent, awaiting customer response (< 24 h)
--   'unconfirmed' — SMS sent > 24 h ago with no customer confirmation
-- Safe to re-run: IF NOT EXISTS guard prevents duplicate column errors.

ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "sms_sent_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_delivery_sms_sent_at" ON "deliveries"("sms_sent_at");
