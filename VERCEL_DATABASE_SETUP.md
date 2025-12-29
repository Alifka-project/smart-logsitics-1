# 🐘 Vercel Postgres Database Setup Guide

## Complete Step-by-Step Instructions

---

## ✅ Step 1: Create Vercel Postgres Database

### Via Vercel Dashboard:

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Login to your account

2. **Select Your Project**
   - Click on your project name
   - If you haven't deployed yet, deploy first (see Step 2 below)

3. **Navigate to Storage**
   - Click **"Storage"** tab in the left sidebar
   - Click **"Create Database"** button

4. **Select Postgres**
   - Choose **"Postgres"** from database options
   - Click **"Continue"**

5. **Configure Database**
   - **Name:** `dubai-logistics-db` (or your preferred name)
   - **Region:** Select closest to you
     - `us-east-1` (N. Virginia) - US East
     - `eu-west-1` (Ireland) - Europe
     - `ap-southeast-1` (Singapore) - Asia
   - Click **"Create"**

6. **Wait for Creation**
   - Database creation takes 1-2 minutes
   - You'll see "Database created successfully"

7. **Copy Connection String**
   - After creation, you'll see connection details
   - **Connection String** looks like:
     ```
     postgres://default:xxxxx@xxxxx.xxxxx.postgres.vercel-storage.com:5432/verceldb
     ```
   - Click **"Copy"** to copy the connection string
   - **SAVE THIS** - you'll need it for environment variables!

---

## ✅ Step 2: Connect Database to Your Project

1. **Go to Project Settings**
   - In Vercel Dashboard, select your project
   - Click **"Settings"** tab
   - Click **"Environment Variables"** in left sidebar

2. **Add DATABASE_URL**
   - Click **"Add New"**
   - **Key:** `DATABASE_URL`
   - **Value:** Paste your connection string from Step 1
   - **Environment:** Check all (Production, Preview, Development)
   - Click **"Save"**

3. **Generate and Add Secret Keys**

   Open terminal and run:
   ```bash
   # Generate JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the output, then in Vercel:
   - **Key:** `JWT_SECRET`
   - **Value:** (paste the generated secret)
   - **Environment:** All
   - Click **"Save"**

   Repeat for:
   ```bash
   # Generate JWT_REFRESH_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # Generate SESSION_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Add both to Vercel environment variables.

---

## ✅ Step 3: Run Database Migrations

You need to create the database tables. Choose one method:

### Method A: Using Vercel Dashboard (Easiest - No Installation)

1. **Open Migration File**
   - In your project, open: `db/migrations/001_create_drivers_and_locations.sql`
   - Copy ALL the SQL content (entire file)

2. **Go to Vercel Database Query Tab**
   - Vercel Dashboard → Storage → Your Database
   - Click **"Query"** tab

3. **Run Migration**
   - Paste the SQL in the query editor
   - Click **"Run"** button
   - Wait for completion
   - You should see "Success" message

### Method B: Using Command Line (More Control)

1. **Install psql** (PostgreSQL client):
   ```bash
   # Mac
   brew install postgresql
   
   # Linux
   sudo apt-get install postgresql-client
   
   # Windows
   # Download from: https://www.postgresql.org/download/windows/
   ```

2. **Run Migration Script:**
   ```bash
   cd dubai-logistics-system
   
   # Set your connection string
   export DATABASE_URL="postgres://default:xxxxx@xxxxx.xxxxx.postgres.vercel-storage.com:5432/verceldb"
   
   # Run migration
   ./scripts/migrate-vercel.sh
   ```

   Or manually:
   ```bash
   psql $DATABASE_URL -f db/migrations/001_create_drivers_and_locations.sql
   ```

---

## ✅ Step 4: Create Default Users

You need to create admin and driver users in the database.

### Via Command Line:

```bash
cd dubai-logistics-system

# Set DATABASE_URL (if not already set)
export DATABASE_URL="postgres://default:xxxxx@xxxxx.xxxxx.postgres.vercel-storage.com:5432/verceldb"

# Create users
node src/server/seedUsers.js
```

This creates:
- **Admin:** Username `Admin`, Password `Admin123`
- **Driver:** Username `Driver1`, Password `Driver123`

