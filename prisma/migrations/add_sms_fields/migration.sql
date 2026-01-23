-- Add SMS confirmation fields to deliveries table
ALTER TABLE "deliveries" ADD COLUMN "confirmationToken" VARCHAR(255);
ALTER TABLE "deliveries" ADD COLUMN "confirmationStatus" VARCHAR(50) DEFAULT 'pending';
ALTER TABLE "deliveries" ADD COLUMN "customer_confirmed_at" TIMESTAMPTZ(6);
ALTER TABLE "deliveries" ADD COLUMN "available_delivery_dates" JSONB;
ALTER TABLE "deliveries" ADD COLUMN "confirmed_delivery_date" TIMESTAMPTZ(6);
ALTER TABLE "deliveries" ADD COLUMN "token_expires_at" TIMESTAMPTZ(6);

-- Create unique index on confirmationToken
CREATE UNIQUE INDEX "deliveries_confirmationToken_key" ON "deliveries"("confirmationToken");

-- Create indexes for SMS fields
CREATE INDEX "idx_delivery_confirmation_token" ON "deliveries"("confirmationToken");
CREATE INDEX "idx_delivery_confirmation_status" ON "deliveries"("confirmationStatus");

-- Create SmsConfirmation table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS "sms_confirmations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deliveryId" UUID REFERENCES "deliveries"("id") ON DELETE CASCADE,
  "phoneNumber" VARCHAR(32),
  "messageContent" TEXT,
  "smsProvider" VARCHAR(50),
  "externalMessageId" VARCHAR(255),
  "status" VARCHAR(50) DEFAULT 'pending',
  "sentAt" TIMESTAMPTZ(6),
  "deliveredAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB
);

-- Create indexes for SmsConfirmation
CREATE INDEX "idx_sms_confirmation_deliveryId" ON "sms_confirmations"("deliveryId");
CREATE INDEX "idx_sms_confirmation_status" ON "sms_confirmations"("status");

-- Create SmsLog table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS "sms_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deliveryId" UUID REFERENCES "deliveries"("id") ON DELETE CASCADE,
  "phoneNumber" VARCHAR(32),
  "messageContent" TEXT,
  "smsProvider" VARCHAR(50),
  "externalMessageId" VARCHAR(255),
  "status" VARCHAR(50) DEFAULT 'pending',
  "sentAt" TIMESTAMPTZ(6),
  "deliveredAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB
);

-- Create indexes for SmsLog
CREATE INDEX "idx_sms_log_deliveryId" ON "sms_logs"("deliveryId");
CREATE INDEX "idx_sms_log_status" ON "sms_logs"("status");
