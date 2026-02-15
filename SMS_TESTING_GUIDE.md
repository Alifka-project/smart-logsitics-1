# SMS Feature Testing Guide

## Overview

This guide will help you test the complete SMS confirmation flow from sending SMS to customer tracking.

## Prerequisites

Before testing, ensure:
1. ✅ `.env` file has correct Twilio credentials:
   ```
   SMS_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=AC... (your Account SID, not API Key)
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_FROM=+1234567890 (your Twilio phone number in E.164 format)
   FRONTEND_URL=https://electrolux-smart-portal.vercel.app
   ```

2. ✅ Database is running and migrations are applied
3. ✅ Server is running on production or local
4. ✅ You have at least one delivery with a phone number in the database

## Testing Flow

### Step 1: Upload a Delivery with Phone Number

1. Log in as admin
2. Navigate to **Delivery Management**
3. Click **Upload** button
4. Upload an Excel file with delivery data including:
   - Customer name
   - Phone number (E.164 format, e.g., `+971501234567`)
   - Address
   - Items/Description

**Sample Excel Row:**
| Customer | Phone | Address | Description | Material | Quantity |
|----------|-------|---------|-------------|----------|----------|
| ABC Corp | +971501234567 | Al Zarooni Building Dubai Marina | EK661AI1OX FS COOKER FC GAS CAVITY | 12345 | 1 |

### Step 2: Send Confirmation SMS

1. In **Delivery Management → List View**, find the delivery
2. Each delivery card should have an **SMS button** (blue button with message icon)
3. Click the **SMS** button
4. A modal will appear with:
   - Customer details (name, phone, address)
   - Message preview showing the confirmation link
   - **Send SMS** button

**Expected Modal UI:**
- ✅ Modal should appear **centered on screen**
- ✅ Modal should have **proper z-index** (not hidden behind other elements)
- ✅ Modal background should be **semi-transparent black overlay**
- ✅ Should show customer phone number

5. Click **Send SMS**
6. Wait for confirmation

**Expected Result:**
- ✅ Success message: "SMS Sent Successfully!"
- ✅ Shows confirmation link (can be copied)
- ✅ Shows expiration time (48 hours from now)
- ✅ Shows delivery phone number

**Check Server Logs:**
```
[SMS] Twilio adapter initialized
[SMS] Would send to +971501234567: [message with link]
```

### Step 3: Check Database

Verify SMS was logged:
```sql
SELECT * FROM sms_logs ORDER BY sent_at DESC LIMIT 1;
```

Expected fields:
- `delivery_id` - UUID of delivery
- `phone_number` - Customer phone
- `message_content` - Full SMS text with link
- `sms_provider` - "twilio"
- `status` - "sent" or "queued"
- `sent_at` - Timestamp

Verify delivery was updated:
```sql
SELECT id, confirmation_token, token_expires_at, confirmation_status 
FROM deliveries 
WHERE id = 'your-delivery-id';
```

Expected:
- `confirmation_token` - 32-char hex string
- `token_expires_at` - 48 hours in future
- `confirmation_status` - "pending"

### Step 4: Customer Opens Confirmation Link

1. Copy the confirmation link from the success modal (or from SMS if using real Twilio)
2. Format: `https://electrolux-smart-portal.vercel.app/confirm-delivery/{token}`
3. Open in new browser tab (or send to actual customer phone)

**Expected: Customer Confirmation Page**

✅ Should display:
- Electrolux logo
- "Delivery Confirmation" header
- Order details:
  - Order ID
  - PO Number (if available)
  - Delivery Address
  - Phone Number
  - Items list
- **Select Delivery Date** dropdown (next 7 business days, excluding weekends)
- Confirmation checkbox
- **Confirm Delivery** button

**UI Check:**
- ✅ Page is responsive (works on mobile)
- ✅ No authentication required (public page)
- ✅ Date dropdown shows valid dates only
- ✅ Checkbox must be checked to enable submit

### Step 5: Customer Confirms Delivery

