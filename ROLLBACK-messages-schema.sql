-- EMERGENCY ROLLBACK SCRIPT
-- Run this to restore the old message schema if migration failed

BEGIN;

-- Step 1: Check if backup exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages_backup') THEN
    RAISE EXCEPTION 'Backup table messages_backup not found! Cannot rollback safely.';
  END IF;
END $$;

-- Step 2: Drop foreign key constraints from messages if they exist
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_receiver_id_fkey;

-- Step 3: Drop new indexes
DROP INDEX IF EXISTS idx_messages_conversation;
DROP INDEX IF EXISTS idx_messages_receiver;

-- Step 4: Restore old table structure
DROP TABLE IF EXISTS messages;

-- Step 5: Rename backup to messages
ALTER TABLE messages_backup RENAME TO messages;

-- Step 6: Recreate old indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation 
  ON messages (admin_id, driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_driver 
  ON messages (driver_id);

-- Step 7: Recreate old foreign keys (if they existed)
ALTER TABLE messages 
  ADD CONSTRAINT messages_admin_id_fkey 
  FOREIGN KEY (admin_id) REFERENCES drivers(id) ON DELETE CASCADE;

ALTER TABLE messages 
  ADD CONSTRAINT messages_driver_id_fkey 
  FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;

COMMIT;

-- Verification
SELECT 'Rollback complete!' as status;
SELECT 'Old schema restored:' as info;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'messages' 
ORDER BY column_name;

SELECT 'Message count:' as info, COUNT(*) as count FROM messages;
SELECT 'Sample messages:' as info;
SELECT id, admin_id, driver_id, sender_role, content FROM messages LIMIT 5;
