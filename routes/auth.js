const express = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../services/authService');

const router = express.Router();

// Rate limiting for OTP requests
const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many OTP requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for OTP verification
const verifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 verification attempts per windowMs
  message: {
    success: false,
    message: 'Too many verification attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validate phone number format (Iraqi format)
const validatePhoneNumber = (phoneNumber) => {
  // Iraqi phone number validation: 964XXXXXXXXXXX (13 digits starting with 964)
  const iraqiPhoneRegex = /^964[0-9]{10}$/;
  return iraqiPhoneRegex.test(phoneNumber);
};

// Validate OTP format
const validateOTP = (otp) => {
  // OTP should be 4-6 digits
  const otpRegex = /^\d{4,6}$/;
  return otpRegex.test(otp);
};

// GET /status - Health check for auth service
router.get('/status', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Authentication service is running'
  });
});

// POST /send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    // Validate request body
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Validate phone number format
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Please use Iraqi format: 964XXXXXXXXXXX'
      });
    }

    // Send OTP
    const result = await authService.sendOTP(phoneNumber);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        data: {
          phoneNumber: phoneNumber,
          // Don't include the actual OTP in response for security
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error in send-otp route:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// POST /verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, verificationCode } = req.body;

    // Validate request body
    if (!phoneNumber || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and verification code are required'
      });
    }

    // Validate phone number format
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Please use Iraqi format: 964XXXXXXXXXXX'
      });
    }

    // Validate OTP format
    if (!validateOTP(verificationCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format. Please enter a valid verification code'
      });
    }

    // Authenticate user
    const result = await authService.authenticateUser(phoneNumber, verificationCode);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Authentication successful',
        data: result.data
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error in verify-otp route:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
