const express = require('express');
const cors = require('cors');
const { Client, Account } = require('node-appwrite');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Appwrite configuration
const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID || '68ab553b003351139481');

const account = new Account(client);

// OAuth configuration
const SUCCESS_REDIRECT = 'bookapp://auth?success=true';
const FAILURE_REDIRECT = 'bookapp://auth?success=false';

/**
 * Google OAuth Routes
 */

// Route to initiate Google OAuth
app.get('/auth/google', async (req, res) => {
    try {
        console.log('Initiating Google OAuth...');
        
        // Create OAuth session with Appwrite
        const oauthUrl = await account.createOAuth2Session(
            'google',
            SUCCESS_REDIRECT,
            FAILURE_REDIRECT
        );
        
        console.log('OAuth URL created:', oauthUrl);
        
        // Redirect user to Google OAuth
        res.redirect(oauthUrl);
        
    } catch (error) {
        console.error('Error creating OAuth session:', error);
        res.redirect(`${FAILURE_REDIRECT}&error=${encodeURIComponent(error.message)}`);
    }
});

// Route to handle OAuth callback and exchange code for session
app.get('/auth/google/callback', async (req, res) => {
    try {
        const { success, userId, sessionId } = req.query;
        
        console.log('OAuth callback received:', { success, userId, sessionId });
        
        if (success === 'true' && userId && sessionId) {
            // OAuth was successful, create a secure session token
            const sessionToken = await createSecureSessionToken(userId, sessionId);
            
            // Redirect to app with success token
            const successUrl = `${SUCCESS_REDIRECT}&token=${encodeURIComponent(sessionToken)}&userId=${userId}`;
            res.redirect(successUrl);
            
        } else {
            // OAuth failed
            const error = req.query.error || 'OAuth authentication failed';
            const failureUrl = `${FAILURE_REDIRECT}&error=${encodeURIComponent(error)}`;
            res.redirect(failureUrl);
        }
        
    } catch (error) {
        console.error('Error handling OAuth callback:', error);
        const failureUrl = `${FAILURE_REDIRECT}&error=${encodeURIComponent(error.message)}`;
        res.redirect(failureUrl);
    }
});

// Route to validate session token
app.post('/auth/validate', async (req, res) => {
    try {
        const { token, userId } = req.body;
        
        if (!token || !userId) {
            return res.status(400).json({ 
                valid: false, 
                error: 'Token and userId are required' 
            });
        }
        
        // Validate the session token
        const isValid = await validateSessionToken(token, userId);
        
        if (isValid) {
            // Get user details from Appwrite
            const user = await account.get();
            res.json({ 
                valid: true, 
                user: {
                    id: user.$id,
                    email: user.email,
                    name: user.name
                }
            });
        } else {
            res.json({ valid: false, error: 'Invalid session token' });
        }
        
    } catch (error) {
        console.error('Error validating session:', error);
        res.status(500).json({ 
            valid: false, 
            error: error.message 
        });
    }
});

// Route to logout user
app.post('/auth/logout', async (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (sessionId) {
            // Delete the session in Appwrite
            await account.deleteSession(sessionId);
        }
        
        res.json({ success: true, message: 'Logged out successfully' });
        
    } catch (error) {
        console.error('Error logging out:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Security Functions
 */

// Create a secure session token (in production, use proper JWT)
async function createSecureSessionToken(userId, sessionId) {
    // In production, you should:
    // 1. Use a proper JWT library (jsonwebtoken)
    // 2. Sign the token with a secret key
    // 3. Set appropriate expiration
    // 4. Include additional security claims
    
    const tokenData = {
        userId,
        sessionId,
        timestamp: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };
    
    // For now, we'll use a simple base64 encoding
    // In production, use proper JWT signing
    return Buffer.from(JSON.stringify(tokenData)).toString('base64');
}

// Validate session token
async function validateSessionToken(token, userId) {
    try {
        // Decode the token
        const tokenData = JSON.parse(Buffer.from(token, 'base64').toString());
        
        // Check if token is expired
        if (Date.now() > tokenData.expiresAt) {
            return false;
        }
        
        // Check if userId matches
        if (tokenData.userId !== userId) {
            return false;
        }
        
        // In production, you should also:
        // 1. Verify the JWT signature
        // 2. Check if the session still exists in Appwrite
        // 3. Validate additional security claims
        
        return true;
        
    } catch (error) {
        console.error('Error validating token:', error);
        return false;
    }
}

// Health check route
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        appwriteEndpoint: process.env.APPWRITE_ENDPOINT,
        projectId: process.env.APPWRITE_PROJECT_ID
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 OAuth Backend Server running on port ${PORT}`);
    console.log(`📱 Success Redirect: ${SUCCESS_REDIRECT}`);
    console.log(`❌ Failure Redirect: ${FAILURE_REDIRECT}`);
    console.log(`🔗 Google OAuth URL: http://localhost:${PORT}/auth/google`);
});

module.exports = app;
