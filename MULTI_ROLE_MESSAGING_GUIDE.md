# Multi-Role Messaging System Guide

## Overview
The messaging system now supports **5 different user roles** with flexible admin-to-admin communication and a complete permission system.

---

## 📋 Available Roles

### 1. **Admin** (Purple Badge 🟣)
- **Full access** to message anyone including other admins
- Can view all users in contact list
- Manages deliveries, users, and system operations
- Appears in admin accounts tab

### 2. **Driver** (Blue Badge 🔵)
- Can **only message admins**
- Receives deliveries and location tracking
- Appears in drivers/users tab

### 3. **Delivery Team** (Green Badge 🟢)
- Can **only message admins**
- Focused on delivery operations
- Appears in drivers/users tab

### 4. **Sales Ops** (Orange Badge 🟠)
- Can **only message admins**
- Focused on sales operations
- Appears in drivers/users tab

### 5. **Manager** (Indigo Badge 🔷)
- Can **only message admins**
- Supervisory access
- Appears in drivers/users tab

---

## 🔐 Permission Matrix

| From / To  | Admin | Driver | Delivery | Sales | Manager |
|------------|-------|--------|----------|-------|---------|
| **Admin**  | ✅    | ✅     | ✅       | ✅    | ✅      |
| **Driver** | ✅    | ❌     | ❌       | ❌    | ❌      |
| **Delivery**| ✅   | ❌     | ❌       | ❌    | ❌      |
| **Sales**  | ✅    | ❌     | ❌       | ❌    | ❌      |
| **Manager**| ✅    | ❌     | ❌       | ❌    | ❌      |

**Legend:** ✅ = Can send messages | ❌ = Cannot send messages

---

## 🛠️ Setup Instructions

### Database Migration
Before using the new role system, migrate your database:

```bash
# Connect to your database
psql $DATABASE_URL

# Run the migration script
\i migrate-messages-schema.sql

# Verify the migration
SELECT sender_id, receiver_id FROM messages LIMIT 5;
```

See [MESSAGE_MIGRATION_GUIDE.md](MESSAGE_MIGRATION_GUIDE.md) for detailed migration steps.

### Create Users with Roles

#### Method 1: Interactive CLI Script
```bash
node create-user-with-role.js
```
> Follow the prompts to select role, enter username, email, full name, and password.

#### Method 2: SQL Script
```sql
-- Edit add-users-with-roles.sql with your user details
psql $DATABASE_URL < add-users-with-roles.sql
```

#### Method 3: Admin UI
1. Login as admin
2. Go to **Users** page
3. Click **Add New Driver** or **Add New Account**
4. Select role from dropdown:
   - Admin
   - Driver
   - Delivery Team
   - Sales Ops
   - Manager
5. Fill in user details and save

---

## 🎨 UI Features

### Role Badges
- **Color-coded badges** appear next to usernames in:
  - Contact list (Admin Operations > Communication tab)
  - Chat header (when viewing conversation)
  - Message bubbles (DriverPortal and other user portals)
  - User management table (Admin Users page)

### Role Badge Colors
```
🟣 Purple  = Admin
🔵 Blue    = Driver
🟢 Green   = Delivery Team
🟠 Orange  = Sales Ops
🔷 Indigo  = Manager
```

### Contact List (Admin View)
- Admins see **all users** including other admins
- Users sorted by role, then by name
- Online status indicator (green pulse)
- Role badge displayed next to name

### Message View (All Users)
- Incoming messages show sender's role badge
- Message timestamp
- Auto-scroll to latest message
- Notification sound for new messages

---

## 📡 API Endpoints

### Send Message
```http
POST /api/messages/send
Content-Type: application/json
Authorization: Bearer <token>

{
  "driverId": "receiver-user-id",
  "content": "Message text"
}
```

### Get Conversation
```http
GET /api/messages/conversations/:userId
Authorization: Bearer <token>
```

### Get Contacts
```http
GET /api/messages/contacts
Authorization: Bearer <token>
```
> Returns all users for admins, only admins for other roles

### Get Unread Count
```http
GET /api/messages/unread
Authorization: Bearer <token>
```

---

## 🔧 Technical Details

