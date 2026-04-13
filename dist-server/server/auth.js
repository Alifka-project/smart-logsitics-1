"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rotateSession = exports.destroyUserSessions = void 0;
exports.hashPassword = hashPassword;
exports.comparePassword = comparePassword;
exports.generateAccessToken = generateAccessToken;
exports.generateRefreshToken = generateRefreshToken;
exports.verifyAccessToken = verifyAccessToken;
exports.verifyRefreshToken = verifyRefreshToken;
exports.authenticate = authenticate;
exports.requireCSRF = requireCSRF;
exports.requireRole = requireRole;
exports.requireAnyRole = requireAnyRole;
exports.createLoginSession = createLoginSession;
exports.clearLoginSession = clearLoginSession;
exports.refreshAccessToken = refreshAccessToken;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const cookie = __importStar(require("cookie"));
const sessionStore_1 = require("./sessionStore");
Object.defineProperty(exports, "rotateSession", { enumerable: true, get: function () { return sessionStore_1.rotateSession; } });
Object.defineProperty(exports, "destroyUserSessions", { enumerable: true, get: function () { return sessionStore_1.destroyUserSessions; } });
// In production, JWT secrets MUST be explicitly set — no fallback allowed.
if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        throw new Error('FATAL: JWT_SECRET must be set to a string of at least 32 characters in production');
    }
    if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
        throw new Error('FATAL: JWT_REFRESH_SECRET must be set to a string of at least 32 characters in production');
    }
}
const JWT_SECRET = process.env.JWT_SECRET || (() => {
    console.warn('⚠️  WARNING: JWT_SECRET not set — using insecure dev default. NEVER deploy this to production!');
    return 'dev-secret-INSECURE-change-me-in-production-' + Math.random().toString(36);
})();
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (() => {
    console.warn('⚠️  WARNING: JWT_REFRESH_SECRET not set — using insecure dev default. NEVER deploy this to production!');
    return 'dev-refresh-INSECURE-change-me-in-production-' + Math.random().toString(36);
})();
const ACCESS_TOKEN_EXP = '1h'; // Access token - increased for serverless cold starts
const REFRESH_TOKEN_EXP = '7d'; // Longer-lived refresh token
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'sid';
const REFRESH_COOKIE = process.env.REFRESH_COOKIE_NAME || 'rt';
// Password hashing with bcrypt (cost factor 12 for better security)
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, 12); // Increased from 10 to 12
}
async function comparePassword(password, hash) {
    return bcryptjs_1.default.compare(password, hash);
}
// Generate short-lived access token
function generateAccessToken(payload) {
    return jsonwebtoken_1.default.sign({
        ...payload,
        type: 'access',
        iat: Math.floor(Date.now() / 1000)
    }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXP });
}
// Generate long-lived refresh token
function generateRefreshToken(payload) {
    return jsonwebtoken_1.default.sign({
        ...payload,
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000)
    }, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXP });
}
// Verify access token
function verifyAccessToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        if (decoded.type !== 'access') {
            throw new Error('Invalid token type');
        }
        return decoded;
    }
    catch (err) {
        return null;
    }
}
// Verify refresh token
function verifyRefreshToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, REFRESH_SECRET);
        if (decoded.type !== 'refresh') {
            throw new Error('Invalid token type');
        }
        return decoded;
    }
    catch (err) {
        return null;
    }
}
// Create secure login session with both cookies and tokens
function createLoginSession(req, res, payload) {
    const { id: sid, clientKey, csrfToken } = (0, sessionStore_1.createSession)(req, payload);
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
        httpOnly: true,
        secure: isProduction, // Only send over HTTPS in production
        sameSite: (isProduction ? 'none' : 'lax'),
        path: '/',
        maxAge: 12 * 3600, // 12 hours in seconds
    };
    // Set session cookie
    res.setHeader('Set-Cookie', [
        cookie.serialize(SESSION_COOKIE, sid, cookieOptions),
        // Also set refresh token as HttpOnly cookie
        cookie.serialize(REFRESH_COOKIE, generateRefreshToken(payload), {
            ...cookieOptions,
            maxAge: 7 * 24 * 3600 // 7 days
        })
    ]);
    return { clientKey, csrfToken };
}
function clearLoginSession(res, sessionId = null) {
    if (sessionId) {
        (0, sessionStore_1.destroySession)(sessionId);
    }
    const isProduction = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', [
        cookie.serialize(SESSION_COOKIE, '', {
            httpOnly: true,
            secure: isProduction,
            sameSite: (isProduction ? 'none' : 'lax'),
            path: '/',
            maxAge: 0
        }),
        cookie.serialize(REFRESH_COOKIE, '', {
            httpOnly: true,
            secure: isProduction,
            sameSite: (isProduction ? 'none' : 'lax'),
            path: '/',
            maxAge: 0
        })
    ]);
}
// Enhanced authentication middleware with CSRF protection for state-changing operations
function authenticate(req, res, next) {
    // First try Authorization header (JWT access token)
    const authHeader = req.headers.authorization || '';
    const parts = authHeader.split(' ');
    // Do not log authorization headers — tokens must not appear in any log stream.
    if (parts.length === 2 && parts[0] === 'Bearer') {
        const token = parts[1];
        const decoded = verifyAccessToken(token);
        if (decoded) {
            console.log(`[Auth] ✓ Valid JWT token for user: ${decoded.sub}`);
            req.user = decoded;
            req.authMethod = 'jwt';
            return next();
        }
        else {
            console.log(`[Auth] ✗ Invalid/expired JWT token`);
        }
    }
    // Fallback to session cookie
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie || '') : {};
    const sid = cookies[SESSION_COOKIE];
    if (!sid) {
        console.log(`[Auth] ✗ No session cookie found`);
        res.status(401).json({ error: 'unauthorized', code: 'NO_SESSION' });
        return;
    }
    console.log(`[Auth] Checking session: ${sid.substring(0, 20)}...`);
    const sessionData = (0, sessionStore_1.getSession)(req, sid);
    if (!sessionData) {
        console.log(`[Auth] ✗ Session not found or expired`);
        res.status(401).json({ error: 'invalid_session', code: 'SESSION_EXPIRED' });
        return;
    }
    console.log(`[Auth] ✓ Valid session for user: ${sessionData.payload.sub}`);
    req.user = sessionData.payload;
    req.sessionId = sid;
    req.csrfToken = sessionData.csrfToken;
    req.authMethod = 'session';
    return next();
}
// CSRF protection middleware for state-changing operations (POST, PUT, DELETE, PATCH)
function requireCSRF(req, res, next) {
    // Skip CSRF for GET, HEAD, OPTIONS
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    if (req.authMethod === 'jwt') {
        // JWT tokens don't need CSRF (they're in Authorization header)
        return next();
    }
    if (req.authMethod === 'session' && req.sessionId) {
        if ((0, sessionStore_1.verifyCSRF)(req, req.sessionId)) {
            return next();
        }
    }
    res.status(403).json({ error: 'csrf_token_required', code: 'CSRF_FAILED' });
}
function requireRole(role) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: 'unauthorized', code: 'NO_USER' });
            return;
        }
        if (req.user.role !== role) {
            res.status(403).json({ error: 'forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
            return;
        }
        return next();
    };
}
// Helper to require any of the specified roles
function requireAnyRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: 'unauthorized', code: 'NO_USER' });
            return;
        }
        const account = req.user.account;
        const userRole = (account?.role || req.user.role);
        if (!userRole || !roles.includes(userRole)) {
            console.log(`[Auth] User role "${userRole}" not in allowed roles:`, roles);
            res.status(403).json({ error: 'forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
            return;
        }
        return next();
    };
}
// Refresh access token using refresh token
function refreshAccessToken(req, res) {
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie || '') : {};
    const refreshToken = cookies[REFRESH_COOKIE];
    if (!refreshToken) {
        res.status(401).json({ error: 'no_refresh_token', code: 'NO_REFRESH_TOKEN' });
        return;
    }
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
        res.status(401).json({ error: 'invalid_refresh_token', code: 'INVALID_REFRESH_TOKEN' });
        return;
    }
    // Generate new access token
    const newPayload = {
        sub: decoded.sub,
        role: decoded.role,
        username: decoded.username
    };
    const newAccessToken = generateAccessToken(newPayload);
    res.json({
        accessToken: newAccessToken,
        expiresIn: 60 * 60 // 1 hour in seconds
    });
}
