-- Add delivery_number column (globally unique across all POs)
-- and goods_movement_date (dispatch signal from warehouse).
-- Safe to run on existing data; IF NOT EXISTS guards re-runs.

ALTER TABLE "deliveries"
  ADD COLUMN IF NOT EXISTS "delivery_number" varchar(100),
  ADD COLUMN IF NOT EXISTS "goods_movement_date" timestamptz;

-- Delivery number must be unique when non-null
CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_delivery_number_key"
  ON "deliveries"("delivery_number");

CREATE INDEX IF NOT EXISTS "idx_delivery_delivery_number"
  ON "deliveries"("delivery_number");

CREATE INDEX IF NOT EXISTS "idx_delivery_gmd"
  ON "deliveries"("goods_movement_date");

-- Backfill delivery_number from metadata for existing records that have it
UPDATE "deliveries"
SET "delivery_number" = UPPER(TRIM(metadata->>'originalDeliveryNumber'))
WHERE
  "delivery_number" IS NULL
  AND metadata->>'originalDeliveryNumber' IS NOT NULL
  AND TRIM(metadata->>'originalDeliveryNumber') != '';
