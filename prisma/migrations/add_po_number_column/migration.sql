-- Add poNumber column to Delivery table
-- IF NOT EXISTS guard makes this safe to re-run (e.g. after a failed migration is resolved).
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "poNumber" varchar(100);

-- Create index on poNumber for better query performance
CREATE INDEX IF NOT EXISTS "idx_delivery_po_number" ON "deliveries"("poNumber");
