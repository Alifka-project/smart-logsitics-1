"use strict";
/**
 * Seed default users using Prisma
 * Database is REQUIRED - Uses Prisma ORM
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_js_1 = __importDefault(require("./db/prisma.js"));
const auth_js_1 = require("./auth.js");
async function ensureUser(username, password, role, email, fullName) {
    try {
        const existing = await prisma_js_1.default.driver.findUnique({
            where: { username },
            include: { account: true }
        });
        if (existing) {
            console.log(`User ${username} already exists`);
            return;
        }
        const passwordHash = await (0, auth_js_1.hashPassword)(password);
        await prisma_js_1.default.$transaction(async (tx) => {
            const driver = await tx.driver.create({
                data: {
                    username,
                    email: email || null,
                    fullName: fullName || username,
                    account: {
                        create: {
                            passwordHash,
                            role,
                        }
                    }
                }
            });
            console.log(`Seeded user ${username} with role ${role}`);
            return driver;
        });
    }
    catch (err) {
        console.error('ensureUser error', err);
        throw err;
    }
}
async function run() {
    try {
        const adminUser = process.env.ADMIN_USER || 'Admin';
        const adminPass = process.env.ADMIN_PASS || 'Admin123';
        const driverUser = process.env.DRIVER_USER || 'Driver1';
        const driverPass = process.env.DRIVER_PASS || 'Driver123';
        await ensureUser(adminUser, adminPass, 'admin', 'admin@dubailogistics.com', 'Administrator');
        await ensureUser(driverUser, driverPass, 'driver', null, 'Driver One');
    }
    catch (e) {
        console.error('seed run failed', e);
    }
    finally {
        await prisma_js_1.default.$disconnect();
        process.exit(0);
    }
}
run();
