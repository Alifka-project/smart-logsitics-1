# Testing Guide: Dashboard Status Update Fix

## Quick Test (5 minutes)

### Setup
1. Start the application
2. Login as admin
3. Go to Delivery Management page
4. Upload some test deliveries (or click "Load Sample Data")

### Test Case 1: Cancel a Delivery

**Steps**:
1. In "Delivery Management", click on a delivery card from the "Delivery Sequence" list
2. A modal should open showing delivery details
3. Scroll down to "Update Status" section
4. Click the red "Cancelled" status button
5. Draw signatures in both signature pads
6. Click "Complete Delivery" button
7. Modal should close

**Verification**:
1. **Immediate**: The delivery status in the list should update to show "Cancelled"
2. **Database Check**: 
   ```bash
   # In psql terminal:
   SELECT id, customer, status, updated_at FROM delivery WHERE id = '<delivery-id>';
   ```
   Should show status = 'cancelled'

3. **Audit Trail**:
   ```bash
   SELECT * FROM delivery_event WHERE delivery_id = '<delivery-id>' AND event_type = 'status_updated';
   ```
   Should show the status change event

### Test Case 2: Dashboard Auto-Refresh

**Steps**:
1. Open AdminDashboard in another browser tab
2. Go back to DeliveryManagement
3. Cancel a delivery (see Test Case 1)
4. Switch to AdminDashboard tab

**Verification**:
1. Dashboard should automatically refresh within 5 seconds
2. "Cancelled" count should increase by 1
3. Status chart should update
4. Metrics should show the new cancelled delivery

### Test Case 3: Data Persistence

**Steps**:
1. Cancel a delivery (Test Case 1)
2. Refresh the page (F5)
3. Go back to DeliveryManagement

**Verification**:
1. The cancelled delivery should still show as "Cancelled"
2. The status persists across page refresh
3. This confirms database update, not just localStorage

### Test Case 4: Other Statuses

Repeat Test Case 1-3 with different statuses:
- "Delivered (With Installation)" - GREEN
- "Delivered (No Installation)" - GREEN  
- "Out for Delivery" - BLUE
- "Scheduled" - PURPLE
- "Rescheduled" - ORANGE
- "Rejected" - RED

All should update in database and dashboard.

## Advanced Testing

### Test 5: Error Handling

**Steps**:
1. Open browser DevTools (F12)
2. Go to Network tab
3. Right-click and select "Throttle" → "Offline"
4. Try to cancel a delivery
5. Error message should appear
6. Turn network back on
7. Try again - should succeed

**Verification**:
- Error message appears: "Failed to update delivery status"
- Modal stays open
- Data is preserved for retry
- Success after reconnect

### Test 6: Verify Audit Trail

**Steps**:
1. Update several deliveries with different statuses
2. Check database for audit trail:

```sql
SELECT 
  id, 
  delivery_id, 
  event_type, 
  payload, 
  actor_type, 
  actor_id, 
  created_at 
FROM delivery_event 
WHERE event_type = 'status_updated'
ORDER BY created_at DESC
LIMIT 10;
```

**Verification**:
- Each status update creates an event
- Events show previous and new status
- Actor information is recorded
- Timestamps are accurate

### Test 7: Performance

**Steps**:
1. Upload 100+ deliveries
2. Rapidly update statuses of different deliveries
3. Monitor browser console and server logs

**Verification**:
- No crashes or hanging
- Updates process quickly
- Dashboard refreshes smoothly
- Server logs show all updates:
  ```
  [Deliveries] Updating delivery <id> status to <status>
  [Deliveries] ✓ Successfully updated delivery <id>
  ```

### Test 8: Multiple Users

**Setup**:
1. Open app in incognito window (User 1)
2. Open app in regular window (User 2)
3. Both logged in as admin

**Steps**:
1. User 1: Cancel delivery A
2. User 2: View AdminDashboard
3. User 2 should see delivery A as cancelled within 5 seconds
4. User 2: Update delivery B to "Delivered"
5. User 1: AdminDashboard should auto-refresh
6. Both metrics update correctly

**Verification**:
- Real-time sync between users
- No conflicts
- Consistent data

## Server Logs to Check

When running the server, look for these log messages indicating successful updates:

```bash
[Deliveries] Updating delivery abc-123 status to cancelled
[Deliveries] ✓ Successfully updated delivery abc-123 to status cancelled
```

Or errors if something goes wrong:

```bash
[Deliveries] Error updating delivery status: <error message>
```

## Database Schema Verification

Verify the delivery table has required columns:

```sql
-- Check delivery table structure
\d delivery;

-- Should have columns:
-- id, customer, address, phone, lat, lng, status, items, metadata, created_at, updated_at

-- Check delivery_event table
\d delivery_event;

-- Should have columns:
-- id, delivery_id, event_type, payload, actor_type, actor_id, created_at
```

## API Endpoint Testing (with curl)

```bash
# 1. Get auth token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}' \
  -c cookies.txt

# 2. Update delivery status
curl -X PUT http://localhost:5000/api/deliveries/admin/{delivery-id}/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "status": "cancelled",
    "notes": "Test cancellation",
    "driverSignature": "signature-data",
    "customerSignature": "signature-data",
    "photos": [],
    "actualTime": "2026-01-19T12:00:00Z"
  }'

# Should return:
# {"ok":true,"status":"cancelled","delivery":{...}}

# 3. Verify in database
psql -U postgres -d logistics_db -c "SELECT id, status, updated_at FROM delivery WHERE id = '{delivery-id}';"
```

## Troubleshooting

### Issue: Status not updating in database

**Check**:
1. Server logs for errors
2. Database connection string in .env
3. User has admin role
4. Network tab in DevTools shows successful PUT request
5. Browser console for JavaScript errors

### Issue: Dashboard not refreshing

**Check**:
1. Auto-refresh checkbox is enabled
2. Check browser console for errors
3. Check server logs
4. Try manual "Refresh Now" button
5. Verify WebSocket connection (if using real-time features)

### Issue: Error "Failed to update delivery status"

**Check**:
1. Server is running and accessible
2. Authentication token is valid
3. Delivery ID exists in database
4. User is logged in as admin
5. Check server logs for detailed error message

## Browser Console Commands

Debug the status update in browser console:

```javascript
// Listen for status update events
window.addEventListener('deliveryStatusUpdated', (e) => {
  console.log('Delivery updated:', e.detail);
});

// Manually trigger dashboard refresh
window.dispatchEvent(new Event('deliveriesUpdated'));

// Check localStorage
console.log(JSON.parse(localStorage.getItem('deliveries_data')));
```

## Success Criteria

✅ **Test is successful when**:
- Status changes appear immediately in the modal
- Delivery list updates the status badge
- AdminDashboard metrics auto-update
- Database shows updated `delivery.status`
- Database shows new `delivery_event` record
- Page refresh preserves the status
- No errors in browser console or server logs
- Status updates work for all 7 status types

✅ **Performance acceptable when**:
- Status update takes <1 second to complete
- Dashboard refreshes within 5 seconds
- No UI blocking or freezing
- Multiple rapid updates don't cause issues

✅ **Security verified when**:
- Non-admin users cannot update status (403 error)
- Invalid status values are rejected
- CSRF token is validated
- Audit trail records all changes
- Sensitive data not logged
