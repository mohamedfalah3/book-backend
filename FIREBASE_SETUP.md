# Firebase Setup for Books API

## Overview
The backend now includes a Books API that requires Firebase Admin SDK credentials to connect to your Firestore database.

## Required Environment Variables

Add these to your `.env` file:

```bash
# Firebase Configuration
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=your_firebase_client_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----"
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
```

## How to Get Firebase Credentials

### 1. Go to Firebase Console
- Visit [Firebase Console](https://console.firebase.google.com/)
- Select your project

### 2. Generate Service Account Key
- Go to **Project Settings** (gear icon)
- Click **Service Accounts** tab
- Click **Generate New Private Key**
- Download the JSON file

### 3. Extract Values from JSON
The downloaded JSON contains:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "client_email": "firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

### 4. Set Environment Variables
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
```

## Important Notes

1. **Private Key Format**: The private key must be properly escaped with `\n` for newlines
2. **Security**: Never commit your `.env` file to version control
3. **Permissions**: The service account needs read access to your Firestore collections

## Testing the Setup

Once configured, test the endpoints:

```bash
# Test books summary
curl https://your-backend.com/api/books-summary

# Test single book
curl https://your-backend.com/api/books/your-book-id

# Test metrics
curl https://your-backend.com/api/metrics
```

## Fallback Mode

If Firebase credentials are not provided or invalid:
- Books API endpoints return 503 (Service Unavailable)
- A fallback endpoint `/api/books-fallback` provides sample data
- Signed URL services continue to work normally

## Troubleshooting

### Common Issues:

1. **"Firebase not available" error**
   - Check environment variables are set correctly
   - Verify private key format (with `\n` for newlines)
   - Ensure service account has proper permissions

2. **"Permission denied" error**
   - Verify the service account has read access to Firestore
   - Check Firestore security rules

3. **"Invalid private key" error**
   - Ensure private key is properly escaped
   - Check for extra spaces or characters

### Debug Endpoints:

```bash
# Check environment variables (without sensitive data)
curl https://your-backend.com/debug-env

# Check cache statistics
curl https://your-backend.com/cache-stats

# Health check
curl https://your-backend.com/health
```
