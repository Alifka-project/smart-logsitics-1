#!/usr/bin/env node
/**
 * Test SMS Sending Script
 * This script will:
 * 1. Find a delivery with your phone number
 * 2. Generate confirmation token
 * 3. Send SMS via Twilio
 * 4. Display confirmation and tracking links
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { randomBytes } = require('crypto');

const prisma = new PrismaClient();

// Twilio setup
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_FROM;
const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';

if (!accountSid || !authToken || !twilioFrom) {
  console.error('❌ Missing Twilio credentials in .env file!');
  console.error('   TWILIO_ACCOUNT_SID:', accountSid ? '✓ Set' : '✗ Missing');
  console.error('   TWILIO_AUTH_TOKEN:', authToken ? '✓ Set' : '✗ Missing');
  console.error('   TWILIO_FROM:', twilioFrom ? '✓ Set' : '✗ Missing');
  process.exit(1);
}

const twilio = require('twilio')(accountSid, authToken);

async function sendTestSMS() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              TEST SMS TO YOUR PHONE                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Find delivery with your phone number
    console.log('🔍 Step 1: Finding delivery with your phone number...');
    console.log('   Phone: +971588712409\n');

    const delivery = await prisma.delivery.findFirst({
      where: {
        phone: {
          contains: '971588712409'
        },
        status: {
          in: ['pending', 'confirmed']
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!delivery) {
      console.error('❌ No delivery found with your phone number!');
      console.error('   Phone searched: +971588712409 or 971588712409');
      console.error('   Status searched: pending or confirmed');
      process.exit(1);
    }

    console.log('✅ Found delivery!');
    console.log('   ID:', delivery.id);
    console.log('   Customer:', delivery.customer);
    console.log('   Phone:', delivery.phone);
    console.log('   Address:', delivery.address?.substring(0, 50) + '...');
    console.log('   Status:', delivery.status);
    console.log('');

    // Step 2: Generate or reuse confirmation token
    console.log('🔑 Step 2: Setting up confirmation token...');
    
    let token = delivery.confirmationToken;
    let tokenExpiresAt = delivery.tokenExpiresAt;
    
    if (!token || !tokenExpiresAt || new Date(tokenExpiresAt) < new Date()) {
      // Generate new token
      token = randomBytes(32).toString('hex');
      tokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
      
      // Save token to database
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          confirmationToken: token,
          tokenExpiresAt: tokenExpiresAt,
          confirmationStatus: 'pending'
        }
      });
      
      console.log('   ✓ Generated new token:', token.substring(0, 16) + '...');
    } else {
      console.log('   ✓ Using existing token:', token.substring(0, 16) + '...');
    }
    console.log('   ✓ Token expires:', tokenExpiresAt);
    console.log('');

    // Step 3: Build confirmation and tracking URLs
    console.log('🔗 Step 3: Building URLs...');
    const confirmationUrl = `${frontendUrl}/confirm-delivery/${token}`;
    const trackingUrl = `${frontendUrl}/tracking/${token}`;
    
    console.log('   Confirmation URL:', confirmationUrl);
    console.log('   Tracking URL:', trackingUrl);
    console.log('');

    // Step 4: Compose SMS message
    console.log('✉️  Step 4: Composing SMS message...');
    const message = `Hi ${delivery.customer},

Your order from Electrolux is ready for delivery confirmation.

📅 Confirm your delivery date:
${confirmationUrl}

📍 Track your delivery:
${trackingUrl}

This link expires in 48 hours.

- Electrolux Logistics`;

    console.log('   Message preview:');
    console.log('   ─'.repeat(60));
    console.log(message);
    console.log('   ─'.repeat(60));
    console.log('');

    // Step 5: Format phone number for Twilio (E.164 format)
    console.log('📱 Step 5: Formatting phone number...');
    let phoneNumber = delivery.phone || '';
    
    // Remove spaces and special characters
    phoneNumber = phoneNumber.replace(/[\s\-()]/g, '');
    
    // Add + if not present
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber;
    }
    
    console.log('   Original:', delivery.phone);
    console.log('   Formatted:', phoneNumber);
    console.log('');

    // Step 6: Send SMS via Twilio
    console.log('📨 Step 6: Sending SMS via Twilio...');
    console.log('   From:', twilioFrom);
    console.log('   To:', phoneNumber);
    console.log('');

    const smsResponse = await twilio.messages.create({
      body: message,
      from: twilioFrom,
      to: phoneNumber
    });

    console.log('✅ SMS SENT SUCCESSFULLY!');
    console.log('');
    console.log('📱 SMS Details:');
    console.log('   ─'.repeat(60));
    console.log('   Message SID:', smsResponse.sid);
    console.log('   Status:', smsResponse.status);
    console.log('   From:', smsResponse.from);
    console.log('   To:', smsResponse.to);
    console.log('   Price:', smsResponse.price || 'Calculating...');
    console.log('   Direction:', smsResponse.direction);
    console.log('   ─'.repeat(60));
    console.log('');

    // Step 7: Log to database
    console.log('💾 Step 7: Logging to database...');
    await prisma.smsLog.create({
      data: {
        deliveryId: delivery.id,
        phoneNumber: phoneNumber,
        message: message,
        status: 'sent',
        provider: 'twilio',
        providerMessageId: smsResponse.sid,
        sentAt: new Date()
      }
    });
    console.log('   ✓ SMS logged to database');
    console.log('');

    // Final instructions
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    SMS SENT SUCCESSFULLY! 🎉                   ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    console.log('🎯 NEXT STEPS:');
    console.log('');
    console.log('1. ✅ CHECK YOUR PHONE (+971588712409)');
    console.log('   You should receive SMS in 10-30 seconds');
    console.log('');
    console.log('2. 🔗 TEST CONFIRMATION PAGE:');
    console.log('   Click the confirmation link in SMS OR visit:');
    console.log('   ' + confirmationUrl);
    console.log('');
    console.log('3. 📍 TEST TRACKING PAGE:');
    console.log('   Click the tracking link in SMS OR visit:');
    console.log('   ' + trackingUrl);
    console.log('');
    console.log('4. 📋 WHAT TO TEST:');
    console.log('   ✓ Can you see delivery details?');
    console.log('   ✓ Can you select a delivery date?');
    console.log('   ✓ Can you confirm the delivery?');
    console.log('   ✓ Can you track the delivery on map?');
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  If SMS works, we\'re ready to push the full fix to GitHub!    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ ERROR SENDING SMS:');
    console.error('   Message:', error.message);
    console.error('');
    
    if (error.code) {
      console.error('   Error Code:', error.code);
    }
    
    if (error.moreInfo) {
      console.error('   More Info:', error.moreInfo);
    }
    
    console.error('');
    console.error('Common issues:');
    console.error('   - Twilio credentials incorrect');
    console.error('   - Phone number format invalid');
    console.error('   - Twilio account suspended or trial limitations');
    console.error('   - Database connection failed');
    console.error('');
    console.error('Full error:');
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
sendTestSMS().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
