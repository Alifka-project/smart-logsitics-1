# Production Deployment - Vercel Environment Setup

## Current Status
- Frontend: Running on `smart-logistics-1.vercel.app`
- Backend: Running on `smart-logistics-1.vercel.app/api` (Vercel serverless)
- Both use the same domain - frontend makes requests to `/api/...` (relative URLs)

## Required Environment Variables for Vercel

You need to set these in your Vercel project dashboard:

### Database Configuration
```
DATABASE_URL=postgresql://user:password@host:port/database_name
```
**CRITICAL**: Without this, login will fail with "Database connection failed"

### JWT Secrets (for authentication)
```
JWT_SECRET=<strong-random-secret-at-least-32-characters>
JWT_REFRESH_SECRET=<strong-random-secret-at-least-32-characters>
```

### Deployment Environment
```
NODE_ENV=production
ENFORCE_HTTPS=1
```

### CORS Configuration (allow your frontend domain)
```
CORS_ORIGINS=https://smart-logistics-1.vercel.app
```

### Optional: Frontend URL (for email/SMS links)
```
FRONTEND_URL=https://smart-logistics-1.vercel.app
```

---

## How to Set Environment Variables on Vercel

1. Go to: https://vercel.com/dashboard
2. Select your project: **smart-logistics-1**
3. Click **Settings** → **Environment Variables**
4. Add each variable above
5. Redeploy the project to apply changes

---

## How Frontend Connects to Backend

✅ **Frontend to Backend Communication**:
- Frontend makes requests to `/api/auth/login`
- Vercel routes `/api/*` requests to `api/index.js` (Express server)
- Both are on same domain: `smart-logistics-1.vercel.app`
- **No localhost references** - Production only!

---

## After Setting Environment Variables

1. **Redeploy** the project on Vercel
2. **Wait** 2-3 minutes for deployment to complete
3. **Test login** on `https://smart-logistics-1.vercel.app/login`
4. Check **Network tab** in DevTools (F12) to verify:
   - Login request goes to `/api/auth/login`
   - Response includes `accessToken` and `clientKey`

---

## Troubleshooting Production Login

### Issue: Still getting "Server error"
**Check**: Vercel deployment logs
- Go to Vercel dashboard → Deployments → Click latest → Logs (Runtime)
- Look for: "DATABASE_URL is missing" or database connection errors

### Issue: CORS error in browser console
**Check**: `CORS_ORIGINS` environment variable
- Should be: `https://smart-logistics-1.vercel.app`
- Not: `http://...` or `localhost`

### Issue: Token error
**Check**: `JWT_SECRET` and `JWT_REFRESH_SECRET` are set
- Must be different from each other
- Must be at least 32 characters

---

## Database Connection String Format

If using PostgreSQL on:
- **Vercel Postgres**: `postgresql://default:...@aws-xxx-xxx.postgres.vercel-storage.com:5432/verceldb?sslmode=require`
- **Railway**: `postgresql://user:pass@containers-us-west-xxx.railway.app:5432/railway`
- **Heroku**: `postgresql://user:pass@ec2-xxx-us-east-1.compute.amazonaws.com:5432/dbname?sslmode=require`

---

## Verify Setup

After setting environment variables, test the backend:

```bash
# Test API health
curl https://smart-logistics-1.vercel.app/api/health

# Should return (may say database disconnected if DB not accessible from Vercel):
# {"ok": true/false, "database": "connected/disconnected", ...}
```

---

## Next Steps

1. ✅ Set all environment variables above in Vercel dashboard
2. ✅ Redeploy project
3. ✅ Test login at `https://smart-logistics-1.vercel.app/login`
4. ✅ If still failing, check Vercel logs