1. Select a delivery date from dropdown
2. Check the confirmation checkbox
3. Click **Confirm Delivery** button

**Expected Result:**
- ✅ Success message: "Delivery Confirmed!"
- ✅ Shows selected delivery date
- ✅ Automatically redirects to tracking page after 3 seconds
- ✅ Database updated:
  ```sql
  SELECT confirmation_status, customer_confirmed_at, confirmed_delivery_date, status
  FROM deliveries
  WHERE id = 'your-delivery-id';
  ```
  - `confirmation_status` = "confirmed"
  - `customer_confirmed_at` = current timestamp
  - `confirmed_delivery_date` = selected date
  - `status` = "confirmed"

**Check Logs:**
```
[SMS] Customer confirmed delivery ID: xxx
[SMS] Sending confirmation SMS to +971501234567
```

### Step 6: Customer Tracking Page

After confirmation, customer is redirected to:
`https://electrolux-smart-portal.vercel.app/customer-tracking/{token}`

**Expected: Real-Time Tracking Page**

✅ Should display:
- **Header:**
  - Electrolux logo
  - Delivery status badge (Confirmed, In Transit, Delivered, etc.)
  - Last updated timestamp
  - **Refresh Now** button

- **Map Section** (if coordinates available):
  - Shows delivery location marker
  - Shows driver location marker (if assigned and tracking enabled)
  - Route line between driver and delivery
  - Interactive map (zoom, pan)

- **Order Information:**
  - PO Number
  - Delivery Address
  - Confirmed Delivery Date

- **Items Section:**
  - List of items being delivered
  - Quantities, SKUs (if available)

- **Driver Information** (if assigned):
  - Driver name
  - Driver phone (clickable to call)

- **ETA** (if calculated):
  - Estimated arrival time
  - Arrival date

- **Delivery Timeline:**
  - All delivery events in chronological order
  - Event types, timestamps

- **Auto-Refresh:**
  - Checkbox to enable/disable auto-refresh every 30 seconds

**UI Check:**
- ✅ Page is responsive
- ✅ Map renders correctly (if coordinates available)
- ✅ Auto-refresh works (updates every 30s if enabled)
- ✅ Refresh button manually updates data

## API Endpoints to Test

### 1. Send SMS (Admin)
```http
POST /api/deliveries/:id/send-sms
Authorization: Bearer {admin_token}

Response:
{
  "ok": true,
  "message": "SMS sent successfully",
  "token": "32-char-hex-token",
  "messageId": "twilio-message-id",
  "expiresAt": "2026-02-17T00:00:00.000Z",
  "confirmationLink": "https://..."
}
```

### 2. Get Confirmation Details (Public)
```http
GET /api/customer/confirm-delivery/:token

Response:
{
  "ok": true,
  "delivery": {
    "id": "...",
    "customer": "ABC Corp",
    "address": "...",
    "phone": "+971501234567",
    "items": [...],
    ...
  },
  "availableDates": ["2026-02-16", "2026-02-17", ...],
  "isAlreadyConfirmed": false
}
```

### 3. Confirm Delivery (Public)
```http
POST /api/customer/confirm-delivery/:token
Content-Type: application/json

{
  "deliveryDate": "2026-02-17"
}

Response:
{
  "ok": true,
  "message": "Delivery confirmed successfully",
  "delivery": { ... }
}
```

### 4. Get Tracking Info (Public)
```http
GET /api/customer/tracking/:token

Response:
{
  "ok": true,
  "delivery": { ... },
  "tracking": {
    "status": "confirmed",
    "eta": "2026-02-17T14:00:00.000Z",
    "driver": { "name": "...", "phone": "..." },
    "driverLocation": { "latitude": 25.2048, "longitude": 55.2708, ... }
  },
  "timeline": [...]
}
```

## Common Issues & Fixes

### Issue 1: SMS Modal Not Appearing or Positioned Incorrectly
**Symptoms:**
- Modal is hidden behind other elements
- Modal appears in wrong position
- Can't see modal at all

