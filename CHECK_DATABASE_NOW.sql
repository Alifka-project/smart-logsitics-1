-- RUN THIS IN VERCEL POSTGRES QUERY EDITOR
-- This will show EXACTLY what your database has right now

-- Check Messages table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'messages' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check if table exists at all
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'messages'
) as messages_table_exists;

-- Count messages
SELECT COUNT(*) as total_messages FROM messages;
