"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("./db/index.js");
const auth_js_1 = require("./auth.js");
async function seed() {
    try {
        const username = process.env.ADMIN_USER || 'admin';
        const password = process.env.ADMIN_PASS || 'adminpass';
        const email = process.env.ADMIN_EMAIL || 'admin@example.com';
        const existing = await index_js_1.prisma.driver.findFirst({ where: { username } });
        if (existing) {
            console.log('Admin user already exists');
            return;
        }
        const driver = await index_js_1.prisma.driver.create({
            data: {
                username,
                email,
                fullName: 'Administrator',
                active: true,
            },
        });
        const pwHash = await (0, auth_js_1.hashPassword)(password);
        await index_js_1.prisma.account.create({
            data: {
                driverId: driver.id,
                passwordHash: pwHash,
                role: 'admin',
            },
        });
        console.log('Seeded admin:', username);
    }
    catch (err) {
        console.error('seed error', err);
    }
    finally {
        await index_js_1.prisma.$disconnect();
        process.exit(0);
    }
}
seed();
