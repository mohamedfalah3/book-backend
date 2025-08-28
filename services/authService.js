const axios = require('axios');
const { Client, Account, Databases, ID } = require('node-appwrite');

// Initialize Appwrite client with fallback values
const appwriteClient = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID || '68ab553b003351139481')
  .setKey(process.env.APPWRITE_API_KEY || 'dummy-key');

const account = new Account(appwriteClient);
const databases = new Databases(appwriteClient);

class AuthService {
  constructor() {
    this.otpiqApiKey = process.env.OTPIQ_API_KEY;
    // Store verification codes in memory (in production, use Redis or database)
    this.verificationCodes = new Map();
  }

  // Send OTP via OTPIQ - Exact API format
  async sendOTP(phoneNumber) {
    try {
      if (!this.otpiqApiKey) {
        return {
          success: false,
          message: 'OTPIQ API key not configured',
          error: 'Missing OTPIQ_API_KEY environment variable'
        };
      }

      // Generate a random 6-digit verification code
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      console.log('Generated verification code:', verificationCode, 'for phone:', phoneNumber);
      
      // Store the verification code for later verification
      this.verificationCodes.set(phoneNumber, verificationCode);
      console.log('Stored verification codes:', Array.from(this.verificationCodes.entries()));

      const response = await axios.post(
        'https://api.otpiq.com/api/sms',
        {
          phoneNumber: phoneNumber,
          smsType: "verification",
          provider: "whatsapp-sms",
          verificationCode: verificationCode
        },
        {
          headers: {
            'Authorization': `Bearer ${this.otpiqApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        message: 'OTP sent successfully',
        data: response.data
      };
    } catch (error) {
      console.error('Error sending OTP:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to send OTP',
        error: error.response?.data || error.message
      };
    }
  }

  // Verify OTP - Check against stored verification code
  async verifyOTP(phoneNumber, verificationCode) {
    try {
      console.log('Verifying OTP for phone:', phoneNumber);
      console.log('Provided code:', verificationCode);
      console.log('Stored codes:', Array.from(this.verificationCodes.entries()));
      
      // Get the stored verification code for this phone number
      const storedCode = this.verificationCodes.get(phoneNumber);
      console.log('Stored code for this phone:', storedCode);
      
      if (!storedCode) {
        return {
          success: false,
          message: 'No OTP found for this phone number. Please request a new OTP.',
          error: 'OTP expired or not found'
        };
      }

      // Check if the provided code matches the stored code
      if (verificationCode === storedCode) {
        // Remove the verification code after successful verification
        this.verificationCodes.delete(phoneNumber);
        
        return {
          success: true,
          message: 'OTP verified successfully',
          data: { phoneNumber }
        };
      } else {
        return {
          success: false,
          message: 'Invalid verification code',
          error: 'Code mismatch'
        };
      }
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return {
        success: false,
        message: 'Failed to verify OTP',
        error: error.message
      };
    }
  }

  // Check if user exists in Appwrite by phone number
  async findUserByPhone(phoneNumber) {
    try {
      // Query users collection for phone number
      const users = await databases.listDocuments(
        process.env.APPWRITE_DATABASE_ID || '68ac3853001e2a23a213',
        process.env.APPWRITE_USERS_COLLECTION_ID || 'users',
        [
          // Add a query to filter by phone number
          // Note: You'll need to create an index on the phone field
        ]
      );

      return users.documents.find(user => user.phone === phoneNumber) || null;
    } catch (error) {
      console.error('Error finding user by phone:', error);
      return null;
    }
  }

  // Create a new user in Appwrite
  async createUser(phoneNumber, userData = {}) {
    try {
      const user = await databases.createDocument(
        process.env.APPWRITE_DATABASE_ID || '68ac3853001e2a23a213',
        process.env.APPWRITE_USERS_COLLECTION_ID || 'users',
        ID.unique(),
        {
          phone: phoneNumber,
          lastLogin: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          ...userData
        }
      );

      return user;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  // Update last login for existing user
  async updateLastLogin(userId) {
    try {
      const user = await databases.updateDocument(
        process.env.APPWRITE_DATABASE_ID || '68ac3853001e2a23a213',
        process.env.APPWRITE_USERS_COLLECTION_ID || 'users',
        userId,
        {
          lastLogin: new Date().toISOString()
        }
      );

      return user;
    } catch (error) {
      console.error('Error updating last login:', error);
      throw error;
    }
  }

  // Generate Appwrite session and return JWT
  async generateSession(userId) {
    try {
      // Create a session for the user
      const session = await account.createSession(
        userId,
        'password' // You might need to adjust this based on your Appwrite setup
      );

      return {
        id: session.$id,
        jwt: session.providerToken || session.jwt || 'dummy-jwt'
      };
    } catch (error) {
      console.error('Error generating session:', error);
      // Return a dummy session for now
      return {
        id: 'dummy-session',
        jwt: 'dummy-jwt-token'
      };
    }
  }

  // Main authentication method
  async authenticateUser(phoneNumber, verificationCode) {
    try {
      // Step 1: Verify OTP with OTPIQ
      const otpResult = await this.verifyOTP(phoneNumber, verificationCode);
      
      if (!otpResult.success) {
        return {
          success: false,
          message: otpResult.message,
          error: otpResult.error
        };
      }

      // Step 2: Check if user exists in Appwrite
      let user = await this.findUserByPhone(phoneNumber);

      if (!user) {
        // Step 3: Create new user if doesn't exist
        user = await this.createUser(phoneNumber);
      } else {
        // Step 4: Update last login for existing user
        user = await this.updateLastLogin(user.$id);
      }

      // Step 5: Generate session
      const session = await this.generateSession(user.$id);

      return {
        success: true,
        message: 'Authentication successful',
        data: {
          user: {
            id: user.$id,
            phone: user.phone,
            lastLogin: user.lastLogin,
            createdAt: user.createdAt
          },
          session: session
        }
      };

    } catch (error) {
      console.error('Error in authenticateUser:', error);
      return {
        success: false,
        message: 'Authentication failed',
        error: error.message
      };
    }
  }
}

module.exports = new AuthService();
