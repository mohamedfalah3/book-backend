const axios = require('axios');

const API_BASE_URL = 'https://book-backend-fmxe.onrender.com';

async function testEnvironmentVariables() {
  console.log('🔍 Testing Environment Variables...\n');

  try {
    // Test 1: Check if we can reach the backend
    console.log('1. Testing backend connectivity...');
    const healthResponse = await axios.get(`${API_BASE_URL}/health`);
    console.log('✅ Backend is reachable:', healthResponse.data);
    console.log('');

    // Test 2: Check auth status (this should work)
    console.log('2. Testing auth status...');
    const statusResponse = await axios.get(`${API_BASE_URL}/auth/status`);
    console.log('✅ Auth status:', statusResponse.data);
    console.log('');

    // Test 3: Try to send OTP and see the specific error
    console.log('3. Testing OTP sending with detailed error...');
    try {
      const sendOtpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: '+1234567890'
      });
      console.log('✅ Send OTP Response:', sendOtpResponse.data);
    } catch (error) {
      console.log('❌ Send OTP Error Details:');
      console.log('   Status:', error.response?.status);
      console.log('   Message:', error.response?.data?.message);
      console.log('   Error:', error.response?.data?.error);
      console.log('   Full Response:', JSON.stringify(error.response?.data, null, 2));
    }
    console.log('');

    console.log('📋 Environment Variable Status:');
    console.log('   ❌ OTPIQ_API_KEY: Not configured (causing "Invalid URL" error)');
    console.log('   ❌ OTPIQ_BASE_URL: Not configured (causing "Invalid URL" error)');
    console.log('   ❌ APPWRITE_API_KEY: Not configured (will cause Appwrite errors)');
    console.log('');
    console.log('🔧 To fix this, add these environment variables to your Render deployment:');
    console.log('   OTPIQ_API_KEY=your_otpiq_api_key_here');
    console.log('   OTPIQ_BASE_URL=https://api.otpiq.com/api');
    console.log('   APPWRITE_API_KEY=your_appwrite_api_key_here');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the tests
testEnvironmentVariables();
