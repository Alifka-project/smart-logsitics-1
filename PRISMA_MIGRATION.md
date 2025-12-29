# 🔄 Migrate to Prisma - Complete Guide

## ✅ Step-by-Step Migration to Prisma

This guide will help you migrate from raw SQL queries to Prisma ORM.

---

## 📋 Step 1: Install Prisma

```bash
cd dubai-logistics-system
npm install prisma @prisma/client --save
```

---

## 📋 Step 2: Initialize Prisma

```bash
npx prisma init
```

This creates:
- `prisma/schema.prisma` - Database schema
- `.env` - Environment variables (if not exists)

---

## 📋 Step 3: Configure Prisma Schema

The Prisma schema has been created in `prisma/schema.prisma` with all your tables:
- ✅ drivers
- ✅ driver_accounts
- ✅ vehicles
- ✅ driver_profiles
- ✅ driver_status
- ✅ live_locations
- ✅ delivery_assignments
- ✅ delivery_events
- ✅ sms_confirmations

---

## 📋 Step 4: Set Up Database Connection

### Option A: Use Prisma Database URL

1. **Get your Prisma connection string:**
   ```
   postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require
   ```

2. **Add to `.env` file:**
   ```bash
   DATABASE_URL="postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require"
   ```

3. **For Vercel, add to Environment Variables:**
   - Key: `DATABASE_URL`
   - Value: Your Prisma connection string

### Option B: Use Prisma Accelerate (Faster - Optional)

If you have Prisma Accelerate URL:
```
PRISMA_DATABASE_URL="prisma+postgres://accelerate.prisma-data.net/?api_key=your_api_key"
```

Add to `.env`:
```bash
DATABASE_URL="prisma+postgres://accelerate.prisma-data.net/?api_key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 📋 Step 5: Push Schema to Database

This will create all tables in your database:

```bash
npx prisma db push
```

This command:
- Creates all tables if they don't exist
- Updates schema if changed
- Does NOT create migration files (use `prisma migrate` for that)

---

## 📋 Step 6: Generate Prisma Client

After pushing schema, generate the Prisma Client:

```bash
npx prisma generate
```

This creates the Prisma Client that you'll use in your code.

---

## 📋 Step 7: Create Initial Users

```bash
node src/server/seedUsers.js
```

This uses Prisma to create:
- Admin user: `Admin` / `Admin123`
- Driver user: `Driver1` / `Driver123`

---

## 📋 Step 8: Update Code to Use Prisma

### Files Already Updated:

✅ `src/server/db/prisma.js` - Prisma client instance
✅ `src/server/db/index.js` - Wrapper with Prisma
✅ `src/server/seedUsers.js` - Uses Prisma

### Files That Need Updating:

You'll need to update API routes to use Prisma instead of raw SQL:

**Example - Old SQL:**
```javascript
const { rows } = await db.query(
  'SELECT * FROM drivers WHERE username = $1',
  [username]
);
```

**New Prisma:**
```javascript
const driver = await prisma.driver.findUnique({
  where: { username },
  include: { account: true }
});
```

---

## 📋 Step 9: Test Locally

```bash
# Start database (if using Docker locally)
npm run dev:db

# Set DATABASE_URL in .env
# Then test
npm run start:server

# Test health endpoint
curl http://localhost:4000/api/health

# Test login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}'
```

---

## 📋 Step 10: Deploy to Vercel

1. **Add DATABASE_URL to Vercel:**
   - Project → Settings → Environment Variables
   - Add `DATABASE_URL` with your Prisma connection string

2. **Add Prisma generate to build:**
   - Update `package.json` build script:
   ```json
   "build": "prisma generate && vite build"
   ```

3. **Deploy:**
   ```bash
   git add .
   git commit -m "Migrate to Prisma ORM"
   git push origin main
   ```

4. **After deployment, run migrations:**
   ```bash
   npx prisma db push --skip-generate
   ```

---

## 🔧 Prisma Commands Reference

```bash
# Generate Prisma Client
npx prisma generate

# Push schema to database (creates/updates tables)
npx prisma db push

# Create migration file
npx prisma migrate dev --name migration_name

# Apply migrations
npx prisma migrate deploy

# View database in Prisma Studio (GUI)
npx prisma studio

# Format schema file
npx prisma format

# Validate schema
npx prisma validate
```

---

## 📝 Prisma Query Examples

### Find Driver by Username:
```javascript
const driver = await prisma.driver.findUnique({
  where: { username },
  include: { account: true }
});
```

### Create Driver:
```javascript
const driver = await prisma.driver.create({
  data: {
    username,
    email,
    fullName,
    account: {
      create: {
        passwordHash,
        role: 'admin'
      }
    }
  }
});
```

### Update Driver:
```javascript
await prisma.driver.update({
  where: { id },
  data: { fullName: 'New Name' }
});
```

### Find Many with Filters:
```javascript
const drivers = await prisma.driver.findMany({
  where: { active: true },
  include: { account: true },
  orderBy: { createdAt: 'desc' }
});
```

---

## ✅ Checklist

- [ ] Prisma installed
- [ ] Prisma initialized
- [ ] Schema created (`prisma/schema.prisma`)
- [ ] DATABASE_URL set in `.env`
- [ ] Schema pushed to database (`prisma db push`)
- [ ] Prisma Client generated (`prisma generate`)
- [ ] Users created (`node src/server/seedUsers.js`)
- [ ] Code updated to use Prisma
- [ ] Tested locally
- [ ] DATABASE_URL added to Vercel
- [ ] Deployed to Vercel
- [ ] Migrations run in production

---

## 🎉 Success!

Your database is now using Prisma ORM with:
- ✅ Type-safe queries
- ✅ Better error handling
- ✅ Automatic migrations
- ✅ Prisma Studio for database GUI
- ✅ Connection pooling
- ✅ Query optimization

**Your application is now using Prisma!** 🚀

