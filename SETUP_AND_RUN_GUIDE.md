# Setup and Run Guide - Smart Logistics System

## Prerequisites
- Docker and Docker Compose installed
- Node.js 16+ and npm
- Git

## Quick Start (5 minutes)

### 1. Start PostgreSQL Database
```bash
docker-compose up -d
```
This starts a PostgreSQL database on `localhost:5432`.

### 2. Configure Environment
The `.env` file is already configured with:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/logistics_db
JWT_SECRET=devsecret123
NODE_ENV=development
PORT=4000
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Setup Database Schema
```bash
npx prisma db push
```

### 5. Create Default Users
```bash
node /tmp/create_users.js
```
Or manually using the Node REPL script. This creates:
- **Admin User**: `admin` / `admin123`
- **Driver User**: `driver1` / `driver123`

### 6. Start Backend Server
```bash
npm run start:server
```
Server will start on `http://localhost:4000`

### 7. Start Frontend (in another terminal)
```bash
npm run dev:frontend
```
Frontend will run on `http://localhost:5173`

---

## Testing the Login

### Using the UI
1. Open `http://localhost:5173/login` in your browser
2. Enter credentials:
   - Username: `admin`
   - Password: `admin123`
3. Click "Sign in"

### Using API (cURL)
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

Expected response:
```json
{
  "driver": {
    "id": "82dfc39d-3a8b-44e4-8f2e-cf1d25f317c7",
    "username": "admin",
    "full_name": "System Administrator",
    "role": "admin"
  },
  "clientKey": "...",
  "csrfToken": "...",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900
}
```

---

## Common Issues & Solutions

### ❌ "Server error. Please try again later."
**Cause**: Database not connected  
**Solution**: 
```bash
docker-compose up -d  # Start database
npx prisma db push   # Sync schema
```

### ❌ "Database connection failed"
**Cause**: DATABASE_URL not set  
**Solution**: Check `.env` file has:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/logistics_db
```

### ❌ "Invalid credentials"
**Cause**: User doesn't exist or wrong password  
**Solution**: Create default users:
```bash
node /tmp/create_users.js
```

### ❌ Port 4000 already in use
**Solution**: Kill the process using it:
```bash
lsof -ti:4000 | xargs kill -9
```

### ❌ Docker PostgreSQL not starting
**Solution**: 
```bash
docker-compose down
docker volume rm smart-logsitics-1_db-data  # Remove old data
docker-compose up -d
```

---

## Architecture

### Backend (Node.js + Express)
- **Port**: 4000
- **Database**: PostgreSQL (Prisma ORM)
- **Authentication**: JWT + Session Cookies
- **Security**: Rate limiting, Account lockout, CSRF protection

### Frontend (React + Vite)
- **Port**: 5173
- **State Management**: Zustand
- **Routing**: React Router v7

### Key Files
- `src/server/api/auth.js` - Authentication API endpoints
- `src/server/auth.js` - Token & session management
- `src/server/db/prisma.js` - Database client
- `prisma/schema.prisma` - Database schema

---

## Database Schema

### Tables
- `drivers` - Driver profiles
- `accounts` - Login credentials & roles
- `deliveries` - Delivery records
- `locations` - GPS tracking data
- `messages` - Communication logs

---

## Security Features

✅ **Password Hashing**: bcrypt with cost factor 12  
✅ **JWT Tokens**: Short-lived access tokens (15 min)  
✅ **Session Management**: Server-side sessions with CSRF tokens  
✅ **Rate Limiting**: 5 login attempts per 15 minutes  
✅ **Account Lockout**: Automatic after 5 failed attempts  
✅ **CORS Protection**: Configurable allowed origins  
✅ **Helmet**: Security headers (CSP, X-Frame-Options, etc.)  

---

## Development Commands

```bash
# Run everything
npm run dev:all

# Just backend
npm run start:server

# Just frontend
npm run dev:frontend

# Database operations
npx prisma studio          # GUI for database
npx prisma db push         # Sync schema changes
npx prisma migrate reset   # Reset database

# Linting
npm run lint

# Build for production
npm build
```

---

## Production Deployment

1. Set environment variables in your hosting platform:
   ```
   DATABASE_URL=postgresql://...
   JWT_SECRET=<strong-random-secret>
   JWT_REFRESH_SECRET=<strong-random-secret>
   NODE_ENV=production
   ENFORCE_HTTPS=1
   CORS_ORIGINS=https://yourdomain.com
   ```

2. Build frontend:
   ```bash
   npm run build
   ```

3. Start server:
   ```bash
   npm run start:server
   ```

---

## Support

For issues or questions, check:
- `TROUBLESHOOTING.md` - Common problems
- `DEBUG_LOGIN_500.md` - Login-specific debugging
- `DEPLOYMENT_CHECKLIST.md` - Production deployment steps
