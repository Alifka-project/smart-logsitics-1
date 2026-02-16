-- Add a test delivery to your database so SMS works immediately
-- Run this in your database to fix the 404 error

-- First, check if delivery-1 exists
SELECT id, customer, phone, status FROM deliveries WHERE id = 'delivery-1';

-- If not found, insert a test delivery with your phone number
INSERT INTO deliveries (
  id,
  customer,
  phone,
  address,
  status,
  items,
  lat,
  lng,
  "poNumber",
  metadata,
  created_at,
  updated_at
) VALUES (
  'delivery-1',
  'Alifka Test',
  '+971588712409',
  'Al zarooni Building Block B Dubai marina, DUBAI, 00000',
  'pending',
  '[{"name":"Test Item","quantity":1}]',
  25.0753,
  55.1408,
  'TEST-001',
  '{"originalRow":{"Customer":"Alifka Test","Phone":"+971588712409","Material":"TEST-MAT","Description":"Test Product"}}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  customer = EXCLUDED.customer,
  phone = EXCLUDED.phone,
  address = EXCLUDED.address,
  updated_at = NOW();

-- Verify it was created
SELECT id, customer, phone, status, created_at FROM deliveries WHERE id = 'delivery-1';

-- You should see:
-- id: delivery-1
-- customer: Alifka Test
-- phone: +971588712409
-- status: pending
