-- Add poNumber column to Delivery table
ALTER TABLE "deliveries" ADD COLUMN "poNumber" varchar(100);

-- Create index on poNumber for better query performance
CREATE INDEX "idx_delivery_po_number" ON "deliveries"("poNumber");
