# Debug 500 Error on Login

## Quick Debug Steps

1. Check Vercel Logs:
   - Dashboard → Project → Logs tab
   - Try login, then check logs for error message

2. Test Health Endpoint:
   ```bash
   curl https://smart-logsitics-1.vercel.app/api/health
   ```

3. Most Likely: Database tables don't exist!
   Need to run migrations:
   ```bash
   export DATABASE_URL="your_connection_string"
   npx prisma db push
   node src/server/seedUsers.js
   ```

