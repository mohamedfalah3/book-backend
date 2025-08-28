const axios = require('axios');

const API_BASE_URL = 'https://book-backend-fmxe.onrender.com';

async function checkEnvironmentVariables() {
  console.log('🔍 Checking environment variables on deployed backend...\n');

  try {
    // Test the status endpoint to see if we can connect
    console.log('1. Testing connection...');
    const statusResponse = await axios.get(`${API_BASE_URL}/auth/status`);
    console.log('✅ Backend is accessible');
    console.log('Status response:', statusResponse.data);
    console.log('');

    // Test OTP sending with detailed error logging
    console.log('2. Testing OTP sending with detailed error...');
    try {
      const sendOtpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: '9647719649473'
      }, {
        timeout: 10000 // 10 second timeout
      });
      console.log('✅ OTP sent successfully!');
      console.log('Response:', sendOtpResponse.data);
    } catch (error) {
      console.log('❌ OTP sending failed');
      console.log('Error status:', error.response?.status);
      console.log('Error data:', error.response?.data);
      console.log('Error message:', error.message);
      
      if (error.response?.data?.error?.includes('OTPIQ API key not configured')) {
        console.log('\n🔧 SOLUTION: The OTPIQ_API_KEY environment variable is not set on Render.');
        console.log('Please configure it in your Render dashboard.');
      }
    }

  } catch (error) {
    console.error('❌ Connection failed:', error.message);
  }
}

checkEnvironmentVariables();
