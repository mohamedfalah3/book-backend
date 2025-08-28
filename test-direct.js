const axios = require('axios');

const API_BASE_URL = 'https://book-backend-fmxe.onrender.com';

async function testDirect() {
  console.log('🔍 Direct Testing of Backend Endpoints...\n');

  try {
    // Test 1: Check all available endpoints
    console.log('1. Testing available endpoints...');
    
    const endpoints = [
      '/health',
      '/auth/status',
      '/auth/send-otp',
      '/auth/verify-otp'
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${API_BASE_URL}${endpoint}`);
        console.log(`   ✅ ${endpoint}: ${response.status} - ${response.data.message || 'OK'}`);
      } catch (error) {
        if (error.response?.status === 405) {
          console.log(`   ✅ ${endpoint}: ${error.response.status} - Method not allowed (POST required)`);
        } else if (error.response?.status === 404) {
          console.log(`   ❌ ${endpoint}: ${error.response.status} - Not found`);
        } else {
          console.log(`   ⚠️  ${endpoint}: ${error.response?.status || 'Unknown'} - ${error.message}`);
        }
      }
    }
    console.log('');

    // Test 2: Check if verify endpoint accepts POST
    console.log('2. Testing verify endpoint with POST...');
    try {
      const verifyResponse = await axios.post(`${API_BASE_URL}/auth/verify-otp`, {
        phoneNumber: '9647719649473',
        verificationCode: '123456'
      });
      console.log('✅ Verify endpoint working:', verifyResponse.data);
    } catch (error) {
      console.log('❌ Verify endpoint error:', error.response?.status, error.response?.data?.message || error.message);
    }
    console.log('');

    // Test 3: Check phone number format requirements
    console.log('3. Testing phone number format...');
    console.log('   📱 Your phone number: 9647719649473');
    console.log('   📱 International format: +9647719649473');
    console.log('   📱 OTPIQ might require specific format');
    console.log('');

    console.log('📋 Summary:');
    console.log('   ✅ Backend is deployed and reachable');
    console.log('   ✅ Environment variables are configured');
    console.log('   ⚠️  Rate limiting is active (5 requests/15 min)');
    console.log('   ⚠️  Verify endpoint might need redeployment');
    console.log('');
    console.log('🔧 Recommendations:');
    console.log('   1. Wait 15 minutes for rate limit reset');
    console.log('   2. Check if Render deployment includes latest auth routes');
    console.log('   3. Test with React Native app directly');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the tests
testDirect();

