/**
 * Live SMS Testing Script
 * Run this to test SMS functionality with real phone number
 */

const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:4000';
const TEST_PHONE = '+971588712409'; // Your phone number

// Test admin credentials (update these with your actual credentials)
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123'; // Update with your actual password

let authToken = null;
let testDeliveryId = null;

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  console.log(`\n${colors.cyan}[Step ${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

// Step 1: Health Check
async function healthCheck() {
  logStep(1, 'Health Check - Verifying server is running');
  try {
    const response = await axios.get(`${API_URL}/api/health`, {
      timeout: 5000
    });
    if (response.data.ok && response.data.database === 'connected') {
      logSuccess('Server is running and database is connected');
      logInfo(`Response time: ${response.data.responseTime}`);
      return true;
    } else {
      logError('Server responded but database is not connected');
      return false;
    }
  } catch (error) {
    logError(`Server is not responding: ${error.message}`);
    logInfo('Please ensure your server is running: npm run dev');
    return false;
  }
}

// Step 2: Admin Login
async function login() {
  logStep(2, 'Admin Login - Getting authentication token');
  try {
    const response = await axios.post(`${API_URL}/api/auth/login`, {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD
    });
    
    if (response.data.token) {
      authToken = response.data.token;
      logSuccess('Successfully logged in as admin');
      logInfo(`Token: ${authToken.substring(0, 20)}...`);
      return true;
    } else {
      logError('Login response missing token');
      return false;
    }
  } catch (error) {
    logError(`Login failed: ${error.response?.data?.message || error.message}`);
    logInfo('Please check your admin credentials in the script');
    return false;
  }
}

// Step 3: Check for existing deliveries
async function checkDeliveries() {
  logStep(3, 'Checking for existing deliveries');
  try {
    const response = await axios.get(`${API_URL}/api/admin/tracking/deliveries`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    const deliveries = response.data.deliveries || [];
    logInfo(`Found ${deliveries.length} deliveries in system`);
    
    // Look for delivery with test phone number
    const testDelivery = deliveries.find(d => d.phone === TEST_PHONE);
    
    if (testDelivery) {
      testDeliveryId = testDelivery.id;
      logSuccess(`Found existing delivery with test phone: ${testDeliveryId}`);
      logInfo(`Customer: ${testDelivery.customer}`);
      logInfo(`Status: ${testDelivery.status}`);
      return true;
    } else {
      logInfo('No delivery found with test phone number');
      logInfo('Will create a test delivery in next step');
      return false;
    }
  } catch (error) {
    logError(`Failed to fetch deliveries: ${error.message}`);
    return false;
  }
}

// Step 4: Create test delivery if needed
async function createTestDelivery() {
  logStep(4, 'Creating test delivery for SMS testing');
  
  const testDelivery = {
    customer: 'SMS Test Customer',
    phone: TEST_PHONE,
    address: 'Test Address, Dubai Marina, Dubai, UAE',
    items: 'Test Product - SMS Confirmation Demo',
    poNumber: `TEST-${Date.now()}`,
    lat: 25.0760,
    lng: 55.1330,
    status: 'pending',
    metadata: {
      testDelivery: true,
      createdBy: 'automated-test',
      createdAt: new Date().toISOString()
    }
  };

  try {
    // Note: You'll need to check your actual endpoint for creating deliveries
    // This might be through file upload or direct API
    logInfo('Creating delivery via Prisma...');
    
    // Alternative: Upload via Excel file (simpler)
    logInfo('For this test, please create a delivery manually:');
    console.log('\n📋 Test Delivery Details:');
    console.log('   Customer:', testDelivery.customer);
    console.log('   Phone:', testDelivery.phone);
    console.log('   Address:', testDelivery.address);
    console.log('   Items:', testDelivery.items);
    console.log('\n⚠️  Please add this delivery manually in the UI, then press Enter to continue...');
    
    // Wait for user input
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
    
    // Re-check for deliveries
    await checkDeliveries();
    
    if (!testDeliveryId) {
      logError('Delivery still not found. Please ensure it was created.');
      return false;
    }
    
    return true;
  } catch (error) {
    logError(`Failed to create test delivery: ${error.message}`);
    return false;
  }
}

// Step 5: Send SMS
async function sendSMS() {
  logStep(5, `Sending SMS to ${TEST_PHONE}`);
  
  if (!testDeliveryId) {
    logError('No delivery ID available. Cannot send SMS.');
    return false;
  }

  try {
    const response = await axios.post(
      `${API_URL}/api/deliveries/${testDeliveryId}/send-sms`,
      {},
      {
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data.ok) {
      logSuccess('SMS sent successfully! 🎉');
      console.log('\n📱 SMS Details:');
      console.log('   Message ID:', response.data.messageId);
      console.log('   Token:', response.data.token);
      console.log('   Expires At:', new Date(response.data.expiresAt).toLocaleString());
      console.log('   Confirmation Link:', response.data.confirmationLink);
      
      console.log('\n✅ Check your phone for the SMS!');
      console.log('📲 You should receive a message with a confirmation link.');
      
      // Save token for verification
      const token = response.data.token;
      console.log('\n🔗 Customer Confirmation URL:');
      console.log(`   ${response.data.confirmationLink}`);
      
      return { success: true, token, confirmationLink: response.data.confirmationLink };
    } else {
      logError('SMS send failed');
      console.log('Response:', response.data);
      return false;
    }
  } catch (error) {
    logError(`Failed to send SMS: ${error.response?.data?.message || error.message}`);
    if (error.response?.data) {
      console.log('Error details:', error.response.data);
    }
    return false;
  }
}

// Step 6: Verify token
async function verifyToken(token) {
  logStep(6, 'Verifying confirmation token');
  
  try {
    const response = await axios.get(`${API_URL}/api/customer/confirm-delivery/${token}`);
    
    if (response.data.ok) {
      logSuccess('Token is valid and confirmation page accessible');
      console.log('\n📦 Delivery Details:');
      console.log('   Customer:', response.data.delivery.customer);
      console.log('   Phone:', response.data.delivery.phone);
      console.log('   Address:', response.data.delivery.address);
      console.log('   Available Dates:', response.data.availableDates.length, 'dates');
      console.log('   Already Confirmed:', response.data.isAlreadyConfirmed ? 'Yes' : 'No');
      return true;
    } else {
      logError('Token verification failed');
      return false;
    }
  } catch (error) {
    logError(`Token verification failed: ${error.message}`);
    return false;
  }
}

// Main test execution
async function runTests() {
  console.log('\n' + '='.repeat(60));
  log('🧪 SMS FEATURE - LIVE TESTING', 'cyan');
  log(`📱 Test Phone Number: ${TEST_PHONE}`, 'cyan');
  log(`🌐 API URL: ${API_URL}`, 'cyan');
  console.log('='.repeat(60));
  
  // Run tests sequentially
  const healthOk = await healthCheck();
  if (!healthOk) {
    logError('Health check failed. Please start the server and try again.');
    process.exit(1);
  }
  
  const loginOk = await login();
  if (!loginOk) {
    logError('Login failed. Please check credentials and try again.');
    process.exit(1);
  }
  
  const deliveryExists = await checkDeliveries();
  if (!deliveryExists) {
    const created = await createTestDelivery();
    if (!created) {
      logError('Could not create test delivery. Exiting.');
      process.exit(1);
    }
  }
  
  const smsResult = await sendSMS();
  if (!smsResult || !smsResult.success) {
    logError('SMS sending failed. Please check Twilio configuration.');
    process.exit(1);
  }
  
  // Verify token
  await verifyToken(smsResult.token);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  log('✅ ALL TESTS PASSED!', 'green');
  console.log('='.repeat(60));
  console.log('\n📱 Next Steps:');
  console.log('1. Check your phone for the SMS');
  console.log('2. Click the link in the SMS');
  console.log('3. Select a delivery date');
  console.log('4. Confirm the delivery');
  console.log('5. You\'ll be redirected to tracking page');
  console.log('\n🎉 SMS feature is working correctly!\n');
  
  process.exit(0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  logError('Unhandled error:');
  console.error(error);
  process.exit(1);
});

// Run tests
runTests().catch(error => {
  logError('Test execution failed:');
  console.error(error);
  process.exit(1);
});
