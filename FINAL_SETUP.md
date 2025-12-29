# 🚀 FINAL SETUP - Complete Working Solution

## ⚠️ CRITICAL: Docker Must Be Running First!

**Before you do ANYTHING, you MUST start Docker Desktop!**

1. **Open Docker Desktop** application on your Mac
2. **Wait** for it to fully start (menu bar icon turns green - takes 10-30 seconds)
3. **Verify** it's running: Open Terminal and run:
   ```bash
   docker ps
   ```
   If this works (shows a table), Docker is ready. If you get an error, Docker is NOT running.

---

## ✅ Step-by-Step (Do This Exact Order)

### Step 1: Start Docker Desktop
- Open Docker Desktop app
- Wait until menu bar icon shows it's running

### Step 2: Open Terminal and Navigate
```bash
cd /Users/Alifka_Roosseo/Desktop/Project/Logistics-system/dubai-logistics-system
```

### Step 3: Start Database
```bash
npm run dev:db
```
Wait 10 seconds for database to start.

### Step 4: Create Users (ONE TIME ONLY)
```bash
node src/server/seedUsers.js
```
You should see messages about creating users.

### Step 5: Start Backend Server
```bash
npm run start:server
```
You should see: `Server listening on port 4000`

**Keep this terminal open!** The server needs to keep running.

### Step 6: Open NEW Terminal Window - Start Frontend
In a **NEW terminal window**:
```bash
cd /Users/Alifka_Roosseo/Desktop/Project/Logistics-system/dubai-logistics-system
npm run dev
```
You should see: `Local: http://localhost:5173/`

### Step 7: Open Browser and Login
1. Open: http://localhost:5173
2. Login with:
   - **Username:** `Admin`
   - **Password:** `Admin123`

---

## 🔧 If Something Goes Wrong

### "Cannot connect to Docker daemon"
**Problem:** Docker Desktop is not running  
**Solution:** Start Docker Desktop, wait for it to be ready, then try again

### "ECONNREFUSED" or "Database connection error"
**Problem:** Database is not running  
**Solution:** 
```bash
npm run dev:db
# Wait 10 seconds, then try again
```

### "Port 4000 already in use"
**Problem:** Server is already running  
**Solution:**
```bash
lsof -ti:4000 | xargs kill -9
# Then start server again
npm run start:server
```

### "Cannot find module"
**Problem:** Dependencies not installed  
**Solution:**
```bash
npm install
```

### Server crashes on startup
**Problem:** Code error  
**Solution:** The code has been fixed. Make sure you're using the latest code.

---

## ✅ Verification Checklist

Before trying to login, verify:

- [ ] Docker Desktop is running (check menu bar)
- [ ] Database is running: `docker ps` shows postgres container
- [ ] Backend server is running: `curl http://localhost:4000/api/health` returns `{"ok":true}`
- [ ] Frontend is running: Browser shows login page at http://localhost:5173

---

## 🎯 Quick Test Command

Test if backend is working:
```bash
curl http://localhost:4000/api/health
```

Should return: `{"ok":true,"ts":"2024-..."}`

Test if login works:
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}'
```

Should return JSON with `accessToken`, `driver`, etc.

---

## 📝 Summary

**The ONE thing you must do first:**
1. ✅ **Start Docker Desktop** and wait for it to be ready

**Then follow these steps in order:**
1. ✅ `npm run dev:db` (start database)
2. ✅ `node src/server/seedUsers.js` (create users - one time)
3. ✅ `npm run start:server` (start backend - keep running)
4. ✅ `npm run dev` (start frontend - in new terminal)
5. ✅ Open browser: http://localhost:5173
6. ✅ Login: Admin / Admin123

**That's it!** 🎉

