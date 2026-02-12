# Message System Migration Guide

## Overview
This migration upgrades the message system to support flexible communication:
- **Drivers** can only chat with admins
- **Admins** can chat with anyone (other admins, drivers, any account)

## Changes Made

### 1. Database Schema
- Renamed `admin_id` → `sender_id`
- Renamed `driver_id` → `receiver_id`
- Removed `sender_role` column (no longer needed)
- Both sender and receiver can be any user in the system

### 2. API Endpoints
**New Unified Endpoints:**
- `GET /api/messages/conversations/:userId` - Get conversation with any user
- `GET /api/messages/unread` - Get unread count by sender
- `POST /api/messages/send` - Send message to any user (with role validation)
- `GET /api/messages/contacts` - Get list of users you can chat with
- `GET /api/messages/notifications/count` - Get total unread count
- `DELETE /api/messages/conversation/:userId` - Delete conversation
- `POST /api/messages/:messageId/read` - Mark message as read

**Deprecated Endpoints (removed):**
- `/api/admin/messages/*` (replaced with unified `/api/messages/*`)
- `/api/driver/messages/*` (replaced with unified `/api/messages/*`)

### 3. Permission Rules
- **Driver** → Can only send to admins
- **Admin** → Can send to anyone
- Enforced in API layer via `canSendMessage()` function

## Migration Steps

### Step 1: Backup Database (IMPORTANT!)
```bash
# Backup your database first!
pg_dump -h your_host -U your_user -d your_database > backup_before_migration.sql
```

### Step 2: Run Migration Script
```bash
# Connect to your database and run:
psql -h your_host -U your_user -d your_database -f migrate-messages-schema.sql
```

The script will:
1. Create backup table
2. Add new columns
3. Migrate existing data (preserves all messages)
4. Update indexes
5. Add foreign key constraints
6. Verify data integrity

### Step 3: Generate Prisma Client
```bash
npx prisma generate
```

### Step 4: Restart Application
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Step 5: Verify
1. Test admin-to-admin messaging
2. Test admin-to-driver messaging
3. Test driver-to-admin messaging
4. Verify driver cannot send to other drivers

## Verification Queries

```sql
-- Check migration success
SELECT COUNT(*) as total_messages FROM messages;
SELECT COUNT(*) as backup_messages FROM messages_backup;

-- Should match!

-- Verify no NULL values
SELECT COUNT(*) FROM messages WHERE sender_id IS NULL OR receiver_id IS NULL;
-- Should return 0

-- Sample messages
SELECT 
  id,
  sender_id,
  receiver_id,
  content,
  is_read,
  created_at
FROM messages
ORDER BY created_at DESC
LIMIT 10;
```

## Rollback (if needed)

If something goes wrong:

```sql
BEGIN;

-- Restore from backup
DROP TABLE messages;
ALTER TABLE messages_backup RENAME TO messages;

-- Recreate indexes
CREATE INDEX idx_messages_conversation ON messages (admin_id, driver_id, created_at DESC);
CREATE INDEX idx_messages_driver ON messages (driver_id);
CREATE INDEX idx_messages_created ON messages (created_at);

COMMIT;
```

Then revert code changes:
```bash
git checkout HEAD~1
npm install
npx prisma generate
```

## Testing Checklist

- [ ] Admin can send message to another admin
- [ ] Admin can send message to driver
- [ ] Driver can send message to admin
- [ ] Driver CANNOT send message to another driver (403 error)
- [ ] Notifications work correctly
- [ ] Unread counts are accurate
- [ ] Old messages are preserved
- [ ] Message history displays correctly

## Support

If you encounter issues:
1. Check the backup table: `SELECT * FROM messages_backup;`
2. Review migration logs
3. Verify Prisma schema matches database schema
4. Check API logs for errors
