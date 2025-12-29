# 🐳 Start Docker - Quick Guide

## ⚠️ Error You're Seeing

```
Cannot connect to the Docker daemon at unix:///Users/Alifka_Roosseo/.docker/run/docker.sock
Is the docker daemon running?
```

**This means Docker Desktop is not running!**

---

## ✅ Quick Fix (3 Steps)

### Step 1: Open Docker Desktop
1. Open **Docker Desktop** application on your Mac
   - Look for it in Applications folder
   - Or use Spotlight: Press `Cmd + Space`, type "Docker", press Enter

### Step 2: Wait for Docker to Start
- Wait until the Docker icon in your menu bar (top right) shows it's running
- You'll see a green indicator or whale icon when it's ready
- This usually takes 10-30 seconds

### Step 3: Verify Docker is Running
```bash
docker ps
```

Should show:
```
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS   PORTS   NAMES
```

**NOT** an error message!

---

## 🚀 Then Start Your Application

Once Docker is running:

```bash
cd dubai-logistics-system
npm run dev:all
```

---

## 🔍 How to Check Docker Status

### Check if Docker Desktop is installed:
```bash
which docker
```

### Check if Docker is running:
```bash
docker ps
```

### Check Docker Desktop status:
- Look at the menu bar icon (top right of your Mac screen)
- If you see a whale icon, Docker is running
- Click it to see status

---

## 📥 Don't Have Docker Desktop?

### Download Docker Desktop for Mac:
1. Visit: https://www.docker.com/products/docker-desktop/
2. Download Docker Desktop for Mac
3. Install it (drag to Applications folder)
4. Open Docker Desktop
5. Wait for it to start
6. Then run `npm run dev:all`

---

## 🔄 Alternative: Use Local PostgreSQL (No Docker)

If you don't want to use Docker, you can install PostgreSQL locally:

```bash
# Install PostgreSQL
brew install postgresql@15

# Start PostgreSQL service
brew services start postgresql@15

# Create database
createdb postgres

# Run migrations
psql postgres -f db/migrations/001_create_drivers_and_locations.sql

# Start server (without docker)
npm run start:server
```

---

## ✅ Summary

**Problem:** Docker is not running  
**Solution:** Start Docker Desktop application  
**Then:** Run `npm run dev:all`

That's it! 🎉

