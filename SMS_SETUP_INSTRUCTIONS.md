# 📱 SMS Setup Instructions

## ✅ What's Done

1. ✅ **Twilio package installed** - `npm install twilio` completed
2. ✅ **Environment variables added** - `.env` file updated
3. ✅ **API Key credentials configured** - Your credentials added

---

## ⚠️ Missing Information (REQUIRED)

You provided an **API Key** (starts with "SK"), but we still need:

### 1. **Main Account SID** (Required)
- Find it in: [Twilio Console](https://console.twilio.com)
- Format: `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (starts with "AC")
- Location: Dashboard → Account Info → Account SID
- **This is different from the API Key you provided**

### 2. **Twilio Phone Number** (Required)
- Format: `+1234567890` (E.164 format with country code)
- Get one: [Twilio Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
- If you don't have one, buy one ($1/month)

---

## 🔧 How to Complete Setup

### Step 1: Get Your Account SID
1. Go to: https://console.twilio.com
2. Login
3. Look at the dashboard
4. Copy "Account SID" (starts with "AC")

### Step 2: Get/Buy a Phone Number
1. Go to: Phone Numbers → Manage → Buy a number
2. Choose a country (UAE: +971, US: +1, etc.)
3. Buy number ($1/month for US)
4. Copy the phone number

### Step 3: Update `.env` file
Open `.env` and replace:

```env
# Replace the placeholder Account SID with your actual Account SID:
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Replace this line:
TWILIO_FROM=+1234567890

# With your actual Twilio phone number:
TWILIO_FROM=+971501234567
```

### Step 4: Update FRONTEND_URL for Production
```env
# For local testing:
FRONTEND_URL=http://localhost:5173

# For production (update to your actual domain):
FRONTEND_URL=https://your-domain.vercel.app
```

---

## 🧪 Testing SMS

### 1. Start the server
```bash
npm run dev
```

### 2. Test from UI
1. Login to admin panel
2. Go to Deliveries page
3. Find a delivery with a phone number
4. Click "Send SMS" button
5. Check if SMS is sent

### 3. Check logs
Look for:
```
[SMS] Twilio adapter initialized
✓ SMS sent to +971501234567
```

If you see:
```
[SMS] Twilio adapter not available, using mock adapter
```
Then credentials are not configured correctly.

---

## 📝 Credentials Checklist

**Configured:**
- API Key credentials ✅ (in .env file)

**Still needed:**
- Account SID (AC...): ❌ **Please provide**
- Phone Number (+...): ❌ **Please provide**

---

## 🔐 API Key vs Account SID

**Account SID + Auth Token** (Recommended for simple setup):
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx  # From Twilio Console
TWILIO_AUTH_TOKEN=your_auth_token      # From Twilio Console
```

**API Key + Secret** (More secure):
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx  # Still need the main Account SID
TWILIO_AUTH_TOKEN=your_api_key_secret  # Your API Key Secret
```

Note: Even with API Keys, you still need the main Account SID for the Twilio API URLs.

---

## 🚀 Next Steps

1. ✅ Twilio package installed
2. ⏳ Get Account SID from Twilio Console
3. ⏳ Get/Buy Twilio phone number
4. ⏳ Update `.env` file with both
5. ⏳ Restart server
6. ⏳ Test SMS sending

---

## 💡 Quick Start (If you want to use Account SID + Auth Token instead)

If you want simpler setup, you can use your main Account SID and Auth Token instead of API Key:

1. Go to: https://console.twilio.com
2. Copy "Account SID" (AC...)
3. Copy "Auth Token" (click to reveal)
4. Update `.env`:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx  # Your Account SID
TWILIO_AUTH_TOKEN=your_auth_token      # Your Auth Token (not API Key)
TWILIO_FROM=+971501234567             # Your Twilio number
```

---

## 📞 Need Help?

**Twilio Support:**
- Dashboard: https://console.twilio.com
- Docs: https://www.twilio.com/docs/sms
- Support: https://support.twilio.com

**Common Issues:**
- "Invalid credentials" → Check Account SID and Auth Token/API Key
- "No phone number" → Buy a number in Twilio Console
- "SMS not sending" → Check phone number format (+countrycode...)

---

## ✅ Once Complete, SMS will:

1. ✅ Send confirmation link to customers
2. ✅ Allow customers to confirm delivery
3. ✅ Allow customers to select delivery date
4. ✅ Provide real-time tracking link
5. ✅ Log all SMS activity to database
6. ✅ Handle token expiration (48 hours)

**Status:** Waiting for Account SID and Phone Number to complete setup.
