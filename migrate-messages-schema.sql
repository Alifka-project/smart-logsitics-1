-- Migration script to update Message schema for flexible communication
-- This allows admin-to-admin, admin-to-driver, and driver-to-admin messaging

BEGIN;

-- Step 1: Create a backup table
CREATE TABLE messages_backup AS SELECT * FROM messages;

-- Step 2: Add new columns
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_id UUID;

-- Step 3: Migrate data based on senderRole
-- If senderRole = 'admin', then admin_id is sender, driver_id is receiver  
UPDATE messages 
SET sender_id = admin_id, receiver_id = driver_id
WHERE sender_role = 'admin';

-- If senderRole = 'driver', then driver_id is sender, admin_id is receiver
UPDATE messages
SET sender_id = driver_id, receiver_id = admin_id  
WHERE sender_role = 'driver';

-- Step 4: Verify all data migrated (should be no NULL)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM messages WHERE sender_id IS NULL OR receiver_id IS NULL) THEN
    RAISE EXCEPTION 'Migration failed: Found NULL sender_id or receiver_id';
  END IF;
END $$;

-- Step 5: Drop old indexes
DROP INDEX IF EXISTS idx_messages_conversation;
DROP INDEX IF EXISTS idx_messages_driver;

-- Step 6: Add constraints to new columns
ALTER TABLE messages ALTER COLUMN sender_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN receiver_id SET NOT NULL;

-- Step 7: Drop old columns
ALTER TABLE messages DROP COLUMN IF EXISTS admin_id;
ALTER TABLE messages DROP COLUMN IF EXISTS driver_id;
ALTER TABLE messages DROP COLUMN IF EXISTS sender_role;

-- Step 8: Create new indexes
CREATE INDEX idx_messages_conversation ON messages (sender_id, receiver_id, created_at DESC);
CREATE INDEX idx_messages_receiver ON messages (receiver_id);

-- Step 9: Add foreign key constraints
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_admin_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_driver_id_fkey;

ALTER TABLE messages 
  ADD CONSTRAINT messages_sender_id_fkey 
  FOREIGN KEY (sender_id) REFERENCES drivers(id) ON DELETE CASCADE;

ALTER TABLE messages 
  ADD CONSTRAINT messages_receiver_id_fkey 
  FOREIGN KEY (receiver_id) REFERENCES drivers(id) ON DELETE CASCADE;

COMMIT;

-- Verification queries
SELECT 'Total messages:' as info, COUNT(*) as count FROM messages;
SELECT 'Messages backup:' as info, COUNT(*) as count FROM messages_backup;
SELECT 'Sample migrated messages:' as info;
SELECT id, sender_id, receiver_id, content, is_read, created_at FROM messages LIMIT 5;
