# Testing Status Update API

## 1. Get a Real Delivery ID

First, let's verify you have deliveries in the database:

```bash
# Open terminal and run:
psql -U postgres -d logistics_db -c "
SELECT id, customer, status 
FROM delivery 
LIMIT 1;
"
```

**Sample output**:
```
                 id                 | customer | status
------------------------------------+----------+-------
 50e8e3c2-1234-5678-9abc-def123456 | BANDIDOS | pending
```

Save this ID - you'll use it next.

## 2. Test API Directly from Terminal

```bash
# Set your delivery ID
DELIVERY_ID="50e8e3c2-1234-5678-9abc-def123456"

# Get authentication token (check if you're logged in)
TOKEN=$(curl -s http://localhost:5000/api/me -H "Authorization: Bearer YOUR_AUTH_TOKEN" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# If you don't have a token, login first:
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'

# This returns: {"ok":true,"token":"eyJhbGc...","user":{...}}
# Copy the token value

# Now test the status update endpoint:
TOKEN="your_token_here"

curl -X PUT "http://localhost:5000/api/deliveries/admin/$DELIVERY_ID/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "cancelled",
    "notes": "Test update from terminal",
    "driverSignature": "data:image/png;base64,iVBORw0KG...",
    "customerSignature": "data:image/png;base64,iVBORw0KG...",
    "photos": [],
    "actualTime": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }'
```

**Expected response**:
```json
{
  "ok": true,
  "status": "cancelled",
  "delivery": {
    "id": "50e8e3c2-1234-5678-9abc-def123456",
    "customer": "BANDIDOS",
    "address": "123 Main St",
    "status": "cancelled",
    "updatedAt": "2026-01-19T14:05:32.123Z"
  }
}
```

## 3. Verify in Database

After the curl succeeds, check:

```bash
psql -U postgres -d logistics_db -c "
SELECT id, customer, status, updated_at 
FROM delivery 
WHERE id = '$DELIVERY_ID';
"
```

**Should show**:
- status = "cancelled" (changed from "pending")
- updated_at = recent timestamp

## 4. Check Audit Trail

```bash
psql -U postgres -d logistics_db -c "
SELECT event_type, created_at, payload 
FROM delivery_event 
WHERE delivery_id = '$DELIVERY_ID' 
ORDER BY created_at DESC 
LIMIT 3;
"
```

**Should show recent `status_updated` event**

## 5. Common Issues & Solutions

### Issue: 401 Unauthorized
```
{"error":"unauthorized","detail":"No valid auth token"}
```

**Solution**: 
- Login and get token first
- Verify token format: `Bearer eyJhbGc...`
- Check if token is expired (should be valid for 24h)

### Issue: 403 Forbidden
```
{"error":"forbidden","detail":"User role insufficient"}
```

**Solution**:
- Make sure you're logged in as admin
- Check user role in database: `SELECT role FROM "user" WHERE id='...'`
- Must be 'admin' role

### Issue: 404 Not Found
```
{"error":"delivery_not_found"}
```

**Solution**:
- Verify delivery ID is correct
- Check if delivery exists: `SELECT id FROM delivery WHERE id='$DELIVERY_ID'`
- Delivery ID format must be UUID

### Issue: 500 Internal Server Error
```
{"error":"status_update_failed","detail":"..."}
```

**Solution**:
- Check server logs: `npm run dev 2>&1 | grep "error\|500"`
- Verify database connection
- Check Prisma schema is up to date
- Try restarting server: `npm run dev`

## 6. Testing Flow

```bash
# 1. Get delivery
DELIVERY=$(psql -U postgres -d logistics_db -t -c "SELECT id FROM delivery LIMIT 1;")
echo "Testing with delivery: $DELIVERY"

# 2. Check current status
echo "Current status:"
psql -U postgres -d logistics_db -c "SELECT status FROM delivery WHERE id='$DELIVERY';"

# 3. Login and get token
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}')
echo "Login response: $LOGIN_RESPONSE"

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "Token: $TOKEN"

# 4. Update status
UPDATE_RESPONSE=$(curl -s -X PUT "http://localhost:5000/api/deliveries/admin/$DELIVERY/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"cancelled","notes":"Test","driverSignature":"test","customerSignature":"test","photos":[],"actualTime":"2026-01-19T14:05:32Z"}')
echo "Update response: $UPDATE_RESPONSE"

# 5. Verify update
echo "New status:"
psql -U postgres -d logistics_db -c "SELECT status, updated_at FROM delivery WHERE id='$DELIVERY';"
```

## 7. Browser Console Simulation

When testing from the browser, this happens:

```javascript
// 1. Modal opens
console.log("Modal opened for delivery: 50e8e3c2-1234-5678-9abc-def123456");

// 2. User selects status
console.log("Status selected: cancelled");

// 3. User signs
console.log("Signatures added");

// 4. User clicks "Complete Delivery"
// Calls: api.put('/deliveries/admin/50e8e3c2-1234-5678-9abc-def123456/status', {...})

// 5. Should see in console:
// [CustomerModal] Starting status update...
// [CustomerModal] Delivery ID: 50e8e3c2-1234-5678-9abc-def123456
// [CustomerModal] Status: cancelled
// [CustomerModal] API Response: {ok: true, status: 'cancelled', ...}
// [CustomerModal] ✓✓✓ Delivery status updated successfully in database
```

If you see ANY errors in step 5, check the console error details and match against solutions above.

---

## Quick Command Reference

```bash
# Check if server is running
curl http://localhost:5000/api/admin/dashboard | head -20

# List all deliveries
psql -U postgres -d logistics_db -c "SELECT COUNT(*) FROM delivery;"

# Check specific delivery
psql -U postgres -d logistics_db -c "SELECT * FROM delivery WHERE id='YOUR_ID' LIMIT 1;"

# Check audit trail
psql -U postgres -d logistics_db -c "SELECT * FROM delivery_event ORDER BY created_at DESC LIMIT 5;"

# Monitor server logs
npm run dev 2>&1 | tail -20

# Force reload app (in browser console)
localStorage.clear(); location.reload(true);
```

