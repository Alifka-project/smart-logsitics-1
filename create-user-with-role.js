/**
 * Script to create users with specific roles
 * Supports: admin, driver, delivery_team, sales_ops, manager
 * 
 * Usage: node create-user-with-role.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const prisma = new PrismaClient();

const ROLES = {
  ADMIN: 'admin',
  DRIVER: 'driver',
  DELIVERY_TEAM: 'delivery_team',
  SALES_OPS: 'sales_ops',
  MANAGER: 'manager'
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function createUser() {
  try {
    console.log('\n=== Create New User ===\n');
    
    const fullName = await question('Full Name: ');
    const username = await question('Username: ');
    const email = await question('Email: ');
    const password = await question('Password: ');
    
    console.log('\nAvailable Roles:');
    console.log('1. Admin (Can chat with everyone)');
    console.log('2. Driver (Can only chat with admins)');
    console.log('3. Delivery Team (Can only chat with admins)');
    console.log('4. Sales Ops (Can only chat with admins)');
    console.log('5. Manager (Can only chat with admins)');
    
    const roleChoice = await question('\nSelect role (1-5): ');
    
    const roleMap = {
      '1': ROLES.ADMIN,
      '2': ROLES.DRIVER,
      '3': ROLES.DELIVERY_TEAM,
      '4': ROLES.SALES_OPS,
      '5': ROLES.MANAGER
    };
    
    const role = roleMap[roleChoice];
    
    if (!role) {
      console.error('Invalid role selection!');
      process.exit(1);
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create driver (user) record
    const driver = await prisma.driver.create({
      data: {
        fullName,
        username,
        email,
        active: true
      }
    });
    
    // Create account with role
    const account = await prisma.account.create({
      data: {
        driverId: driver.id,
        passwordHash,
        role
      }
    });
    
    console.log('\n✅ User created successfully!');
    console.log(`ID: ${driver.id}`);
    console.log(`Username: ${username}`);
    console.log(`Role: ${role}`);
    console.log(`Full Name: ${fullName}`);
    
  } catch (error) {
    console.error('\n❌ Error creating user:', error.message);
    if (error.code === 'P2002') {
      console.error('Username or email already exists!');
    }
  } finally {
    await prisma.$disconnect();
    rl.close();
  }
}

createUser();
