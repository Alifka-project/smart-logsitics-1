# Quick Deploy Reference

## 🚀 Deploy to Vercel NOW

### Step 1: Go to Vercel Dashboard
Visit: https://vercel.com/dashboard

### Step 2: Import Repository
- Click "Add New..." → "Project"
- Import from GitHub: `Alifka-project/smart-logsitics-1`
- Connect your GitHub account if needed

### Step 3: Configure Build Settings
These should be auto-detected:
- **Framework Preset:** Vite
- **Build Command:** `prisma generate && vite build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### Step 4: Add Environment Variables

Click "Environment Variables" and add these (copy/paste):

#### 1. DATABASE_URL
```
postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

#### 2. DATABASE_URL_UNPOOLED
```
postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

#### 3. JWT_SECRET
Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

#### 4. JWT_REFRESH_SECRET
Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

#### 5. NODE_ENV
```
production
```

#### 6. FRONTEND_URL
```
https://smart-logistics-1.vercel.app
```
(Update with your actual Vercel URL after first deployment)

#### 7. CORS_ORIGINS
```
https://smart-logistics-1.vercel.app
```
(Update with your actual Vercel URL after first deployment)

### Step 5: Deploy!
Click "Deploy" and wait for build to complete

### Step 6: Create Users in Production Database

After deployment, run this command to create default users:

```bash
# Pull production environment variables
vercel env pull .env.production

# Create users
node create-users-prisma.js
```

Or manually create users via Neon SQL console.

### Step 7: Test Your Deployment

1. Visit your Vercel URL
2. Login with:
   - Username: `admin`
   - Password: `admin123`
3. Change password immediately!

---

## 📋 Environment Variables Checklist

- [ ] DATABASE_URL (Neon pooled connection)
- [ ] DATABASE_URL_UNPOOLED (Neon direct connection)
- [ ] JWT_SECRET (64-char random hex)
- [ ] JWT_REFRESH_SECRET (64-char random hex)
- [ ] NODE_ENV=production
- [ ] FRONTEND_URL (Your Vercel URL)
- [ ] CORS_ORIGINS (Your Vercel URL)

---

## ⚠️ Important Notes

1. **Default Passwords:** Change `admin123` and `driver123` immediately after first login
2. **JWT Secrets:** NEVER use the same secrets for different environments
3. **Database URL:** Already includes pooling - perfect for production
4. **CORS:** Update FRONTEND_URL and CORS_ORIGINS to match your actual Vercel URL

---

## 🔧 Troubleshooting

### Build Fails
- Check build logs in Vercel dashboard
- Ensure all environment variables are set
- Verify DATABASE_URL is correct

### Can't Login
- Check that users were created in the database
- Verify JWT_SECRET is set in Vercel
- Check browser console for errors

### Database Connection Error
- Verify DATABASE_URL in Vercel environment variables
- Check Neon database is running
- Ensure IP restrictions are disabled in Neon

---

## 📖 Full Documentation

For complete setup instructions, see: [VERCEL_PRODUCTION_SETUP.md](./VERCEL_PRODUCTION_SETUP.md)

---

**Status:** Production Ready ✅  
**Last Updated:** January 27, 2026
