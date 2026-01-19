# Simple Login Logic Flow

## What Happens When User Logs In

```
User enters: username="admin" and password="admin123"
                    ↓
          POST /api/auth/login
                    ↓
    Backend checks database:
    - Find user by username
    - Compare password with bcrypt
                    ↓
         If credentials correct:
    - Generate JWT token
    - Create session
    - Return: { driver: {...}, accessToken, role }
                    ↓
    Frontend stores token in localStorage
                    ↓
    Check driver.role:
    - If role = "admin"  → Redirect to /admin
    - If role = "driver" → Redirect to /driver
```

---

## Code Flow

### 1. Frontend (LoginPage.jsx)
```javascript
// User submits form
async function submit(e) {
  const res = await api.post('/auth/login', { username, password });
  const { driver, accessToken } = res.data;
  
  // Save token
  setAuthToken(accessToken);
  
  // Check role and redirect
  if (driver?.role === 'admin') {
    window.location.href = '/admin';  // Go to admin dashboard
  } else {
    window.location.href = '/driver'; // Go to driver dashboard
  }
}
```

### 2. Backend (src/server/api/auth.js)
```javascript
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Find user in database
  const driver = await prisma.driver.findUnique({
    where: { username },
    include: { account: true }
  });
  
  if (!driver) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  
  // Check password
  const passwordMatch = await comparePassword(password, driver.account.passwordHash);
  
  if (!passwordMatch) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  
  // Generate token and return
  const accessToken = generateAccessToken({ sub: driver.id, role: driver.account.role });
  
  res.json({
    driver: { id: driver.id, username: driver.username, role: driver.account.role },
    accessToken,
    clientKey,
    csrfToken
  });
});
```

---

## Simple Logic Summary

✅ **Correct Username & Password**
- Database finds user
- Password matches
- **Result**: JWT token generated, role returned, user logged in

❌ **Wrong Username or Password**
- Database doesn't find user OR password doesn't match
- **Result**: HTTP 401 error "invalid_credentials"

❌ **Account Locked**
- Too many failed login attempts (5+)
- **Result**: HTTP 423 error "account_locked"

---

## Production Requirements (CRITICAL)

### ✅ On Vercel
DATABASE_URL must be set to a REAL PostgreSQL database
- NOT localhost
- NOT 127.0.0.1
- Must be accessible from Vercel servers

### ❌ REMOVED
All localhost references removed from:
- `.env` file (no localhost database URL)
- `src/server/api/sms.js` (uses production domain)
- `src/server/services/emailService.js` (uses production domain)

### ✅ VERCEL ONLY
The app now uses:
- Environment variables set in Vercel dashboard
- Production database connection
- Production domain URLs
- No localhost fallbacks

---

## What You Need to Do

1. **Set DATABASE_URL on Vercel**
   - Go to: https://vercel.com/dashboard → Project → Settings → Environment Variables
   - Add: `DATABASE_URL=postgresql://...` (your real database URL)

2. **Redeploy**
   - Push code: `git push origin main`
   - Wait for Vercel to deploy

3. **Test Login**
   - Go to: https://smart-logistics-1.vercel.app/login
   - Login with credentials
   - Check role and see if redirected to correct dashboard

---

## If Still Not Working

Check Vercel logs:
1. Go to: https://vercel.com/dashboard
2. Select project: smart-logistics-1
3. Click "Deployments"
4. Click latest deployment
5. Click "Runtime logs"
6. Look for errors like:
   - "DATABASE_URL is missing" → Set it on Vercel
   - "Cannot connect to database" → Check connection string format
   - "Invalid credentials" → Check username/password
