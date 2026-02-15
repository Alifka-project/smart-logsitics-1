# 📱 Manual SMS Testing Guide

## Your Test Phone Number: +971588712409

## Quick Test (5 Minutes)

### Method 1: Using the UI (Recommended)

1. **Start Server:**
   ```bash
   cd /Users/Alifka_Roosseo/Desktop/Project/Logistics-system/dubai-logistics-system
   npm run dev
   ```

2. **Login:**
   - Open browser: http://localhost:5173/login
   - Enter admin credentials
   - Should redirect to `/deliveries`

3. **Upload Test Delivery:**
   - Click **"Upload"** button
   - Use file: `TEST_DELIVERIES.xlsx` (in project root)
   - Or manually create delivery with:
     - Customer: SMS Test Customer
     - Phone: **+971588712409**
     - Address: Al Zarooni Building, Dubai Marina, Dubai
     - Items: Test Product

4. **Send SMS:**
   - Find the delivery in list
   - Click blue **SMS** button (message icon)
   - Modal appears → Review details
   - Click **"Send SMS"**
   - ✅ Success modal shows confirmation link

5. **Check Your Phone:**
   - You should receive SMS within 30 seconds
   - SMS will contain confirmation link
   - Format: `https://electrolux-smart-portal.vercel.app/confirm-delivery/{token}`

6. **Test Confirmation Flow:**
   - Click link in SMS (or copy from modal)
   - Should open confirmation page
   - Select delivery date
   - Check confirmation box
   - Click "Confirm Delivery"
   - Redirected to tracking page

---

### Method 2: Using API (Advanced)

**Prerequisites:**
- Server running on port 4000
- Admin login credentials

**Step 1: Login**
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'
```

Save the token from response.

**Step 2: Get Deliveries**
```bash
curl http://localhost:4000/api/admin/tracking/deliveries \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Find delivery with phone +971588712409, copy the `id`.

**Step 3: Send SMS**
```bash
curl -X POST http://localhost:4000/api/deliveries/DELIVERY_ID_HERE/send-sms \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "SMS sent successfully",
  "token": "32-character-hex-token",
  "messageId": "SM...",
  "expiresAt": "2026-02-18T00:00:00.000Z",
  "confirmationLink": "https://electrolux-smart-portal.vercel.app/confirm-delivery/..."
}
```

**Step 4: Verify Token**
```bash
curl http://localhost:4000/api/customer/confirm-delivery/YOUR_TOKEN_HERE
```

Should return delivery details.

---

### Method 3: Using Test Script (Automated)

```bash
# Update admin credentials in test-sms-live.js first
# Then run:
node test-sms-live.js
```

The script will:
1. ✅ Check server health
2. ✅ Login as admin
3. ✅ Find or create test delivery
4. ✅ Send SMS to your phone
5. ✅ Verify token works

---

## Expected Results

### ✅ Success Indicators

**1. SMS Sent:**
- Modal shows: "SMS Sent Successfully! 🎉"
- Displays: Message ID, Token, Expiration time, Confirmation link

**2. SMS Received (Check your phone):**
```
Hi SMS Test Customer,

Your order from Electrolux is ready for delivery confirmation.

Click to confirm and select your delivery date:
https://electrolux-smart-portal.vercel.app/confirm-delivery/abc123...

This link expires in 48 hours.

Thank you!
```

**3. Confirmation Page:**
- Shows order details
- Date dropdown with 7 options
- Confirmation checkbox
- "Confirm Delivery" button enabled

**4. After Confirmation:**
- Success message appears
- Redirects to tracking page
- Tracking page shows:
  - Map (if coordinates available)
  - Order info
  - Delivery timeline

### ✅ Database Verification

```sql
-- Check SMS was logged
SELECT * FROM sms_logs 
WHERE phone_number = '+971588712409' 
ORDER BY sent_at DESC LIMIT 1;

-- Check delivery has token
SELECT id, customer, phone, confirmation_token, token_expires_at, confirmation_status
FROM deliveries
WHERE phone = '+971588712409'
ORDER BY created_at DESC LIMIT 1;
```

---

## ❌ Troubleshooting

### Issue: SMS Modal Doesn't Appear
**Fix:**
- Refresh page
- Check z-index was fixed (should be 9999)
- Try different delivery

### Issue: "Delivery Not Found" Error
**Fix:**
- Verify delivery has phone number
- Check delivery ID is correct UUID
- Reload deliveries list

### Issue: SMS Not Received
**Possible Causes:**
1. **Twilio credentials wrong**
   - Check `.env` file has correct values:
     - `TWILIO_ACCOUNT_SID` - Should start with AC
     - `TWILIO_AUTH_TOKEN` - Your auth token
     - `TWILIO_FROM` - Your Twilio phone number

2. **Phone number format wrong**
   - Must be E.164: `+971588712409` ✅
   - Not: `0588712409` or `971588712409` ❌

3. **Twilio account issue**
   - Check Twilio Console: https://console.twilio.com
   - Verify phone number is active
   - Check SMS logs for errors

**Check Server Logs:**
```bash
# Look for these messages:
[SMS] Twilio adapter initialized
[SMS] Sending confirmation SMS to delivery: ...
[SMS] ✓ SMS sent successfully
```

**Check Twilio Console:**
- Go to: https://console.twilio.com/us1/monitor/logs/sms
- Find recent message
- Status should be: Delivered ✅

### Issue: Confirmation Link Doesn't Work
**Fix:**
- Check token hasn't expired (48 hours)
- Verify URL is correct: `/confirm-delivery/{token}`
- Check customer portal routes are registered (they are ✅)
- Try in incognito/private window

### Issue: Tracking Page Blank
**Fix:**
- Check browser console for errors
- Verify token is still valid
- Refresh page
- Check server logs

---

## 🎯 Quick Checklist Before Client Demo

Test this flow once before demo:

- [ ] Upload test delivery with your phone
- [ ] Send SMS successfully
- [ ] Receive SMS on phone
- [ ] Click link, see confirmation page
- [ ] Select date and confirm
- [ ] See tracking page
- [ ] Delete test delivery data
- [ ] Upload fresh demo data

**Total Test Time: ~5 minutes**

---

## 📊 What Gets Created

When you send SMS:

**Database Tables Updated:**

1. **deliveries table:**
   - `confirmation_token` = 32-char hex
   - `token_expires_at` = NOW() + 48 hours
   - `confirmation_status` = 'pending'

2. **sms_logs table:**
   - New row with SMS details
   - Phone number, message content, status
   - Twilio message ID

3. **delivery_events table:**
   - Event: 'sms_confirmation_sent'
   - Timestamp, token (masked)

**After Customer Confirms:**

1. **deliveries table:**
   - `confirmation_status` = 'confirmed'
   - `customer_confirmed_at` = NOW()
   - `confirmed_delivery_date` = selected date
   - `status` = 'confirmed'

2. **sms_logs table:**
   - New row: confirmation received SMS

3. **delivery_events table:**
   - Event: 'customer_confirmed'

---

## 🚀 Ready to Test!

**Choose your method:**
- **UI Test** (Recommended): Takes 5 minutes, easiest
- **API Test**: Good for debugging
- **Script Test**: Automated, comprehensive

**Your phone:** +971588712409

**Start server and begin testing! 📱**

---

**Last Updated:** February 16, 2026  
**Test Phone:** +971588712409 (UAE)  
**Status:** Ready for Testing ✅
