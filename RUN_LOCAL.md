# 🚀 How to Run Locally - Database Required

## ⚠️ IMPORTANT: Database is MANDATORY

This system **REQUIRES PostgreSQL database**. There is no "no database" option.
All features require database integration.

## ✅ Setup - Just Run:

```bash
npm run dev
```

This single command will automatically:
- ✅ Check Docker is running
- ✅ Start PostgreSQL database in Docker
- ✅ Create users in database (if needed)
- ✅ Start backend server (connected to database)
- ✅ Start frontend dev server

Everything in one terminal window! 🎉

---

## 📋 Prerequisites

1. **Docker Desktop** must be installed and running
   - Open Docker Desktop application
   - Wait for it to start (menu bar icon turns green)

2. **Node.js** installed (v16 or higher)

---

## 🎯 Usage

### Start Everything:
```bash
cd dubai-logistics-system
npm run dev
```

### Stop Everything:
Press `Ctrl + C` in the terminal

This automatically stops:
- Frontend server
- Backend server
- Database container

---

## 🌐 Access URLs

Once running:
- **Frontend:** http://localhost:5173
- **Backend:** http://localhost:4000
- **Database:** localhost:5432 (via Docker)

---

## 🔐 Login Credentials

**Admin:**
- Username: `Admin`
- Password: `Admin123`

**Driver:**
- Username: `Driver1`
- Password: `Driver123`

---

## 🐛 Troubleshooting

### "Docker is not running"
**Problem:** Docker Desktop is not running  
**Solution:** 
1. Open Docker Desktop application
2. Wait for it to start (menu bar icon turns green)
3. Run `npm run dev` again

### "Port 4000 already in use"
**Solution:**
```bash
lsof -ti:4000 | xargs kill -9
npm run dev
```

### "Port 5173 already in use"
**Solution:**
```bash
lsof -ti:5173 | xargs kill -9
npm run dev
```

### Database connection errors
**Solution:**
- Make sure Docker Desktop is running
- Wait a bit longer for database to be ready
- The script will wait automatically

---

## 📝 What the Script Does

1. ✅ **Checks Docker** - Verifies Docker Desktop is running
2. ✅ **Starts Database** - Starts PostgreSQL in Docker container
3. ✅ **Waits for DB** - Ensures database is ready (up to 30 seconds)
4. ✅ **Creates Users** - Creates Admin/Driver users (if they don't exist)
5. ✅ **Starts Backend** - Starts secure server on port 4000
6. ✅ **Starts Frontend** - Starts Vite dev server on port 5173

All in the correct order, automatically!

---

## 🎉 Benefits

✅ **One command** - `npm run dev` does everything  
✅ **Automatic** - No manual steps needed  
✅ **Docker-based** - Uses proper PostgreSQL database  
✅ **Clean shutdown** - Ctrl+C stops everything  
✅ **Full features** - All database features work  

---

## 💡 Tips

- Keep Docker Desktop running while developing
- First run may take longer (database setup)
- Subsequent runs are faster
- All logs appear in the same terminal
- Press Ctrl+C to stop everything cleanly

---

## 🔄 Other Commands (If Needed)

If you want to run things separately:

```bash
# Just frontend
npm run dev:frontend

# Just backend
npm run start:server

# Just database
npm run dev:db
```

But for local development, **just use `npm run dev`**! 🚀

