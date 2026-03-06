-- Add business_key column used for delivery de-duplication.
-- This is safe to run on existing databases; IF NOT EXISTS guards
-- against environments where the column or index was already created.

ALTER TABLE "deliveries"
ADD COLUMN IF NOT EXISTS "business_key" varchar(255);

-- Match Prisma's @unique semantics on Delivery.businessKey
CREATE UNIQUE INDEX IF NOT EXISTS "idx_delivery_business_key"
ON "deliveries"("business_key");

