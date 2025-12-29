# Default Login Credentials

## 🔐 Admin Account
- **Username:** `admin`
- **Password:** `adminpass` (from seedAdmin.js)
- **Role:** Administrator
- **Access:** Full access to all features, dashboard, reports, driver tracking, delivery tracking

## 🚗 Driver Account  
Note: Driver account needs to be created. Use the credentials below after running the setup.

---

## ⚠️ Important Security Notes

1. **Change passwords immediately after first login!**
2. These are default accounts for development/testing purposes only
3. For production, create custom accounts with strong passwords
4. Never use these default credentials in production environments

---

## 📝 How to Create/Setup Default Users

### Option 1: Using the dev-all script (Recommended)
This will automatically create the admin user:

```bash
npm run dev:all
```

### Option 2: Manual Setup

1. **Start the database:**
   ```bash
   npm run dev:db
   ```

2. **Create admin user:**
   ```bash
   node src/server/seedAdmin.js
   ```
   This creates:
   - Username: `admin`
   - Password: `adminpass` (or check environment variable ADMIN_PASS)

3. **Create driver user (optional):**
   ```bash
   node src/server/seedUsers.js
   ```
   This creates:
   - Username: `Admin` (or ADMIN_USER env var)
   - Password: `Admin123` (or ADMIN_PASS env var)
   - Username: `Driver1` (or DRIVER_USER env var)
   - Password: `Driver123` (or DRIVER_PASS env var)

### Option 3: Using Environment Variables

You can customize the default accounts by setting these environment variables:

```bash
export ADMIN_USER=admin
export ADMIN_PASS=admin123
export ADMIN_EMAIL=admin@dubailogistics.com

export DRIVER_USER=driver1
export DRIVER_PASS=driver123
```

Then run:
```bash
node src/server/seedUsers.js
```

---

## 🔧 Creating Additional Users via API

You can create additional users through the registration API:

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser",
    "password": "SecurePass123!",
    "email": "user@example.com",
    "full_name": "New User"
  }'
```

**Note:** Password requirements:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

---

## 📞 Quick Reference

**Default Admin Credentials (from seedAdmin.js):**
- Username: `admin`
- Password: `adminpass`

**Default Credentials (from seedUsers.js):**
- Admin Username: `Admin`
- Admin Password: `Admin123`
- Driver Username: `Driver1`
- Driver Password: `Driver123`

---

## 🔍 Verify Users Exist

To check if users exist in the database:

```bash
# Connect to PostgreSQL
psql -U postgres -d postgres

# Check drivers
SELECT username, email, full_name FROM drivers;

# Check driver accounts with roles
SELECT d.username, da.role 
FROM drivers d 
JOIN driver_accounts da ON d.id = da.driver_id;
```