**Fix:**
- ✅ **FIXED** - Updated `SMSConfirmationModal.jsx` to use `zIndex: 9999` inline style
- Modal should now appear on top of all elements, centered on screen

**How to verify:**
1. Click SMS button on any delivery card
2. Modal should appear centered with semi-transparent overlay
3. Should be clickable and functional

### Issue 2: "Delivery Not Found" Error
**Symptoms:**
- API returns 404 error
- Console shows "delivery_not_found"

**Possible Causes:**
1. Delivery ID format issue (not a valid UUID)
2. Delivery not in database
3. Using SAP ID instead of database UUID

**Fix:**
- Ensure you're using the UUID from the database, not PO Number
- Check: `SELECT id FROM deliveries WHERE customer = 'ABC Corp';`

### Issue 3: Token Expired
**Symptoms:**
- Customer clicks link and sees "Token has expired"

**Cause:**
- Link was generated more than 48 hours ago

**Fix:**
- Resend SMS from admin portal
- Use the new link

### Issue 4: No Phone Number
**Symptoms:**
- SMS button is disabled or not visible
- API returns "no_phone_number"

**Fix:**
- Ensure delivery has phone number in database
- Update delivery: `UPDATE deliveries SET phone = '+971501234567' WHERE id = '...';`

### Issue 5: Twilio API Error
**Symptoms:**
- Server logs show Twilio errors
- SMS not sent

**Common Errors:**
```
Error: Invalid 'To' phone number
```
**Fix:** Use E.164 format (`+971501234567`, not `0501234567`)

```
Error: Authentication failed
```
**Fix:** Verify `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in `.env`

```
Error: 'From' number not registered
```
**Fix:** Update `TWILIO_FROM` with your verified Twilio number

### Issue 6: Map Not Loading
**Symptoms:**
- Tracking page shows error
- Map is blank

**Cause:**
- Missing coordinates (lat/lng) in delivery
- Leaflet not loading correctly

**Fix:**
- Ensure delivery has lat/lng: `SELECT lat, lng FROM deliveries WHERE id = '...';`
- Check browser console for Leaflet errors

## Production Checklist

Before going live:

- [ ] Update `.env` with production Twilio credentials
- [ ] Set `FRONTEND_URL` to production domain
- [ ] Test SMS sending with real phone numbers
- [ ] Verify confirmation links work in production
- [ ] Test tracking page on mobile devices
- [ ] Check database for SMS logs
- [ ] Monitor Twilio dashboard for SMS delivery status
- [ ] Test expired token handling
- [ ] Test already-confirmed delivery
- [ ] Verify email notifications (if implemented)
- [ ] Load test with multiple concurrent SMS requests

## Monitoring

### Database Queries

**Check SMS sent in last 24 hours:**
```sql
SELECT COUNT(*), status 
FROM sms_logs 
WHERE sent_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

**Check pending confirmations:**
```sql
SELECT id, customer, phone, created_at, token_expires_at
FROM deliveries
WHERE confirmation_status = 'pending'
AND token_expires_at > NOW()
ORDER BY created_at DESC;
```

**Check confirmed deliveries:**
```sql
SELECT id, customer, confirmed_delivery_date, customer_confirmed_at
FROM deliveries
WHERE confirmation_status = 'confirmed'
ORDER BY customer_confirmed_at DESC
LIMIT 10;
```

### Twilio Dashboard

1. Log in to Twilio Console
2. Navigate to **Messaging** → **Logs**
3. Check message status:
   - **Queued** - Message accepted by Twilio
   - **Sent** - Delivered to carrier
   - **Delivered** - Customer received SMS
   - **Failed** - Delivery failed (check error code)

## Support

If issues persist:
1. Check server logs for detailed error messages
2. Verify database schema matches expectations
3. Test API endpoints with curl/Postman
4. Check Twilio console for SMS delivery status
5. Review browser console for frontend errors

---

**Last Updated:** February 15, 2026  
**Version:** 1.0
