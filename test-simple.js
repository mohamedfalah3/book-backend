const axios = require('axios');

const API_BASE_URL = 'https://book-backend-fmxe.onrender.com';

async function testSimple() {
  console.log('🧪 Testing OTP sending...\n');

  try {
    // Test 1: Check backend status
    console.log('1. Testing backend connection...');
    const statusResponse = await axios.get(`${API_BASE_URL}/auth/status`);
    console.log('✅ Backend is accessible:', statusResponse.data);
    console.log('');

    // Test 2: Send OTP
    console.log('2. Testing OTP sending...');
    try {
      const sendOtpResponse = await axios.post(
        `${API_BASE_URL}/auth/send-otp`,
        {
          phoneNumber: "9647719649473"
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('✅ OTP sent successfully!');
      console.log('Response:', sendOtpResponse.data);
    } catch (error) {
      console.log('❌ OTP sending failed');
      console.log('Error status:', error.response?.status);
      console.log('Error data:', error.response?.data);
      console.log('Error message:', error.message);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testSimple();
