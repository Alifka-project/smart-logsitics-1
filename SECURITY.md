# Security Implementation Guide

## Overview

This document describes the comprehensive security measures implemented in the Dubai Logistics System authentication and session management.

## Security Features

### 1. Password Security

#### Password Requirements
- **Minimum Length**: 8 characters
- **Maximum Length**: 128 characters
- **Must Contain**:
  - At least one uppercase letter (A-Z)
  - At least one lowercase letter (a-z)
  - At least one number (0-9)
  - At least one special character (!@#$%^&*()_+-=[]{}|;':"\\,.<>/?)

#### Password Hashing
- **Algorithm**: bcrypt
- **Cost Factor**: 12 (increased from 10 for better security)
- **Storage**: Passwords are never stored in plain text

#### Password Validation
- Checks for common weak passwords
- Prevents repeated character patterns
- Validates password strength (0-5 scale)

### 2. Account Lockout Protection

#### Brute Force Prevention
- **Max Failed Attempts**: 5 attempts
- **Lockout Duration**: 30 minutes
- **Attempt Window**: 15 minutes
- **Automatic Cleanup**: Old lockout records are automatically removed

#### Implementation
- Failed login attempts are tracked per username
- Account is locked after 5 failed attempts
- Lockout status is checked before authentication
- Successful login clears lockout status

### 3. Rate Limiting

#### Login Endpoint
- **Window**: 15 minutes
- **Max Requests**: 5 attempts per window
- **Behavior**: Successful logins don't count toward limit
- **Response**: 429 status with retry information

#### General API
- **Window**: 1 minute
- **Max Requests**: 120 requests per minute

#### Strict Operations
- **Window**: 1 minute
- **Max Requests**: 10 requests per minute

### 4. Session Management

#### Session Security
- **Session ID**: 32-byte random hex string (256 bits)
- **Client Key**: 32-byte random hex string (256 bits)
- **CSRF Token**: 32-byte random hex string (256 bits)
- **Session Duration**: 12 hours
- **Inactivity Timeout**: 5 minutes (configurable)

#### Session Cookies
- **HttpOnly**: Yes (prevents JavaScript access)
- **Secure**: Yes in production (HTTPS only)
- **SameSite**: Strict (CSRF protection)
- **Path**: / (applies to entire site)

#### Session Fingerprinting
- **Components**: User-Agent, IP Address, Accept-Language
- **Algorithm**: SHA-256 hash
- **Purpose**: Detect session hijacking attempts
- **Behavior**: Session invalidated on fingerprint mismatch

#### Concurrent Sessions
- **Limit**: 5 sessions per user
- **Behavior**: Oldest session is removed when limit reached

### 5. CSRF Protection

#### Implementation
- CSRF token generated per session
- Token stored in session and sent to client
- Token required for all state-changing operations (POST, PUT, DELETE, PATCH)
- Token validated on server for each request

#### Token Storage
- Server-side: Stored in session
- Client-side: Stored in localStorage
- Transmission: Sent via `X-CSRF-Token` header

#### Exemptions
- GET, HEAD, OPTIONS requests (read-only)
- JWT-based authentication (tokens in Authorization header)

### 6. JWT Token System

#### Access Tokens
- **Lifetime**: 15 minutes
- **Purpose**: Short-lived authentication
- **Storage**: localStorage (for client-side access)
- **Transmission**: Authorization header (Bearer token)

#### Refresh Tokens
- **Lifetime**: 7 days
- **Purpose**: Long-lived token refresh
- **Storage**: HttpOnly cookie (server-side only)
- **Transmission**: Cookie (automatic)

#### Token Refresh Flow
1. Client detects token expiration (2 minutes before expiry)
2. Client sends refresh request with refresh token cookie
3. Server validates refresh token
4. Server issues new access token
5. Client updates stored access token

#### Token Rotation
- New tokens issued on refresh
- Old tokens invalidated
- Prevents token reuse attacks

### 7. Input Sanitization

#### Sanitization Rules
- Remove null bytes
- Trim whitespace
- Validate input types
- Prevent SQL injection (parameterized queries)

#### Implementation
- All user inputs are sanitized before processing
- Database queries use parameterized statements
- No direct string concatenation in SQL

### 8. Security Headers

#### Helmet.js Configuration
- **X-Content-Type-Options**: nosniff
- **X-Frame-Options**: DENY
- **X-XSS-Protection**: 1; mode=block
- **Strict-Transport-Security**: Enabled in production

#### Custom Headers
- **X-Powered-By**: Disabled (hides server technology)

### 9. CORS Configuration

#### Development
- Allows localhost and 127.0.0.1 from any port
- Permissive for local development

#### Production
- Restricted to configured origins
- No wildcard origins
- Credentials required

### 10. Error Handling

#### Security-Conscious Errors
- Generic error messages (prevent information leakage)
- No username enumeration
- No password hints
- Consistent error format

#### Error Codes
- `NO_SESSION`: No session found
- `SESSION_EXPIRED`: Session expired
- `CSRF_FAILED`: CSRF token validation failed
- `ACCOUNT_LOCKED`: Account locked due to failed attempts
- `INVALID_CREDENTIALS`: Invalid username or password

## Environment Variables

### Required
- `JWT_SECRET`: Secret key for JWT signing (minimum 32 characters)
- `JWT_REFRESH_SECRET`: Secret key for refresh tokens (minimum 32 characters)

### Optional
- `SESSION_COOKIE_NAME`: Session cookie name (default: 'sid')
- `REFRESH_COOKIE_NAME`: Refresh cookie name (default: 'rt')
- `SESSION_INACTIVITY_MS`: Inactivity timeout in milliseconds (default: 300000)
- `NODE_ENV`: Environment (development/production)
- `CORS_ORIGINS`: Comma-separated list of allowed origins
- `ENFORCE_HTTPS`: Set to '1' to enforce HTTPS

## Best Practices

### For Developers

1. **Never log sensitive data**
   - Don't log passwords, tokens, or session IDs
   - Use structured logging for debugging

2. **Use HTTPS in production**
   - Set `ENFORCE_HTTPS=1`
   - Ensure secure cookies are enabled

3. **Rotate secrets regularly**
   - Change JWT secrets periodically
   - Use strong, random secrets (32+ characters)

4. **Monitor failed login attempts**
   - Track lockout events
   - Alert on suspicious patterns

5. **Keep dependencies updated**
   - Regularly update security-related packages
   - Monitor security advisories

### For Deployment

1. **Set strong secrets**
   ```bash
   JWT_SECRET=$(openssl rand -hex 32)
   JWT_REFRESH_SECRET=$(openssl rand -hex 32)
   ```

2. **Enable HTTPS**
   - Use TLS 1.2 or higher
   - Configure proper certificate chain

3. **Configure CORS**
   - Set `CORS_ORIGINS` to your frontend domain
   - Don't use wildcards in production

4. **Use environment-specific configs**
   - Different secrets for dev/staging/prod
   - Restrict admin access in production

5. **Monitor and log**
   - Log authentication events
   - Monitor rate limit violations
   - Track session anomalies

## Security Checklist

- [x] Password hashing (bcrypt with cost 12)
- [x] Password strength validation
- [x] Account lockout mechanism
- [x] Rate limiting on login
- [x] CSRF protection
- [x] Secure session cookies
- [x] Session fingerprinting
- [x] JWT with short expiration
- [x] Refresh token mechanism
- [x] Input sanitization
- [x] SQL injection prevention
- [x] Security headers (Helmet)
- [x] CORS configuration
- [x] Error message sanitization
- [x] Concurrent session limits
- [x] Token rotation

## Cost-Free Implementation

All security features are implemented using:
- **Open-source libraries**: bcryptjs, jsonwebtoken, express-rate-limit
- **Built-in Node.js modules**: crypto, cookie
- **No external services**: All security logic runs on your server
- **No API keys required**: No third-party authentication services

## Future Enhancements

Potential improvements (not currently implemented):
- Two-factor authentication (2FA)
- Password history tracking
- Session management UI (view/revoke sessions)
- IP whitelisting for admin accounts
- Audit logging to database
- Redis-based session store (for horizontal scaling)

---

**Last Updated**: 2024
**Version**: 1.0.0