### Via Vercel Query Tab (Manual):

1. Go to Storage → Your Database → Query tab
2. Run this SQL (customize as needed):
   ```sql
   -- This requires bcrypt, so it's better to use seedUsers.js script
   -- But you can create users manually if needed
   ```

**Note:** The seedUsers.js script handles password hashing automatically.

---

## ✅ Step 5: Redeploy Application

After setting up database and environment variables:

1. **Redeploy in Vercel**
   - Go to Vercel Dashboard → Your Project
   - Click **"Deployments"** tab
   - Find the latest deployment
   - Click **"⋯"** (three dots) → **"Redeploy"**
   - Or push a new commit to trigger automatic deployment

2. **Wait for Deployment**
   - Build takes 1-2 minutes
   - New deployment will include database connection

---

## ✅ Step 6: Verify Everything Works

### 1. Check Health Endpoint

Visit: `https://your-app.vercel.app/api/health`

**Expected Response:**
```json
{
  "ok": true,
  "database": "connected",
  "ts": "2024-12-29T15:30:00.000Z"
}
```

**If you see:**
```json
{
  "ok": false,
  "database": "disconnected",
  "error": "Database connection required"
}
```
Then DATABASE_URL is not set correctly. Check environment variables.

### 2. Test Login

1. Visit: `https://your-app.vercel.app`
2. Login with:
   - Username: `Admin`
   - Password: `Admin123`
3. Should redirect to `/admin` dashboard

If login fails, check:
- Database connection (health endpoint)
- Users exist in database
- DATABASE_URL is correct

---

## 🐛 Troubleshooting

### Database Connection Error

**Problem:** "Database connection required" error

**Solutions:**
1. Check DATABASE_URL is set in Vercel environment variables
2. Verify connection string is correct (no extra spaces)
3. Make sure you selected all environments (Production, Preview, Development)
4. Redeploy after adding environment variables

### "Relation does not exist" Error

**Problem:** Tables don't exist

**Solutions:**
1. Make sure you ran migrations (Step 3)
2. Check if tables exist:
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
   ```
3. Re-run migration if tables are missing

### Login Fails with "Invalid credentials"

**Problem:** Users don't exist in database

**Solutions:**
1. Run `node src/server/seedUsers.js` with DATABASE_URL set
2. Verify users exist:
   ```sql
   SELECT username, role FROM drivers d JOIN driver_accounts da ON d.id = da.driver_id;
   ```
3. Check password is hashed correctly

### Health Check Shows "disconnected"

**Problem:** Database not accessible

**Solutions:**
1. Check Vercel Storage dashboard - database should be "Active"
2. Verify DATABASE_URL format:
   ```
   postgres://username:password@host:port/database
   ```
3. Test connection with psql:
   ```bash
   psql "your_connection_string" -c "SELECT 1;"
   ```

---

## ✅ Complete Checklist

Before considering setup complete:

- [ ] Vercel Postgres database created
- [ ] DATABASE_URL environment variable added
- [ ] JWT_SECRET environment variable added
- [ ] JWT_REFRESH_SECRET environment variable added
- [ ] SESSION_SECRET environment variable added
- [ ] Database migrations run successfully
- [ ] Default users created (Admin, Driver1)
- [ ] Application redeployed
- [ ] Health check returns `"database": "connected"`
- [ ] Login works with Admin credentials
- [ ] Can access admin dashboard

---

## 🎉 Success!

Once all steps are complete:

- ✅ Database is running on Vercel
- ✅ All tables created
- ✅ Users can log in
- ✅ All features work with database
- ✅ Data persists across deployments

**Your application is now fully deployed with PostgreSQL database on Vercel!** 🚀

---

## 📚 Additional Resources

- **Vercel Storage Docs:** https://vercel.com/docs/storage/vercel-postgres
- **PostgreSQL Docs:** https://www.postgresql.org/docs/
- **Connection String Format:** https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING

---

## 🔄 Updating Database Schema

If you need to add new migrations:

1. Create new migration file: `db/migrations/002_your_migration.sql`
2. Copy SQL content
3. Run in Vercel Query tab or via psql
4. Test thoroughly before production use

