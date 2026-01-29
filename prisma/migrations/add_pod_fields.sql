-- AlterTable: Add POD fields to deliveries table
-- This migration adds dedicated columns for Proof of Delivery data

ALTER TABLE "deliveries" 
ADD COLUMN IF NOT EXISTS "driver_signature" TEXT,
ADD COLUMN IF NOT EXISTS "customer_signature" TEXT,
ADD COLUMN IF NOT EXISTS "photos" JSONB,
ADD COLUMN IF NOT EXISTS "condition_notes" TEXT,
ADD COLUMN IF NOT EXISTS "delivery_notes" TEXT,
ADD COLUMN IF NOT EXISTS "delivered_by" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "pod_completed_at" TIMESTAMPTZ(6);

-- Create index on POD completion for faster queries
CREATE INDEX IF NOT EXISTS "idx_deliveries_pod_completed" ON "deliveries"("pod_completed_at");

-- Create index on delivered_at for reporting
CREATE INDEX IF NOT EXISTS "idx_deliveries_delivered_at" ON "deliveries"("delivered_at");

-- Add comment to explain the columns
COMMENT ON COLUMN "deliveries"."driver_signature" IS 'Base64 encoded driver signature image';
COMMENT ON COLUMN "deliveries"."customer_signature" IS 'Base64 encoded customer signature image';
COMMENT ON COLUMN "deliveries"."photos" IS 'JSON array of base64 encoded photos showing delivery condition';
COMMENT ON COLUMN "deliveries"."condition_notes" IS 'Notes about the condition of goods at delivery';
COMMENT ON COLUMN "deliveries"."delivery_notes" IS 'Additional notes about the delivery';
COMMENT ON COLUMN "deliveries"."delivered_by" IS 'Username or ID of person who completed the delivery';
COMMENT ON COLUMN "deliveries"."delivered_at" IS 'Timestamp when delivery was completed';
COMMENT ON COLUMN "deliveries"."pod_completed_at" IS 'Timestamp when POD (signatures/photos) was completed';
