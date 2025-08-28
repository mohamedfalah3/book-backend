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

// Validate phone number format
const validatePhoneNumber = (phoneNumber) => {
  // Basic phone number validation - adjust regex based on your requirements
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phoneNumber);
};

// Validate OTP format
const validateOTP = (otp) => {
  // OTP should be 4-6 digits
  const otpRegex = /^\d{4,6}$/;
  return otpRegex.test(otp);
};

// POST /send-otp
router.post('/send-otp', otpRateLimit, async (req, res) => {
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
        message: 'Invalid phone number format'
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
router.post('/verify-otp', verifyRateLimit, async (req, res) => {
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
        message: 'Invalid phone number format'
      });
    }

    // Validate OTP format
    if (!validateOTP(verificationCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format'
      });
    }

    // Complete authentication flow
    const result = await authService.authenticateUser(phoneNumber, verificationCode);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Authentication successful',
        data: {
          user: {
            id: result.user.$id,
            phone: result.user.phone,
            lastLogin: result.user.lastLogin,
            createdAt: result.user.createdAt
          },
          session: {
            id: result.session.$id,
            jwt: result.jwt
          }
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
    console.error('Error in verify-otp route:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// GET /auth/status - Check authentication status
router.get('/status', async (req, res) => {
  try {
    // This endpoint can be used to verify if a JWT is still valid
    // You would need to implement JWT verification logic here
    return res.status(200).json({
      success: true,
      message: 'Authentication service is running'
    });
  } catch (error) {
    console.error('Error in auth status route:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
