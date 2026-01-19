# 🔍 DEPLOYMENT TROUBLESHOOTING - CANNOT ACCESS

**Status**: Deployment complete but access issues  
**Action**: Follow these diagnostic steps

---

## 🚨 Quick Diagnosis Checklist

### Step 1: Check Environment Variables in Vercel

**CRITICAL - This is the most common issue!**

1. Go to https://vercel.com
2. Select your project
3. Settings → **Environment Variables**
4. Verify these are set:
   - ✅ `DATABASE_URL` is set and correct
   - ✅ `JWT_SECRET` is set (>32 characters)

**If NOT set:**
- Add them now
- Redeploy the project (Settings → Deployments → Redeploy)

**If set but still not working:**
- Continue to Step 2

---

### Step 2: Check Deployment Build Status

1. Go to https://vercel.com → Deployments
2. Click the **latest deployment**
3. Check **Build Logs** (not Runtime Logs)

**Look for:**
- ✅ "Successfully compiled" message
- ❌ Any error messages (red text)
- ❌ "DATABASE_URL" or "ERROR" keywords

**If build failed:**
- Check error message in Build Logs
- The error will tell you what's wrong
- Contact support with the error

**If build succeeded:**
- Continue to Step 3

---

### Step 3: Check Runtime Logs

1. Go to https://vercel.com → Deployments → Latest → **Runtime Logs**
2. Make a request to the app
3. Look for **auth/login** messages or **CRITICAL** errors

**Expected logs:**
```
✓ Database connected
✓ auth/login: User logged in successfully
```

**Problem logs:**
```
✗ CRITICAL: DATABASE_URL environment variable is required
✗ auth/login: Database query error: Connection refused
✗ auth/login: Database error code: P1001
```

---

### Step 4: Test Health Endpoint

Try this command:
```bash
curl https://your-app.vercel.app/api/health
```

**Expected response:**
```json
{"ok":true,"database":"connected","orm":"prisma","ts":"..."}
```

**Problem responses:**
```json
{"ok":false,"database":"disconnected","error":"DATABASE_URL environment variable is not set"}
```

If health check fails, the issue is **environment variables or database connection**.

---

### Step 5: Verify Admin User Exists

If health check succeeds but login fails with "invalid_credentials":

```bash
# Connect to your database and check:
SELECT * FROM "Driver" WHERE username = 'Admin';
SELECT * FROM "Account" WHERE "driverId" = (SELECT id FROM "Driver" WHERE username = 'Admin');
```

If no rows returned: **Admin user doesn't exist** → Create it (see instructions below)

---

## 🔧 Common Issues & Fixes

### Issue 1: "Cannot connect to server" on Frontend

**Cause**: API endpoint not accessible

**Fix**:
1. Check if frontend can reach backend
2. Test: `curl https://your-app.vercel.app/api/health`
3. Check CORS settings in `api/index.js`
4. Verify frontend domain is allowed

### Issue 2: 503 Service Unavailable

**Cause**: DATABASE_URL not set or invalid

**Fix**:
1. Go to Vercel → Settings → Environment Variables
2. Add/update `DATABASE_URL`
3. Redeploy: Settings → Deployments → "Redeploy"

### Issue 3: 401 Invalid Credentials (with correct password)

**Cause**: Admin user doesn't exist in database

**Fix**:
```bash
# Create admin user with bcrypt hash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('Admin123', 12).then(h => console.log(h));"

# Then in database:
INSERT INTO "Driver" (id, username, email, phone, "fullName", active, "createdAt")
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'Admin', 'admin@example.com', '+1234567890', 'Administrator', true, NOW());

INSERT INTO "Account" ("driverId", "passwordHash", role, "createdAt")
VALUES ('550e8400-e29b-41d4-a716-446655440000', '<paste-bcrypt-hash>', 'admin', NOW());
```

### Issue 4: "CRITICAL: DATABASE_URL environment variable is required"

**Cause**: Environment variable not set in Vercel

**Fix**:
1. Vercel → Settings → Environment Variables
2. Add: `DATABASE_URL=postgresql://...`
3. Redeploy

### Issue 5: Database Connection Timeout

**Cause**: Database not accessible from Vercel

**Fix**:
1. Check database firewall allows Vercel IP ranges
2. Verify database server is running
3. Check credentials are correct
4. Test connection locally: `psql "YOUR_DATABASE_URL"`

---

## 📋 Full Diagnostic Steps

### Step A: Verify Environment Variables

```bash
# Check Vercel dashboard shows these are SET
# (Settings → Environment Variables)

DATABASE_URL=postgresql://...  ✅ Must be set
JWT_SECRET=...                 ✅ Must be set (>32 chars)
```

### Step B: Test Health Endpoint

```bash
curl https://your-app.vercel.app/api/health

# Should return 200 with:
# {"ok":true,"database":"connected","orm":"prisma","ts":"..."}

# If error, check logs at:
# https://vercel.com → Deployments → Runtime Logs
```

### Step C: Test Login Endpoint

```bash
curl -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}'

# Should return 200 with tokens
# If error, check logs for specific error code
```

### Step D: Check Vercel Logs

```
https://vercel.com → Project → Deployments → Latest → Runtime Logs

Look for:
✅ "Auth endpoint is working"
✅ "auth/login:" messages

❌ "CRITICAL:" errors
❌ "ERROR:" messages
❌ "database" errors
```

---

## 🎯 Most Likely Issues (in order)

1. **Environment Variables Not Set** (70% of cases)
   - Fix: Add DATABASE_URL and JWT_SECRET to Vercel

2. **Admin User Doesn't Exist** (20% of cases)
   - Fix: Create admin user in database

3. **Database Connection Issue** (5% of cases)
   - Fix: Check firewall, credentials, server running

4. **CORS Issues** (3% of cases)
   - Fix: Check CORS configuration

5. **Other** (2% of cases)
   - Check Vercel logs for specific error

---

## 🆘 Quick Action Plan

1. ✅ **Check Vercel Environment Variables**
   - Go to https://vercel.com → Settings → Environment Variables
   - Is `DATABASE_URL` set? YES / NO
   - Is `JWT_SECRET` set? YES / NO
   - If NO: Add them and redeploy

2. ✅ **Test Health Endpoint**
   - Run: `curl https://your-app.vercel.app/api/health`
   - Does it return 200? YES / NO
   - If NO: Check environment variables (go back to step 1)

3. ✅ **Check Vercel Logs**
   - Go to https://vercel.com → Deployments → Runtime Logs
   - Look for error messages
   - If error, fix it based on the message

4. ✅ **Verify Admin User**
   - Connect to database and verify Admin user exists
   - If not, create it

5. ✅ **Test Login**
   - Try login again
   - Should work now!

---

## 📞 What to Check Before Asking for Help

- [ ] Environment variables are set in Vercel
- [ ] Build logs show successful compilation
- [ ] Runtime logs show database connected
- [ ] Health endpoint returns 200
- [ ] Admin user exists in database
- [ ] CORS is configured correctly

---

**Next Step**: Follow the Quick Action Plan above  
**Time to Fix**: Usually 5-10 minutes  
**Success Rate**: 95% of issues are environment variables
