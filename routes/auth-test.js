const express = require('express');
const authService = require('../services/authService');

const router = express.Router();

// Validate phone number format
const validatePhoneNumber = (phoneNumber) => {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phoneNumber);
};

// Validate OTP format
const validateOTP = (otp) => {
  const otpRegex = /^\d{4,6}$/;
  return otpRegex.test(otp);
};

// POST /send-otp (without rate limiting for testing)
router.post('/send-otp-test', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    const result = await authService.sendOTP(phoneNumber);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        data: {
          phoneNumber: phoneNumber,
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
    console.error('Error in send-otp-test route:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// POST /verify-otp (without rate limiting for testing)
router.post('/verify-otp-test', async (req, res) => {
  try {
    const { phoneNumber, verificationCode } = req.body;

    if (!phoneNumber || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and verification code are required'
      });
    }

    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    if (!validateOTP(verificationCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format'
      });
    }

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
    console.error('Error in verify-otp-test route:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;

