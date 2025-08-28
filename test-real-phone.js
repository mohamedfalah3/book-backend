const axios = require('axios');

const API_BASE_URL = 'https://book-backend-fmxe.onrender.com';

async function testRealPhone() {
  console.log('📱 Testing with Real Phone Number: 9647719649473\n');

  try {
    // Test 1: Check auth status
    console.log('1. Testing /auth/status...');
    const statusResponse = await axios.get(`${API_BASE_URL}/auth/status`);
    console.log('✅ Status:', statusResponse.data);
    console.log('');

    // Test 2: Send OTP with the real phone number
    console.log('2. Testing /auth/send-otp with real phone...');
    try {
      const sendOtpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: '9647719649473'
      });
      console.log('✅ Send OTP Response:', sendOtpResponse.data);
      console.log('📱 OTP should be sent to your phone via WhatsApp/SMS');
    } catch (error) {
      console.log('❌ Send OTP Error:', error.response?.data || error.message);
    }
    console.log('');

    // Test 3: Test verify endpoint (will fail without real OTP, but should show proper error)
    console.log('3. Testing /auth/verify-otp endpoint...');
    try {
      const verifyOtpResponse = await axios.post(`${API_BASE_URL}/auth/verify-otp`, {
        phoneNumber: '9647719649473',
        verificationCode: '123456' // This will fail, but should show the endpoint is working
      });
      console.log('✅ Verify OTP Response:', verifyOtpResponse.data);
    } catch (error) {
      console.log('❌ Verify OTP Error:', error.response?.data || error.message);
      console.log('   (This is expected to fail with a fake OTP code)');
    }
    console.log('');

    // Test 4: Test with international format
    console.log('4. Testing with international format (+9647719649473)...');
    try {
      const sendOtpResponse2 = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: '+9647719649473'
      });
      console.log('✅ Send OTP Response (International):', sendOtpResponse2.data);
    } catch (error) {
      console.log('❌ Send OTP Error (International):', error.response?.data || error.message);
    }
    console.log('');

    console.log('🎉 Test completed!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Check your phone for OTP via WhatsApp/SMS');
    console.log('   2. Use the received OTP code in your React Native app');
    console.log('   3. Test the full authentication flow in the app');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the tests
testRealPhone();

