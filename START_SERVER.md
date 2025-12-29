# 🚀 How to Start the Server

## Issue Fixed ✅

The error "Server error. Please try again later." was caused by **missing node modules**. This has been fixed by running `npm install`.

## Steps to Start the Server

### 1. Install Dependencies (if not already done)
```bash
npm install
```

### 2. Start Database (if not running)
The server needs PostgreSQL to be running. Start it with:

```bash
npm run dev:db
```

Or if using Docker Compose directly:
```bash
docker-compose up -d db
```

Wait a few seconds for the database to be ready.

### 3. Start the Backend Server
```bash
npm run start:server
```

You should see:
```
Server listening on port 4000
```

### 4. In a Separate Terminal, Start Frontend (if needed)
```bash
npm run dev
```

---

## Quick Start (All-in-One)

To start everything at once (database + backend + frontend):

```bash
npm run dev:all
```

This will:
- Start PostgreSQL database
- Create default admin user
- Start backend server
- Start frontend dev server

---

## Verify Server is Running

Check if the server is responding:

```bash
curl http://localhost:4000/api/health
```

Should return: `{"ok":true,"ts":"..."}`

---

## Default Login Credentials

After starting the server and creating users:

**Admin Account:**
- Username: `Admin`
- Password: `Admin123`

**Driver Account:**
- Username: `Driver1`
- Password: `Driver123`

To create users, run:
```bash
node src/server/seedUsers.js
```

---

## Troubleshooting

### "Cannot find module 'express'"
**Solution:** Run `npm install`

### "ECONNREFUSED" or database connection errors
**Solution:** Make sure PostgreSQL is running:
```bash
npm run dev:db
```

### Port 4000 already in use
**Solution:** 
- Find the process: `lsof -ti:4000`
- Kill it: `kill -9 $(lsof -ti:4000)`
- Or change PORT in `.env` file

### Server starts but login still fails
**Solution:** 
1. Verify server is running: `curl http://localhost:4000/api/health`
2. Check browser console for CORS errors
3. Make sure you're using the correct API endpoint (`/api/auth/login`)

---

## Environment Variables (Optional)

Create a `.env` file in the project root if you need to customize:

```env
PORT=4000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
JWT_SECRET=your-secret-key
```

---

## Next Steps

1. ✅ Dependencies installed (`npm install` - DONE)
2. Start database: `npm run dev:db`
3. Start server: `npm run start:server`
4. Create users: `node src/server/seedUsers.js`
5. Open browser: `http://localhost:5173`
6. Login with credentials above

