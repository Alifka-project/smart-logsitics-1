# 🔄 Setup Prisma Database - Quick Guide

## ✅ Fast Setup Steps

### Step 1: Install Prisma (If Not Done)

```bash
cd dubai-logistics-system
npm install prisma @prisma/client --save
```

---

### Step 2: Set Database URL

**Add to `.env` file:**
```bash
DATABASE_URL="postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require"
```

**Or for Prisma Accelerate (faster):**
```bash
DATABASE_URL="prisma+postgres://accelerate.prisma-data.net/?api_key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqd3RfaWQiOjEsInNlY3VyZV9rZXkiOiJza19heXhXTTNIVHBoTlVtSWhFVVl2X18iLCJhcGlfa2V5IjoiMDFLRE5EWkZLMlBIQjFDRVFTWTI0RkZHS1EiLCJ0ZW5hbnRfaWQiOiI2YTgxZWZhZjc0ZjRhMTE3YTJiZDY0ZmQ0M2FmOWFhZTVhZDUyMDk2MjhhYmUzMTNkYzkzOTMzZTQ2OGUyYTY0IiwiaW50ZXJuYWxfc2VjcmV0IjoiMjY5N2I0MTgtNjY3My00MTliLTg0MGItMmY5OTY0MjFjZGY4In0.NLASl9RPSF7AfCrAhF1PZ4XvRZ9eA5Oh4mQZKXgcynQ"
```

---

### Step 3: Create Tables in Database

```bash
# Push schema to database (creates all tables)
npx prisma db push
```

This will:
- Create all tables in your Prisma database
- Use the schema defined in `prisma/schema.prisma`

---

### Step 4: Generate Prisma Client

```bash
npx prisma generate
```

This creates the Prisma Client code for your TypeScript/JavaScript code.

---

### Step 5: Create Users

```bash
node src/server/seedUsers.js
```

Creates:
- Admin: `Admin` / `Admin123`
- Driver: `Driver1` / `Driver123`

---

### Step 6: Test

```bash
# Start server
npm run start:server

# Test health
curl http://localhost:4000/api/health

# Test login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}'
```

---

## 🚀 For Vercel Deployment

1. **Add DATABASE_URL to Vercel:**
   - Project → Settings → Environment Variables
   - Add `DATABASE_URL` with your Prisma connection string

2. **Redeploy:**
   - Push code to GitHub
   - Vercel will auto-deploy
   - Build script includes `prisma generate`

3. **Run migrations on production:**
   ```bash
   npx prisma db push --skip-generate
   ```

---

## ✅ Done!

Your database is now using Prisma! 🎉

See `PRISMA_MIGRATION.md` for detailed guide.

