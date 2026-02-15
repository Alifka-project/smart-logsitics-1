# 🚨 URGENT: Vercel Environment Variables Setup

## CRITICAL for Demo Tomorrow

Your production errors are caused by **missing environment variables on Vercel**. The `.env` file only works locally - you MUST set these on Vercel.

---

## ⚡ Quick Fix (5 Minutes)

### 1. Go to Vercel Dashboard
🔗 https://vercel.com/dashboard

### 2. Select Your Project
Click on `electrolux-smart-portal` or your project name

### 3. Go to Settings > Environment Variables
Click "Settings" tab → "Environment Variables" in the left sidebar

### 4. Add These Variables (One by One)

Click "Add New" for each:

#### Database (REQUIRED)
```
Name: DATABASE_URL
Value: postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require
Environment: Production, Preview, Development (select all)
```

#### JWT Secrets (REQUIRED)
```
Name: JWT_SECRET
Value: your_jwt_secret_here
Environment: Production, Preview, Development

Name: JWT_REFRESH_SECRET
Value: your_jwt_refresh_secret_here
Environment: Production, Preview, Development

Name: SESSION_SECRET
Value: your_session_secret_here
Environment: Production, Preview, Development
```

#### Frontend URL (REQUIRED)
```
Name: FRONTEND_URL
Value: https://electrolux-smart-portal.vercel.app
Environment: Production, Preview, Development
```

#### SMS Configuration (REQUIRED for SMS to work)
```
Name: SMS_PROVIDER
Value: twilio
Environment: Production, Preview, Development

Name: TWILIO_ACCOUNT_SID
Value: ACbe...fb3 (use the value from your .env file)
Environment: Production, Preview, Development

Name: TWILIO_AUTH_TOKEN
Value: bda...de (use the value from your .env file)
Environment: Production, Preview, Development

Name: TWILIO_FROM
Value: +140...63 (use the value from your .env file)
Environment: Production, Preview, Development
```

**IMPORTANT**: Use the actual values from your local `.env` file. The values above are masked for security.

#### Node Environment (OPTIONAL)
```
Name: NODE_ENV
Value: production
Environment: Production only
```

---

## 5. Redeploy
After adding all variables:
- Click "Deployments" tab
- Click the three dots (...) on the latest deployment
- Click "Redeploy"
- Wait 2-3 minutes for deployment to complete

---

## ✅ Verification

After redeployment, test these URLs:

### 1. Health Check
```
https://electrolux-smart-portal.vercel.app/api/health
```
Should return: `{"ok":true,"database":"connected",...}`

### 2. Notifications API
```
https://electrolux-smart-portal.vercel.app/api/admin/notifications/count
```
Should return: `{"ok":true,"count":...}` (after login)

### 3. SMS Send
Try sending SMS from the UI - should work without 500 error

---

## 🎯 What This Fixes

✅ 404 errors on `/api/admin/notifications`
✅ 500 errors on SMS send endpoint
✅ All database connections
✅ All authentication features
✅ SMS delivery confirmations

---

## 🔒 Security Note

⚠️ **NEVER commit these values to GitHub!**
- They are already in `.env` which is gitignored ✅
- Vercel environment variables are secure ✅
- Use different values for production vs development ✅

---

## 📞 Need Help?

If errors persist after setting environment variables:
1. Check Vercel deployment logs (Functions tab)
2. Check browser console for specific errors
3. Verify each environment variable is saved correctly
4. Try redeploying again

---

## ⏱️ Time Required
- **5 minutes** to add environment variables
- **2-3 minutes** for Vercel to redeploy
- **Total: ~8 minutes**

---

**Status**: CRITICAL - Must be done before demo tomorrow
**Priority**: HIGH
**Estimated Time**: 8 minutes