### Database Schema
```prisma
model Message {
  id         String   @id @default(uuid())
  senderId   String
  receiverId String
  content    String
  timestamp  DateTime @default(now())
  read       Boolean  @default(false)
  
  sender     Driver   @relation("SentMessages", fields: [senderId])
  receiver   Driver   @relation("ReceivedMessages", fields: [receiverId])
}
```

### Permission Logic
```javascript
const ROLES = {
  ADMIN: 'admin',
  DRIVER: 'driver',
  DELIVERY_TEAM: 'delivery_team',
  SALES_OPS: 'sales_ops',
  MANAGER: 'manager'
};

async function canSendMessage(senderId, receiverId) {
  // Admin can send to anyone
  if (senderRole === ROLES.ADMIN) return true;
  
  // All roles can send to admin
  if (receiverRole === ROLES.ADMIN) return true;
  
  // Non-admin roles can only send to admins
  return false;
}
```

---

## 🧪 Testing the System

### Test Admin-to-Admin Chat
1. Create two admin users:
   ```bash
   node create-user-with-role.js
   # Select role: 1 (Admin)
   # Create admin1 and admin2
   ```
2. Login as `admin1`
3. Go to **Operations** > **Communication**
4. Select `admin2` from contact list
5. Send a message ✅
6. Login as `admin2` and verify message received

### Test Driver-to-Admin Chat
1. Login as driver
2. Go to **Messages** tab
3. Send message to admin ✅
4. Login as admin
5. Verify message received in Communication tab

### Test Blocked Communication
1. Login as driver
2. Try to send message to another driver ❌
3. Should not appear in contact list (blocked by API)

---

## 🚀 Deployment

### Production Deployment Steps

1. **Backup Database**
   ```bash
   pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
   ```

2. **Run Migration**
   ```bash
   psql $DATABASE_URL < migrate-messages-schema.sql
   ```

3. **Verify Migration**
   ```sql
   SELECT COUNT(*) FROM messages;
   SELECT sender_id, receiver_id FROM messages LIMIT 5;
   ```

4. **Deploy Code**
   ```bash
   git pull origin main
   npm run build
   pm2 restart all
   ```

5. **Test**
   - Login as admin
   - Test messaging with different roles
   - Verify role badges display correctly
   - Check notification system

---

## 📝 Files Modified

### Backend
- `src/server/api/messages.js` - Complete rewrite with ROLES constant and permission system
- `prisma/schema.prisma` - Updated Message model (sender_id/receiver_id)
- `migrate-messages-schema.sql` - Database migration script
- `create-user-with-role.js` - User creation utility
- `add-users-with-roles.sql` - SQL user management script

### Frontend
- `src/pages/AdminOperationsPage.jsx` - Added role badges to contact list and chat header
- `src/pages/DriverPortal.jsx` - Added role badges to messages, updated title
- `src/pages/AdminUsersPage.jsx` - Added role dropdown (5 options) and badges in table
- `src/components/Layout/Header.jsx` - Updated notification system for unified API

---

## 🎯 Key Features

✅ **Admin-to-admin** communication enabled  
✅ **5 role types** with color-coded badges  
✅ **Permission validation** prevents unauthorized messaging  
✅ **Unified API** with sender_id/receiver_id model  
✅ **Real-time notifications** with sound alerts  
✅ **Role-based filtering** in contact lists  
✅ **Enhanced UX** with gradient toast notifications  
✅ **Database migration** with rollback support  

---

## 🆘 Troubleshooting

### Issue: Messages not appearing
**Solution:** Check sender/receiver roles match permission matrix

### Issue: Role badge not showing
**Solution:** Verify `user.role` or `user.account.role` is set in database

### Issue: Can't message another user
**Solution:** Check if both users have appropriate roles (admin can message anyone, others only admins)

### Issue: Migration errors
**Solution:** See [MESSAGE_MIGRATION_GUIDE.md](MESSAGE_MIGRATION_GUIDE.md) rollback section

---

## 📞 Support

For questions or issues:
1. Check permission matrix above
2. Review [MESSAGE_MIGRATION_GUIDE.md](MESSAGE_MIGRATION_GUIDE.md)
3. Verify database migration completed successfully
4. Check browser console for API errors

---

**Last Updated:** 2024  
**Version:** 2.0.0 (Multi-role Messaging System)
