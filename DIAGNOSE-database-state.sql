-- DATABASE DIAGNOSTIC SCRIPT
-- Run this to check the current state of the messages table

-- Check if messages table exists
SELECT 
  'Messages table exists:' as check,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'messages'
  ) THEN 'YES' ELSE 'NO' END as result;

-- Check if backup table exists
SELECT 
  'Backup table exists:' as check,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'messages_backup'
  ) THEN 'YES' ELSE 'NO' END as result;

-- Check current columns in messages table
SELECT 
  'Current columns in messages:' as info;
SELECT 
  column_name, 
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'messages' 
ORDER BY ordinal_position;

-- Check for NULL values in key columns
SELECT 
  'Messages with NULL sender_id:' as check,
  COUNT(*) as count 
FROM messages 
WHERE sender_id IS NULL;

SELECT 
  'Messages with NULL receiver_id:' as check,
  COUNT(*) as count 
FROM messages 
WHERE receiver_id IS NULL;

SELECT 
  'Messages with NULL admin_id (old schema):' as check,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'admin_id'
  ) THEN (SELECT COUNT(*) FROM messages WHERE admin_id IS NULL)
  ELSE null 
  END as count;

-- Check foreign key constraints
SELECT 
  'Foreign key constraints:' as info;
SELECT 
  tc.constraint_name, 
  tc.table_name, 
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'messages';

-- Check indexes
SELECT 
  'Indexes on messages table:' as info;
SELECT 
  indexname,
  indexdef
FROM pg_indexes 
WHERE tablename = 'messages';

-- Count total messages
SELECT 
  'Total message count:' as info,
  COUNT(*) as count 
FROM messages;

-- Sample messages
SELECT 
  'Sample messages (first 3):' as info;
SELECT * FROM messages LIMIT 3;

-- Check if schema matches old or new structure
SELECT 
  'Schema detected:' as detection_result,
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'sender_id')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'receiver_id')
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'admin_id')
    THEN 'NEW SCHEMA (sender_id/receiver_id)'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'admin_id')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'driver_id')
    THEN 'OLD SCHEMA (admin_id/driver_id)'
    ELSE 'MIXED/BROKEN SCHEMA - MIGRATION INCOMPLETE'
  END as schema_type;
