-- Script to update or create users with new roles
-- New roles: delivery_team, sales_ops, manager
-- All roles can chat with admins, admins can chat with everyone

BEGIN;

-- 1. Update an existing user's role
-- Example: Change user to delivery_team role
-- UPDATE accounts SET role = 'delivery_team' WHERE driver_id = 'YOUR_USER_ID';

-- 2. Create new users with specific roles

-- Example: Create Delivery Team Member
/*
-- Step 1: Create driver record
INSERT INTO drivers (id, username, email, full_name, active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'delivery_team_1',
  'delivery@company.com',
  'John Delivery',
  true,
  NOW(),
  NOW()
)
RETURNING id;

-- Step 2: Create account with delivery_team role (use the ID from above)
INSERT INTO accounts (id, driver_id, password_hash, role, created_at)
VALUES (
  gen_random_uuid(),
  'YOUR_DRIVER_ID_FROM_ABOVE',
  -- Password hash for 'password123' (use bcrypt to generate in production)
  '$2a$10$YourHashedPasswordHere',
  'delivery_team',
  NOW()
);
*/

-- Example: Create Sales Ops Member
/*
INSERT INTO drivers (id, username, email, full_name, active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'sales_ops_1',
  'sales@company.com',
  'Jane Sales',
  true,
  NOW(),
  NOW()
)
RETURNING id;

INSERT INTO accounts (id, driver_id, password_hash, role, created_at)
VALUES (
  gen_random_uuid(),
  'YOUR_DRIVER_ID_FROM_ABOVE',
  '$2a$10$YourHashedPasswordHere',
  'sales_ops',
  NOW()
);
*/

-- Example: Create Manager
/*
INSERT INTO drivers (id, username, email, full_name, active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'manager_1',
  'manager@company.com',
  'Mike Manager',
  true,
  NOW(),
  NOW()
)
RETURNING id;

INSERT INTO accounts (id, driver_id, password_hash, role, created_at)
VALUES (
  gen_random_uuid(),
  'YOUR_DRIVER_ID_FROM_ABOVE',
  '$2a$10$YourHashedPasswordHere',
  'manager',
  NOW()
);
*/

-- 3. View all users and their roles
SELECT 
  d.id,
  d.username,
  d.full_name,
  d.email,
  a.role,
  d.active,
  d.created_at
FROM drivers d
LEFT JOIN accounts a ON a.driver_id = d.id
ORDER BY a.role, d.full_name;

-- 4. Count users by role
SELECT 
  a.role,
  COUNT(*) as user_count
FROM accounts a
GROUP BY a.role
ORDER BY user_count DESC;

COMMIT;

-- Role Descriptions:
-- admin: Can chat with everyone (including other admins), full system access
-- driver: Can only chat with admins, manage deliveries
-- delivery_team: Can only chat with admins, focused on delivery operations
-- sales_ops: Can only chat with admins, focused on sales operations
-- manager: Can only chat with admins, supervisory access

-- Messaging Permissions:
-- ✓ Admin → Anyone (including other admins)
-- ✓ Driver → Admins only
-- ✓ Delivery Team → Admins only
-- ✓ Sales Ops → Admins only
-- ✓ Manager → Admins only
