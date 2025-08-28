const axios = require('axios');

const API_BASE_URL = 'https://book-backend-fmxe.onrender.com';

async function testPhoneFormats() {
  console.log('📱 Testing Different Phone Number Formats...\n');

  const phoneFormats = [
    '964712345678',      // Iraqi format without +
    '+964712345678',     // International format with +
    '9647123456789',     // Longer Iraqi format
    '+9647123456789',    // Longer international format
    '964701234567',      // Different Iraqi prefix
    '+964701234567',     // Different international prefix
    '964750123456',      // Another Iraqi prefix
    '+964750123456'      // Another international prefix
  ];

  for (let i = 0; i < phoneFormats.length; i++) {
    const phoneNumber = phoneFormats[i];
    console.log(`${i + 1}. Testing format: ${phoneNumber}`);
    
    try {
      const response = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        phoneNumber: phoneNumber
      });
      console.log(`   ✅ SUCCESS: ${response.data.message}`);
      console.log(`   📋 Response:`, response.data);
      break; // Stop if we find a working format
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.response?.data?.error?.error || error.response?.data?.message || error.message}`);
    }
    console.log('');
  }

  console.log('\n🔍 Let\'s also test the verify endpoint directly...');
  try {
    const verifyResponse = await axios.post(`${API_BASE_URL}/auth/verify-otp`, {
      phoneNumber: '964712345678',
      verificationCode: '123456'
    });
    console.log('✅ Verify endpoint working:', verifyResponse.data);
  } catch (error) {
    console.log('❌ Verify endpoint error:', error.response?.data || error.message);
  }
}

// Run the tests
testPhoneFormats();

