# 🐳 Docker Setup Guide

## Issue: Docker Not Running

The error you're seeing:
```
Cannot connect to the Docker daemon at unix:///Users/Alifka_Roosseo/.docker/run/docker.sock
Is the docker daemon running?
```

**Solution:** Start Docker Desktop application.

---

## 🚀 Quick Fix

### Step 1: Start Docker Desktop

1. **Open Docker Desktop application** on your Mac
2. Wait for Docker to fully start (you'll see the Docker icon in the menu bar turn green)
3. You can verify it's running by checking the menu bar icon or running:
   ```bash
   docker ps
   ```

### Step 2: Start the Application

Once Docker is running:

```bash
cd dubai-logistics-system
npm run dev:all
```

---

## 📋 Alternative: Use Local PostgreSQL (No Docker Required)

If you prefer not to use Docker, you can install PostgreSQL locally:

### Install PostgreSQL on macOS

**Option 1: Using Homebrew (Recommended)**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Option 2: Download from Official Site**
- Visit: https://www.postgresql.org/download/macosx/
- Download and install PostgreSQL 15

### Configure Local Database

1. **Create database:**
   ```bash
   createdb postgres
   ```

2. **Set environment variable (optional):**
   ```bash
   export DATABASE_URL=postgres://$(whoami)@localhost:5432/postgres
   ```

3. **Run migrations:**
   ```bash
   psql postgres -f db/migrations/001_create_drivers_and_locations.sql
   ```

4. **Start server:**
   ```bash
   npm run start:server
   ```

---

## ✅ Verify Docker is Running

Check if Docker is running:

```bash
docker ps
```

Should show:
```
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS   PORTS   NAMES
```

If you see an error, Docker is not running.

---

## 🔧 Troubleshooting

### Docker Desktop Won't Start

1. **Check if Docker Desktop is installed:**
   ```bash
   which docker
   ```

2. **If not installed, download from:**
   - https://www.docker.com/products/docker-desktop/

3. **If installed but not starting:**
   - Restart your Mac
   - Check Docker Desktop logs
   - Make sure you have enough disk space

### Docker Permission Issues

If you see permission errors:

```bash
# Add your user to docker group (Linux)
sudo usermod -aG docker $USER

# Or on macOS, just make sure Docker Desktop is running
```

### Port Already in Use

If port 5432 is already in use:

1. **Check what's using it:**
   ```bash
   lsof -i :5432
   ```

2. **Stop the process or change Docker port:**
   ```yaml
   # In docker-compose.yml, change:
   ports:
     - "5433:5432"  # Use 5433 instead of 5432
   ```

---

## 📝 Summary

**Quick Solution:**
1. ✅ Start Docker Desktop
2. ✅ Wait for it to be ready (menu bar icon turns green)
3. ✅ Run `npm run dev:all`

**Or use local PostgreSQL:**
1. ✅ Install PostgreSQL locally
2. ✅ Create database
3. ✅ Run migrations
4. ✅ Start server with `npm run start:server`

---

## 🎯 Recommended: Use Docker

Docker is the easiest option because it:
- ✅ Handles all database setup automatically
- ✅ Works the same on all systems
- ✅ No need to install PostgreSQL manually
- ✅ Easy to reset/clean up

Just make sure Docker Desktop is running before you start!

