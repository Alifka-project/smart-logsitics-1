"use strict";
/**
 * Database Connection - Using Prisma ORM
 * Database is REQUIRED - All queries use Prisma Client
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = exports.pool = exports.query = void 0;
const prisma_1 = __importDefault(require("./prisma"));
exports.prisma = prisma_1.default;
// Legacy compatibility wrapper for existing SQL queries
// For new code, use prisma directly (e.g., prisma.driver.findUnique())
const query = async (text, params) => {
    // Legacy SQL: return { rows } for compatibility with code that expects pg client shape
    try {
        if (!prisma_1.default)
            throw new Error('Prisma client not initialized');
        let result;
        if (params && params.length > 0) {
            result = await prisma_1.default.$queryRawUnsafe(text, ...params);
        }
        else {
            result = await prisma_1.default.$queryRawUnsafe(text);
        }
        const resultObj = result;
        const rows = Array.isArray(result) ? result : (resultObj && resultObj.rows ? resultObj.rows : []);
        return { rows };
    }
    catch (err) {
        console.error('Database query error:', err);
        throw err;
    }
};
exports.query = query;
exports.pool = null; // Not used with Prisma
