# ⚠️ DATABASE IS MANDATORY

## Important Notice

**This project REQUIRES PostgreSQL database. Database integration is mandatory.**

All system features require database connection:
- ✅ User authentication and management
- ✅ Driver management
- ✅ Delivery tracking
- ✅ Location tracking  
- ✅ Reports and analytics
- ✅ All API endpoints
- ✅ Data persistence

**There is NO "no database" option. Database is required.**

---

## Local Development

- Uses PostgreSQL in Docker
- Started automatically with `npm run dev`
- All data persists in database

---

## Production

- Requires PostgreSQL database
- Set `DATABASE_URL` environment variable
- Run migrations before use
- Create users in database

---

## Setup Required

1. **Database must be running** (Docker for local, PostgreSQL for production)
2. **DATABASE_URL must be set** (environment variable)
3. **Migrations must be run** (create tables)
4. **Users must be created** (in database)

**Without database, the system will NOT work.**

See `DATABASE_REQUIRED.md` for more details.

