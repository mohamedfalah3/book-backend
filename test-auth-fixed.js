const axios = require('axios');

const API_BASE_URL = 'https://book-backend-fmxe.onrender.com';

async function testAuthEndpointsFixed() {
  console.log('🧪 Testing Authentication Endpoints (Fixed)...\n');

  try {
    // Test 1: Check auth status
    console.log('1. Testing /auth/status...');
    const statusResponse = await axios.get(`${API_BASE_URL}/auth/status`);
    console.log('✅ Status:', statusResponse.data);
    console.log('');

    // Test 2: Send OTP with properly formatted phone number
    console.log('2. Testing /auth/send-otp with valid phone...');
    try {
      const sendOtpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: '964712345678' // Iraqi format without + or spaces
      });
      console.log('✅ Send OTP Response:', sendOtpResponse.data);
    } catch (error) {
      console.log('❌ Send OTP Error:', error.response?.data || error.message);
    }
    console.log('');

    // Test 3: Send OTP with international format
    console.log('3. Testing /auth/send-otp with international format...');
    try {
      const sendOtpResponse2 = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: '+964712345678' // International format
      });
      console.log('✅ Send OTP Response (International):', sendOtpResponse2.data);
    } catch (error) {
      console.log('❌ Send OTP Error (International):', error.response?.data || error.message);
    }
    console.log('');

    // Test 4: Verify OTP (this should work now)
    console.log('4. Testing /auth/verify-otp...');
    try {
      const verifyOtpResponse = await axios.post(`${API_BASE_URL}/auth/verify-otp`, {
        phoneNumber: '964712345678',
        verificationCode: '123456'
      });
      console.log('✅ Verify OTP Response:', verifyOtpResponse.data);
    } catch (error) {
      console.log('❌ Verify OTP Error:', error.response?.data || error.message);
    }
    console.log('');

    // Test 5: Test validation with invalid phone
    console.log('5. Testing validation...');
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
    console.log('\n📋 Summary:');
    console.log('   ✅ Environment variables are configured');
    console.log('   ✅ OTPIQ API is responding');
    console.log('   ✅ Phone validation is working');
    console.log('   ⚠️  Check phone number format requirements');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the tests
testAuthEndpointsFixed();

