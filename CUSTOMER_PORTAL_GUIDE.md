# Customer Portal Access Guide

## Overview
Your SMS confirmation and tracking system has **two public customer pages** that customers can access via token-based links (no login required).

---

## 1. **Delivery Confirmation Page**

### 📍 Access Link:
```
https://your-domain.vercel.app/confirm-delivery/:token
```

### Example:
```
https://smart-logistics-1.vercel.app/confirm-delivery/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### What It Does:
- Customer receives SMS with confirmation link
- Opens page to **confirm delivery** 
- **Selects delivery date** from available options (next 7 days, excluding weekends)
- SMS is sent to admin confirming customer's selection

### How to Trigger:
1. Go to **Admin Dashboard** → **Delivery Management**
2. Select a delivery with a phone number
3. Click the **SMS** button
4. Admin gets SMS link and expiration time (48 hours)
5. Customer clicks link in SMS → **Confirmation Page Opens**

---

## 2. **Real-Time Tracking Page**

### 📍 Access Link:
```
https://your-domain.vercel.app/customer-tracking/:token
```

### Example:
```
https://smart-logistics-1.vercel.app/customer-tracking/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### What It Does:
- Customer sees **live map** with driver location
- **Estimated delivery time** (ETA)
- **Driver contact** information
- **Delivery timeline** (when SMS sent, when confirmed, current status)
- **Auto-refreshes every 30 seconds**

### How to Get the Link:
1. Customer confirms delivery via **Confirmation Page**
2. System generates tracking token
3. Send tracking link to customer (via SMS or email)
4. Customer clicks to see real-time tracking

---

## 3. **Simple Tracking (Delivery ID Only)**

### 📍 Access Link:
```
https://your-domain.vercel.app/track/:deliveryId
```

### Example:
```
https://smart-logistics-1.vercel.app/track/550e8400-e29b-41d4-a716-446655440000
```

### What It Does:
- Simpler version, just needs **delivery ID**
- Customer sees order status and basic info
- **No real-time tracking**

---

## **Testing the Customer Pages**

### Step 1: Get a Delivery with Phone Number
```
Admin Dashboard → Delivery Management → Find any delivery with phone number
```

### Step 2: Send SMS to Customer
```
Click "SMS" button on the delivery card
```

### Step 3: Get Test Link
```
The SMS modal shows the confirmation link
Copy it for testing
```

### Step 4: Access Customer Pages
```
Open link in browser:
https://your-domain.vercel.app/confirm-delivery/[TOKEN]
```

---

## **API Endpoints (Behind the Scenes)**

These are called automatically by the customer pages:

### Get Delivery Details & Available Dates
```
GET /api/customer/confirm-delivery/:token
```
**Returns:** Delivery info, available dates, order details

### Confirm Delivery
```
POST /api/customer/confirm-delivery/:token
Body: { confirmedDeliveryDate: "2025-01-30" }
```
**Returns:** Confirmation SMS sent

### Get Real-Time Tracking
```
GET /api/customer/tracking/:token
```
**Returns:** Current driver location, ETA, timeline

---

## **Complete Flow Example**

1. **Admin sends SMS**
   ```
   Phone: +1-555-123-4567
   Message: "Click to confirm: https://app.com/confirm-delivery/abc123"
   ```

2. **Customer clicks link**
   ```
   Opens: /confirm-delivery/abc123
   Sees: Order details + 7 date options
   Selects: "Jan 30, 2025"
   Clicks: "Confirm Delivery"
   ```

3. **Confirmation Sent**
   ```
   SMS to admin: "Customer confirmed delivery for Jan 30"
   Database: Updated with confirmed date
   ```

4. **Customer Gets Tracking Link**
   ```
   Can visit: /customer-tracking/abc123
   Sees: Live driver location, ETA, driver phone
   ```

---

## **Features**

✅ **No Login Required** - Token-based access (secure)
✅ **Mobile Responsive** - Works on phones
✅ **Real-Time Updates** - Auto-refresh every 30 seconds
✅ **Live Map** - Shows driver location
✅ **SMS Integration** - Automatic notifications
✅ **Date Selection** - Customers pick delivery date
✅ **Driver Contact** - Click to call driver

---

## **Token Security**

- ✅ Tokens expire in **48 hours**
- ✅ Tokens are **unique per delivery**
- ✅ Invalid/expired tokens show error page
- ✅ No authentication needed (safer for customers)

---

## **Quick Links Summary**

| Page | URL | Purpose |
|------|-----|---------|
| Confirmation | `/confirm-delivery/:token` | Customer confirms & selects date |
| Tracking | `/customer-tracking/:token` | Live tracking with map |
| Simple Tracking | `/track/:deliveryId` | Basic tracking without token |

