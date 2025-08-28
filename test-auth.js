const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';

async function testAuthEndpoints() {
  console.log('🧪 Testing Authentication Endpoints...\n');

  try {
    // Test 1: Check auth status
    console.log('1. Testing /auth/status...');
    const statusResponse = await axios.get(`${API_BASE_URL}/auth/status`);
    console.log('✅ Status:', statusResponse.data);
    console.log('');

    // Test 2: Send OTP (with invalid phone number for testing)
    console.log('2. Testing /auth/send-otp...');
    try {
      const sendOtpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: '+1234567890'
      });
      console.log('✅ Send OTP Response:', sendOtpResponse.data);
    } catch (error) {
      console.log('❌ Send OTP Error:', error.response?.data || error.message);
    }
    console.log('');

    // Test 3: Verify OTP (with invalid OTP for testing)
    console.log('3. Testing /auth/verify-otp...');
    try {
      const verifyOtpResponse = await axios.post(`${API_BASE_URL}/auth/verify-otp`, {
        phoneNumber: '+1234567890',
        verificationCode: '123456'
      });
      console.log('✅ Verify OTP Response:', verifyOtpResponse.data);
    } catch (error) {
      console.log('❌ Verify OTP Error:', error.response?.data || error.message);
    }
    console.log('');

    // Test 4: Test validation
    console.log('4. Testing validation...');
    try {
      const invalidPhoneResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: 'invalid'
      });
      console.log('❌ Should have failed with invalid phone');
    } catch (error) {
      console.log('✅ Validation working:', error.response?.data?.message);
    }
    console.log('');

    console.log('🎉 Authentication endpoint tests completed!');
    console.log('\nNote: OTP sending/verification will fail without valid OTPIQ API credentials.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the tests
testAuthEndpoints();
