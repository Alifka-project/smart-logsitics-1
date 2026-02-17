# Chat System Fix - Multi-Role Communication

## Issue Reported
The Delivery Team Portal was not receiving chat messages or notifications. The Communication tab showed "No contacts available" and messages were not being properly sent or received.

## Root Causes Identified

### 1. **Bidirectional Messaging Problem**
The messaging system was originally designed for one-directional admin→driver communication. When extended to multi-role (delivery_team↔admin, delivery_team↔driver), the conversation queries only checked one direction:

```javascript
// OLD - Only checked one direction
where: {
  adminId: currentUser,
  driverId: contactId
}
```

**Problem**: When admin sends a message to delivery_team, it's stored as:
- `adminId` = admin's ID
- `driverId` = delivery_team's ID

But when delivery_team tries to load that conversation, they query:
- `adminId` = delivery_team's ID (current user)
- `driverId` = admin's ID (contact)

This doesn't match! Messages were invisible in the opposite direction.

### 2. **Message Rendering Issues**
The frontend was checking for non-existent fields:
- Used `msg.fromRole` instead of `msg.senderRole`
- Used `msg.message` instead of `msg.content`
- Couldn't properly determine if a message was sent or received

### 3. **Unread Count Problems**
The unread count endpoint only counted messages from drivers (`senderRole: 'driver'`), missing messages from admin and delivery_team members.

## Solutions Implemented

### 1. Bidirectional Message Queries ✅
Updated `/api/messages/conversations/:id` endpoint:

```javascript
// NEW - Checks BOTH directions
where: {
  OR: [
    { adminId: currentUser, driverId: contactId },     // Current user sent to contact
    { adminId: contactId, driverId: currentUser }      // Contact sent to current user
  ]
}
```

This ensures all messages between two users are loaded regardless of who is "admin" and who is "driver" in the database schema.

### 2. Fixed Message Rendering ✅
Updated DeliveryTeamPortal.jsx to:
- Use `msg.content` (correct field name)
- Check `msg.adminId === currentUserId` to determine sent vs received
- Properly align and style messages based on actual sender

```javascript
const isSent = msg.adminId === currentUserId;
// Then use isSent to determine alignment and styling
```

### 3. Fixed Unread Counts ✅
Updated `/api/messages/unread` endpoint to:
- Find all messages where `driverId === currentUserId` (current user is recipient)
- Group by `adminId` (the sender)
- Works for any role combination

### 4. Added Debug Logging ✅
Added comprehensive logging to track:
- Contacts loading (team members, drivers, total count)
- Message queries (bidirectional results)
- Current user information
- Online status detection

## Testing Instructions

### Test 1: Delivery Team → Admin Chat
1. Log in as delivery_team user (e.g., Nitin Kumar)
2. Navigate to Communication tab
3. Verify contacts list shows:
   - Team section: Admin users
   - Drivers section: All drivers
4. Select an admin contact
5. Send a test message
6. Verify message appears on the right side (sent)

### Test 2: Admin → Delivery Team Chat
1. Log in as admin
2. Navigate to Operations → Communication tab
3. Find delivery_team member in Team section
4. Send a message to them
5. Verify message appears correctly

### Test 3: Bidirectional Conversation
1. With delivery_team logged in, send message to admin
2. Switch to admin account
3. Check Communication tab - should see message from delivery_team
4. Reply from admin
5. Switch back to delivery_team
6. Verify you can see both messages in chronological order

### Test 4: Unread Counts
1. Send messages from admin to delivery_team (without delivery_team viewing)
2. Log in as delivery_team
3. Check Communication tab - should see red badge with unread count
4. Click on the conversation
5. Badge should disappear (messages marked as read)

### Test 5: Delivery Team → Driver Chat
1. Log in as delivery_team
2. Select a driver from Drivers section
3. Send message
4. Log in as that driver
5. Check their messages - should see message from delivery_team
6. Reply
7. Verify bidirectional conversation works

## Files Modified

1. **src/server/api/messages.js**
   - `GET /conversations/:driverId` - Bidirectional query using OR condition
   - `GET /unread` - Fixed to find messages where current user is recipient
   - Added logging for debugging

2. **src/pages/DeliveryTeamPortal.jsx**
   - Fixed message rendering to use `msg.content` and proper sender detection
   - Added debug logging for contacts loading
   - Added current user logging

## Technical Details

### Message Schema Structure
```
Message {
  adminId: String    // "Sender" in admin/delivery_team roles
  driverId: String   // "Recipient" or "Other party"
  senderRole: String // The actual role of who sent it
  content: String    // The message text
  isRead: Boolean    // Read status
  createdAt: Date    // Timestamp
}
```

### Bidirectional Query Logic
For user A talking to user B, messages can be stored as:
- Direction 1: adminId = A, driverId = B
- Direction 2: adminId = B, driverId = A

The OR condition finds both directions, making communication truly bidirectional regardless of role hierarchy.

### Message Ownership Detection
To determine if current user sent a message:
```javascript
const isSent = msg.adminId === currentUserId;
```

This works because in our system:
- Admin/delivery_team always send as `adminId`
- The recipient is always in `driverId` field
- So if `adminId` matches current user, they sent it

## Deployment Status

✅ Built successfully (1,509.89 kB bundle)
✅ No compilation errors
✅ Committed to Git (commit 22db2a2)
✅ Pushed to GitHub main branch

## Next Steps

1. **Test in Production**: Once deployed to Vercel, test all scenarios above
2. **Monitor Logs**: Check browser console for debug messages about contacts loading
3. **Verify Online Status**: Ensure users show as online when active in Communication tabs
4. **Check Notifications**: Verify unread badges appear and clear correctly

## Known Limitations

- The database schema uses "adminId" and "driverId" which is confusing for multi-role communication
- Consider future migration to more generic "senderId" and "recipientId" fields
- Current system works but requires bidirectional queries

## Support

If issues persist, check:
1. Browser console for errors or debug messages
2. Server logs for API endpoint errors
3. Network tab to see if `/api/messages/contacts` returns data
4. Verify user has correct role (delivery_team, admin, or driver)
