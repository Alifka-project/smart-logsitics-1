# 🚀 Prisma Quick Start Guide

## ✅ Complete Setup in 5 Steps

You have Prisma connection strings ready. Follow these steps:

---

### Step 1: Set DATABASE_URL

**Add to your `.env` file:**

```bash
DATABASE_URL="postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require"
```

**Or use Prisma Accelerate (faster):**

```bash
DATABASE_URL="prisma+postgres://accelerate.prisma-data.net/?api_key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqd3RfaWQiOjEsInNlY3VyZV9rZXkiOiJza19heXhXTTNIVHBoTlVtSWhFVVl2X18iLCJhcGlfa2V5IjoiMDFLRE5EWkZLMlBIQjFDRVFTWTI0RkZHS1EiLCJ0ZW5hbnRfaWQiOiI2YTgxZWZhZjc0ZjRhMTE3YTJiZDY0ZmQ0M2FmOWFhZTVhZDUyMDk2MjhhYmUzMTNkYzkzOTMzZTQ2OGUyYTY0IiwiaW50ZXJuYWxfc2VjcmV0IjoiMjY5N2I0MTgtNjY3My00MTliLTg0MGItMmY5OTY0MjFjZGY4In0.NLASl9RPSF7AfCrAhF1PZ4XvRZ9eA5Oh4mQZKXgcynQ"
```

---

### Step 2: Push Schema to Database

This creates all tables in your Prisma database:

```bash
cd dubai-logistics-system
npx prisma db push
```

You should see:
```
✅ Your database is now in sync with your Prisma schema.
```

---

### Step 3: Generate Prisma Client

Generate the Prisma Client code:

```bash
npx prisma generate
```

You should see:
```
✔ Generated Prisma Client
```

---

### Step 4: Create Default Users

Create admin and driver users:

```bash
node src/server/seedUsers.js
```

This creates:
- **Admin:** `Admin` / `Admin123`
- **Driver:** `Driver1` / `Driver123`

---

### Step 5: Test Connection

Start your server:

```bash
npm run start:server
```

Then test:
```bash
# Health check
curl http://localhost:4000/api/health

# Should return: {"ok":true,"database":"connected",...}
```

Test login:
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}'
```

---

## 🎯 Or Run All at Once

If you've set `DATABASE_URL` environment variable:

```bash
./scripts/setup-prisma.sh
```

This script:
1. Generates Prisma Client
2. Pushes schema to database
3. Creates default users

---

## ✅ What's Changed?

Your codebase now uses **Prisma ORM** instead of raw SQL:

- ✅ **Prisma Schema:** `prisma/schema.prisma` (defines all tables)
- ✅ **Prisma Client:** `src/server/db/prisma.js` (database connection)
- ✅ **Updated Auth:** `src/server/api/auth.js` (uses Prisma)
- ✅ **Updated Seed:** `src/server/seedUsers.js` (uses Prisma)
- ✅ **Legacy Support:** `src/server/db/index.js` (still supports old SQL queries)

---

## 🔍 View Your Database

Open Prisma Studio (visual database browser):

```bash
npx prisma studio
```

This opens a web interface at `http://localhost:5555` where you can:
- Browse all tables
- View and edit data
- See relationships

---

## 🚀 For Vercel Deployment

1. **Add DATABASE_URL to Vercel:**
   - Project → Settings → Environment Variables
   - Add `DATABASE_URL` with your Prisma connection string

2. **Deploy:**
   ```bash
   git add .
   git commit -m "Migrate to Prisma ORM"
   git push origin main
   ```

3. **After deployment:**
   - Vercel will run `prisma generate` automatically (in build script)
   - Run migrations: `npx prisma db push --skip-generate`

---

## ✅ Success Checklist

- [ ] DATABASE_URL set in `.env`
- [ ] Schema pushed (`npx prisma db push`)
- [ ] Prisma Client generated (`npx prisma generate`)
- [ ] Users created (`node src/server/seedUsers.js`)
- [ ] Server starts without errors
- [ ] Health check returns `"database": "connected"`
- [ ] Login works with Admin/Admin123

---

## 🎉 Done!

Your database is now using **Prisma ORM**! 

**Benefits:**
- ✅ Type-safe database queries
- ✅ Better error handling
- ✅ Automatic migrations
- ✅ Prisma Studio for database GUI
- ✅ Connection pooling
- ✅ Query optimization

Need help? See `PRISMA_MIGRATION.md` for detailed guide.

