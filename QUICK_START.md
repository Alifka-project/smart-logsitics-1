# 🚀 Quick Start Guide

## ⚠️ Important: Correct Directory

Make sure you're in the **`dubai-logistics-system`** directory, not the parent `Logistics-system` directory!

```bash
cd /Users/Alifka_Roosseo/Desktop/Project/Logistics-system/dubai-logistics-system
```

## ⚠️ Prerequisites: Docker Must Be Running

**Before starting, make sure Docker Desktop is running!**

1. Open **Docker Desktop** application on your Mac
2. Wait for it to fully start (menu bar icon turns green)
3. Verify: Run `docker ps` - should not show an error

If Docker is not running, you'll get this error:
```
Cannot connect to the Docker daemon. Is the docker daemon running?
```

**Solution:** Start Docker Desktop, then try again.

## 📋 Step-by-Step Setup

### 1. Navigate to Correct Directory
```bash
cd dubai-logistics-system
```

### 2. Install Dependencies (if not done)
```bash
npm install
```

### 3. Start Everything (Recommended)
```bash
npm run dev:all
```

This single command will:
- ✅ Start PostgreSQL database
- ✅ Create default admin user
- ✅ Start backend server (port 4000)
- ✅ Start frontend dev server (port 5173)

### 4. Or Start Manually (Step by Step)

**Terminal 1 - Start Database:**
```bash
cd dubai-logistics-system
npm run dev:db
```

**Terminal 2 - Start Backend:**
```bash
cd dubai-logistics-system
npm run start:server
```

**Terminal 3 - Start Frontend:**
```bash
cd dubai-logistics-system
npm run dev
```

**Terminal 4 - Create Users (one-time):**
```bash
cd dubai-logistics-system
node src/server/seedUsers.js
```

## 🔐 Login Credentials

After running `node src/server/seedUsers.js`:

**Admin:**
- Username: `Admin`
- Password: `Admin123`

**Driver:**
- Username: `Driver1`
- Password: `Driver123`

## 🌐 Access URLs

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:4000
- **Health Check:** http://localhost:4000/api/health

## 🐛 Troubleshooting

### "Cannot find package.json"
**Problem:** You're in the wrong directory  
**Solution:** `cd dubai-logistics-system`

### "Cannot find module"
**Problem:** Dependencies not installed  
**Solution:** `npm install`

### "ECONNREFUSED" or Database errors
**Problem:** Database not running  
**Solution:** `npm run dev:db`

### Port already in use
**Problem:** Port 4000 or 5173 already in use  
**Solution:** 
```bash
# Kill process on port 4000
kill -9 $(lsof -ti:4000)

# Kill process on port 5173
kill -9 $(lsof -ti:5173)
```

## ✅ Verify Everything is Running

1. **Check Database:**
   ```bash
   pg_isready -h localhost -p 5432
   ```

2. **Check Backend:**
   ```bash
   curl http://localhost:4000/api/health
   ```
   Should return: `{"ok":true,"ts":"..."}`

3. **Check Frontend:**
   Open browser: http://localhost:5173

## 📝 Directory Structure

```
Logistics-system/
└── dubai-logistics-system/    ← YOU MUST BE HERE!
    ├── package.json           ← npm commands work here
    ├── src/
    ├── scripts/
    └── ...
```

## 🎯 Common Commands Cheat Sheet

```bash
# Always start here
cd dubai-logistics-system

# Start everything
npm run dev:all

# Or separately
npm run dev:db          # Database
npm run start:server    # Backend
npm run dev             # Frontend
node src/server/seedUsers.js  # Create users
```

