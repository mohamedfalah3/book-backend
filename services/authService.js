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
    this.otpiqBaseUrl = process.env.OTPIQ_BASE_URL;
  }

  // Send OTP via OTPIQ
  async sendOTP(phoneNumber) {
    try {
      const response = await axios.post(
        `${this.otpiqBaseUrl}/sms`,
        {
          phoneNumber: phoneNumber,
          smsType: "verification",
          provider: "whatsapp-sms",
          verificationCode: ""
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

  // Verify OTP via OTPIQ
  async verifyOTP(phoneNumber, verificationCode) {
    try {
      const response = await axios.post(
        `${this.otpiqBaseUrl}/sms/verify`,
        {
          phoneNumber: phoneNumber,
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
        message: 'OTP verified successfully',
        data: response.data
      };
    } catch (error) {
      console.error('Error verifying OTP:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to verify OTP',
        error: error.response?.data || error.message
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

  // Create new user in Appwrite
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

  // Update user's last login
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

  // Generate Appwrite JWT session
  async generateSession(userId) {
    try {
      // Create a session using Appwrite's account service
      // Note: This requires the user to be created in Appwrite's Users service first
      const session = await account.createSession(userId, 'phone');
      
      return {
        success: true,
        session: session,
        jwt: session.providerToken || session.$id
      };
    } catch (error) {
      console.error('Error generating session:', error);
      return {
        success: false,
        message: 'Failed to generate session',
        error: error.message
      };
    }
  }

  // Complete authentication flow
  async authenticateUser(phoneNumber, verificationCode) {
    try {
      // Step 1: Verify OTP
      const otpVerification = await this.verifyOTP(phoneNumber, verificationCode);
      
      if (!otpVerification.success) {
        return otpVerification;
      }

      // Step 2: Check if user exists
      let user = await this.findUserByPhone(phoneNumber);
      
      if (!user) {
        // Step 3: Create new user
        user = await this.createUser(phoneNumber);
      } else {
        // Step 4: Update last login for existing user
        await this.updateLastLogin(user.$id);
      }

      // Step 5: Generate session
      const session = await this.generateSession(user.$id);
      
      if (!session.success) {
        return session;
      }

      return {
        success: true,
        message: 'Authentication successful',
        user: user,
        session: session.session,
        jwt: session.jwt
      };

    } catch (error) {
      console.error('Authentication error:', error);
      return {
        success: false,
        message: 'Authentication failed',
        error: error.message
      };
    }
  }
}

module.exports = new AuthService();
