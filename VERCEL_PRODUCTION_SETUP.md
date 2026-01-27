# Vercel Production Setup Guide

## ✅ GitHub Repository Status
- **Repository:** Alifka-project/smart-logsitics-1
- **Branch:** main
- **Status:** All changes pushed successfully ✅

## 🗄️ Database Configuration

### New Neon Database Connection
The application is now configured to use the new Neon PostgreSQL database:

**Connection String:**
```
postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

**Database Host:** `ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech`  
**Database Name:** `neondb`  
**User:** `neondb_owner`

## 🚀 Vercel Environment Variables

You need to set these environment variables in your Vercel project:

### Required Variables:

1. **DATABASE_URL** (Primary connection - pooled)
   ```
   postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

2. **DATABASE_URL_UNPOOLED** (For migrations)
   ```
   postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

3. **JWT_SECRET** (Generate a secure random string)
   ```bash
   # Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

4. **JWT_REFRESH_SECRET** (Generate a different secure random string)
   ```bash
   # Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

5. **NODE_ENV**
   ```
   production
   ```

6. **FRONTEND_URL**
   ```
   https://smart-logistics-1.vercel.app
   ```

7. **CORS_ORIGINS**
   ```
   https://smart-logistics-1.vercel.app
   ```

## 📝 Steps to Deploy to Vercel

### Option 1: Vercel CLI (Recommended)

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Login to Vercel
vercel login

# Deploy to production
vercel --prod

# Set environment variables
vercel env add DATABASE_URL production
vercel env add DATABASE_URL_UNPOOLED production
vercel env add JWT_SECRET production
vercel env add JWT_REFRESH_SECRET production
vercel env add NODE_ENV production
vercel env add FRONTEND_URL production
vercel env add CORS_ORIGINS production

# Redeploy after setting env vars
vercel --prod
```

### Option 2: Vercel Dashboard

1. Go to https://vercel.com/dashboard
2. Import your GitHub repository: `Alifka-project/smart-logsitics-1`
3. Configure project settings:
   - **Framework Preset:** Vite
   - **Build Command:** `prisma generate && vite build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`

4. Add Environment Variables (Settings → Environment Variables):
   - Add all the required variables listed above
   - Make sure to select "Production" for each variable

5. Deploy!

## 🗃️ Database Setup in Production

After deployment, you need to set up the database:

### 1. Create Default Users

Run this command to create admin and driver users:

```bash
# Using Vercel CLI
vercel env pull .env.production
node create-users-prisma.js
```

Or manually run SQL in Neon console:
```sql
-- This will be done automatically when you run create-users-prisma.js
```

### 2. Default Login Credentials

After running the user creation script:

**Admin Account:**
- Username: `admin`
- Password: `admin123`
- Role: `admin`

**Driver Account:**
- Username: `driver1`
- Password: `driver123`
- Role: `driver`

⚠️ **Important:** Change these passwords in production!

## ✅ Verification Checklist

After deployment, verify:

- [ ] Application loads at https://smart-logistics-1.vercel.app
- [ ] Login page is accessible
- [ ] Can login with admin credentials
- [ ] Can login with driver credentials
- [ ] Database connection is working
- [ ] API endpoints respond correctly

## 🔧 Troubleshooting

### Database Connection Errors

If you see database connection errors:

1. Verify DATABASE_URL is set correctly in Vercel
2. Check that the Neon database is active
3. Verify IP restrictions in Neon settings (should allow all)

### Build Failures

If build fails:

1. Check build logs in Vercel dashboard
2. Ensure `prisma generate` runs before `vite build`
3. Verify all dependencies are in `package.json`

### Login Issues

If login doesn't work:

1. Verify users were created in database
2. Check JWT_SECRET and JWT_REFRESH_SECRET are set
3. Check browser console for errors
4. Verify CORS_ORIGINS matches your domain

## 📊 Current Status

✅ Local Development: Working  
✅ Database: Migrated to new Neon instance  
✅ Users Created: admin, driver1  
✅ Git Repository: All changes pushed  
🔄 Vercel Deployment: Ready to deploy  

## 🎯 Next Steps

1. Deploy to Vercel using one of the options above
2. Set all required environment variables
3. Verify the deployment is working
4. Create default users if not already created
5. Test all functionality
6. Change default passwords

---

**Last Updated:** January 27, 2026  
**Database:** Neon PostgreSQL  
**Status:** Production Ready ✅
