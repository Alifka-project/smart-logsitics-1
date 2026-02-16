#!/usr/bin/env node
/**
 * Create a test delivery in the production database
 * Run this to fix the 404 error: node create-test-delivery.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTestDelivery() {
  try {
    console.log('🔧 Creating test delivery in database...');
    console.log('📞 Phone: +971588712409');
    
    const delivery = await prisma.delivery.upsert({
      where: { id: 'delivery-1' },
      update: {
        customer: 'Alifka Test',
        phone: '+971588712409',
        address: 'Al zarooni Building Block B Dubai marina, DUBAI, 00000',
        status: 'pending',
        lat: 25.0753,
        lng: 55.1408,
        poNumber: 'TEST-SMS-001',
        items: JSON.stringify([
          { name: 'Test Refrigerator', quantity: 1, material: 'MAT-TEST-001' }
        ]),
        metadata: {
          originalRow: {
            Customer: 'Alifka Test',
            Phone: '+971588712409',
            Address: 'Al zarooni Building Block B Dubai marina, DUBAI, 00000',
            Material: 'MAT-TEST-001',
            Description: 'Test Refrigerator',
            Quantity: '1',
            'PO Number': 'TEST-SMS-001',
            City: 'Dubai'
          }
        },
        updatedAt: new Date()
      },
      create: {
        id: 'delivery-1',
        customer: 'Alifka Test',
        phone: '+971588712409',
        address: 'Al zarooni Building Block B Dubai marina, DUBAI, 00000',
        status: 'pending',
        lat: 25.0753,
        lng: 55.1408,
        poNumber: 'TEST-SMS-001',
        items: JSON.stringify([
          { name: 'Test Refrigerator', quantity: 1, material: 'MAT-TEST-001' }
        ]),
        metadata: {
          originalRow: {
            Customer: 'Alifka Test',
            Phone: '+971588712409',
            Address: 'Al zarooni Building Block B Dubai marina, DUBAI, 00000',
            Material: 'MAT-TEST-001',
            Description: 'Test Refrigerator',
            Quantity: '1',
            'PO Number': 'TEST-SMS-001',
            City: 'Dubai'
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    console.log('✅ Test delivery created successfully!');
    console.log('📋 Delivery ID:', delivery.id);
    console.log('👤 Customer:', delivery.customer);
    console.log('📞 Phone:', delivery.phone);
    console.log('📍 Address:', delivery.address);
    console.log('');
    console.log('✅ Now you can test SMS with this delivery!');
    console.log('🔗 Go to: https://electrolux-smart-portal.vercel.app/deliveries');
    console.log('📱 Click SMS button on "Alifka Test" delivery');
    console.log('');

  } catch (error) {
    console.error('❌ Error creating test delivery:', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('1. Check DATABASE_URL in .env file');
    console.error('2. Make sure database is accessible');
    console.error('3. Run: npx prisma db push (if schema changed)');
    console.error('');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createTestDelivery();
