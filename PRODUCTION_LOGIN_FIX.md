# 📖 PRODUCTION LOGIN FIX - COMPREHENSIVE GUIDE

## Issue Summary

**Problem**: Server error (500) on login in production  
**Root Cause**: Missing DATABASE_URL validation + Poor error handling  
**Solution**: Environment validation + Granular error handling  

---

## Error Codes

### 503 Service Unavailable
**Cause**: Prisma client not initialized  
**Solution**: Ensure DATABASE_URL is set and database is accessible

### 503 Database Error
**Cause**: Database connection failed  
**Solution**: 
- Check DATABASE_URL is set in environment
- Verify database server is running
- Verify network connectivity from Vercel to database
- Check firewall/security group settings

### 500 Auth Error
**Cause**: Password comparison failed  
**Solution**:
- Check bcryptjs is installed
- Verify password hash format is correct
- Try resetting admin password

### 500 Session Error
**Cause**: Session creation failed  
**Solution**:
- Check session store configuration
- Verify session cookies are enabled
- Check memory/storage limits

### 500 Token Error
**Cause**: JWT token generation failed  
**Solution**:
- Ensure JWT_SECRET is set in environment
- Verify JWT_SECRET has sufficient entropy (>32 chars)
- Check jsonwebtoken package is installed

### 401 Invalid Credentials
**Cause**: Wrong username/password or user doesn't exist  
**Solution**:
- Verify username and password are correct
- Check if admin user exists in database
- Create admin user if it doesn't exist

### 403 Account Inactive
**Cause**: Account is disabled  
**Solution**:
- Activate user in database: UPDATE "Driver" SET active=true WHERE id='...'

---

## Database Verification

### Check if Admin User Exists
```sql
SELECT * FROM "Driver" WHERE username = 'Admin';
SELECT * FROM "Account" WHERE "driverId" = (SELECT id FROM "Driver" WHERE username = 'Admin');
```

### Create Admin User if Missing
```bash
# First get driver ID (or generate new UUID)
# Then create driver
INSERT INTO "Driver" (id, username, email, phone, "fullName", active, "createdAt")
VALUES ('...uuid...', 'Admin', 'admin@example.com', '+1234567890', 'Administrator', true, NOW());

# Generate password hash (use Node.js)
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('Admin123', 12).then(h => console.log(h));"

# Create account with hash
INSERT INTO "Account" ("driverId", "passwordHash", role, "createdAt")
VALUES ('...same-uuid...', '...bcrypt-hash...', 'admin', NOW());
```

---

## Environment Variable Setup

### Required Variables

**DATABASE_URL**
```
Format: postgresql://user:password@host:port/dbname
Example: postgresql://admin:pass123@db.example.com:5432/logistics
```

**JWT_SECRET**
```
Generate: openssl rand -base64 32
Min length: 32 characters
Example: aB3xK9mL2pQ7wE4rT6yU8iO5sD1fG9hJ/L2m3n4o5p6q7r8s9t
```

---

## Logging

### Check Vercel Logs
1. Go to https://vercel.com
2. Project → Deployments
3. Click latest deployment
4. View "Runtime Logs" or "Function Logs"
5. Search for "auth/login:" or "CRITICAL:"

### Log Message Examples

**Successful**:
```
✓ auth/login: Successful login for user Admin
```

**Database Error**:
```
✗ auth/login: Database query error: Connection refused
✗ auth/login: Database error code: P1001
```

**Missing Environment Variable**:
```
✗ CRITICAL: Required environment variable DATABASE_URL is missing
```

**Token Generation Error**:
```
✗ auth/login: Token generation error: JWT_SECRET is not set
```

---

## Testing Procedures

### 1. Health Check
```bash
curl https://your-app.vercel.app/api/health
```
Expected: `{"ok":true,"database":"connected","orm":"prisma"}`

### 2. Login Test
```bash
curl -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}'
```
Expected: Returns tokens and driver info

### 3. Invalid Credentials Test
```bash
curl -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"wrongpass"}'
```
Expected: `{"error":"invalid_credentials"}` with 401 status

---

## Performance Notes

- Login should complete in < 100ms with proper database
- If login takes > 1s, check database performance
- If 503 errors, database connection pool may be exhausted

---

## Security

- Error messages don't leak sensitive information
- Password hashes are never logged
- Database errors are caught before reaching client
- Account lockout prevents brute force attacks

---

## FAQ

**Q: Login works locally but fails in production**  
A: Environment variables not set in Vercel. Check Step 1 of deployment guide.

**Q: Getting "invalid_credentials" for correct password**  
A: Admin user doesn't exist or password hash is wrong. Create new admin user.

**Q: Getting "database_error" constantly**  
A: DATABASE_URL not set or database unreachable. Check Vercel environment variables.

**Q: Login page shows "Cannot connect to server"**  
A: CORS_ORIGINS not configured or API endpoint not accessible. Check CORS settings.

---

**Status**: Ready for Production  
**Last Updated**: January 19, 2026
