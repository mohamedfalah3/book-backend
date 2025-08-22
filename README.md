# R2 Signed URL Backend

A Node.js Express server that provides signed URLs for Cloudflare R2 storage, enabling secure file uploads and downloads from React Native apps.

## 🚀 Features

- **Signed Download URLs**: Generate secure URLs for downloading files from R2
- **Signed Upload URLs**: Generate secure URLs for uploading files directly to R2
- **iOS Audio Optimization**: Special endpoints with proper headers for iOS AVPlayer compatibility
- **CORS Support**: Configured for React Native apps
- **Rate Limiting**: Built-in protection against abuse
- **Security**: Helmet.js for security headers
- **Production Ready**: Error handling, logging, and graceful shutdown

## 📋 Prerequisites

- Node.js 18+ 
- Cloudflare R2 bucket
- R2 API credentials (Access Key, Secret Key, Account ID)

## 🛠️ Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy the example environment file and configure your R2 credentials:

```bash
cp env.example .env
```

Edit `.env` with your actual values:

```env
# Cloudflare R2 Configuration
R2_ACCESS_KEY=your_r2_access_key_here
R2_SECRET_KEY=your_r2_secret_key_here
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_BUCKET=your_bucket_name

# Server Configuration
PORT=3000
NODE_ENV=production

# CORS Configuration (for React Native)
CORS_ORIGIN=*

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### 3. Get R2 Credentials

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **R2 Object Storage**
3. Go to **Manage R2 API tokens**
4. Create a new API token with:
   - **Permissions**: Object Read & Write
   - **Resources**: Your specific bucket
5. Copy the Access Key ID and Secret Access Key
6. Note your Account ID from the dashboard

### 4. Run the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

## 📡 API Endpoints

### Health Check
```
GET /health
```

### Get Signed Download URL
```
GET /getSignedUrl?file=FILENAME
```

**Example:**
```bash
curl "http://localhost:3000/getSignedUrl?file=books/cover.jpg"
```

**Response:**
```json
{
  "success": true,
  "signedUrl": "https://...",
  "file": "books/cover.jpg",
  "contentType": "image/jpeg",
  "expiresIn": 3600,
  "expiresAt": "2024-01-15T10:30:00.000Z"
}
```

### Get iOS-Optimized Audio URL
```
GET /getIOSAudioUrl?file=FILENAME
```

**Description:** Special endpoint for audio files with iOS-optimized headers including `Accept-Ranges: bytes` for streaming support.

**Example:**
```bash
curl "http://localhost:3000/getIOSAudioUrl?file=books/audio.mp3"
```

**Response:**
```json
{
  "success": true,
  "signedUrl": "https://...",
  "file": "books/audio.mp3",
  "contentType": "audio/mpeg",
  "expiresIn": 3600,
  "expiresAt": "2024-01-15T10:30:00.000Z",
  "platform": "ios-optimized",
  "headers": {
    "Content-Type": "audio/mpeg",
    "Content-Disposition": "inline",
    "Cache-Control": "public, max-age=31536000",
    "Accept-Ranges": "bytes"
  }
}
```

### Get Signed Upload URL
```
POST /getUploadUrl
Content-Type: application/json

{
  "file": "FILENAME",
  "contentType": "image/jpeg"
}
```

**Example:**
```bash
curl -X POST "http://localhost:3000/getUploadUrl" \
  -H "Content-Type: application/json" \
  -d '{"file": "books/cover.jpg", "contentType": "image/jpeg"}'
```

**Response:**
```json
{
  "success": true,
  "signedUrl": "https://...",
  "file": "books/cover.jpg",
  "contentType": "image/jpeg",
  "expiresIn": 3600,
  "expiresAt": "2024-01-15T10:30:00.000Z"
}
```

## 📱 React Native Integration

### 1. Upload File to R2

```typescript
import { fileUploadService } from './src/services/fileUploadService';

const uploadFileWithSignedUrl = async (fileUri: string, fileName: string, contentType: string) => {
  try {
    // 1. Get signed upload URL from backend
    const response = await fetch('https://your-backend.com/getUploadUrl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: fileName,
        contentType: contentType
      })
    });

    const { signedUrl } = await response.json();

    // 2. Read file as blob
    const fileResponse = await fetch(fileUri);
    const blob = await fileResponse.blob();

    // 3. Upload directly to R2 using signed URL
    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: blob
    });

    if (uploadResponse.ok) {
      console.log('File uploaded successfully!');
      return true;
    } else {
      throw new Error('Upload failed');
    }
  } catch (error) {
    console.error('Upload error:', error);
    return false;
  }
};

// Usage
await uploadFileWithSignedUrl(
  'file://path/to/image.jpg',
  'books/cover.jpg',
  'image/jpeg'
);
```

### 2. Download File from R2

```typescript
const downloadFileWithSignedUrl = async (fileName: string) => {
  try {
    // 1. Get signed download URL from backend
    const response = await fetch(`https://your-backend.com/getSignedUrl?file=${encodeURIComponent(fileName)}`);
    const { signedUrl } = await response.json();

    // 2. Download file using signed URL
    const fileResponse = await fetch(signedUrl);
    
    if (fileResponse.ok) {
      const blob = await fileResponse.blob();
      const fileUrl = URL.createObjectURL(blob);
      return fileUrl;
    } else {
      throw new Error('Download failed');
    }
  } catch (error) {
    console.error('Download error:', error);
    return null;
  }
};

// Usage
const fileUrl = await downloadFileWithSignedUrl('books/cover.jpg');
if (fileUrl) {
  // Use fileUrl in your app
  console.log('File downloaded:', fileUrl);
}
```

## 🎵 Audio Upload Improvements

### iOS Compatibility

This backend includes special optimizations for audio files to ensure compatibility with iOS AVPlayer:

#### Key Features:
- **Proper Headers**: Sets correct `Content-Type`, `Content-Disposition`, and `Cache-Control` headers
- **Range Requests**: Includes `Accept-Ranges: bytes` for streaming support
- **iOS-Optimized Endpoint**: `/getIOSAudioUrl` for audio files with enhanced headers
- **Format Support**: Optimized for MP3, M4A, AAC, and WAV formats

#### Supported Audio Headers:
```json
{
  "Content-Type": "audio/mpeg|audio/mp4|audio/aac|audio/wav",
  "Content-Disposition": "inline",
  "Cache-Control": "public, max-age=31536000",
  "Accept-Ranges": "bytes"
}
```

#### Usage for Audio Files:
```typescript
// For iOS-optimized audio downloads
const audioUrl = await fetch(`https://your-backend.com/getIOSAudioUrl?file=books/audio.mp3`);
const { signedUrl } = await audioUrl.json();

// Use signedUrl with AVPlayer or other audio players
```

### Audio Format Recommendations:
- **iOS**: M4A (AAC) - Most reliable
- **Android**: MP3 or M4A - Both work well
- **Cross-platform**: M4A - Safest choice

## 🚀 Deployment

### Deploy to Render

1. **Create a new Web Service** on [Render](https://render.com/)
2. **Connect your GitHub repository**
3. **Configure the service:**
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
4. **Add Environment Variables:**
   - `R2_ACCESS_KEY`
   - `R2_SECRET_KEY`
   - `R2_ACCOUNT_ID`
   - `R2_BUCKET`
   - `NODE_ENV=production`
5. **Deploy**

### Deploy to Railway

1. **Create a new project** on [Railway](https://railway.app/)
2. **Connect your GitHub repository**
3. **Add Environment Variables** in the Railway dashboard
4. **Deploy automatically**

### Deploy to Vercel

1. **Create a new project** on [Vercel](https://vercel.com/)
2. **Import your GitHub repository**
3. **Configure build settings:**
   - **Framework Preset**: Node.js
   - **Build Command**: `npm install`
   - **Output Directory**: `.`
4. **Add Environment Variables**
5. **Deploy**

## 🔒 Security Features

- **Rate Limiting**: Prevents abuse with configurable limits
- **CORS Protection**: Configured for React Native apps
- **Security Headers**: Helmet.js for additional security
- **Input Validation**: Sanitizes file paths
- **Error Handling**: Secure error messages in production

## 📊 Monitoring

### Health Check
Monitor your service health:
```bash
curl https://your-backend.com/health
```

### Logs
Check application logs in your hosting platform's dashboard.

## 🐛 Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check R2 credentials and bucket permissions
2. **CORS Errors**: Verify CORS_ORIGIN configuration
3. **Rate Limiting**: Check rate limit settings
4. **File Not Found**: Verify file path and bucket configuration

### Debug Mode

Set `NODE_ENV=development` to get detailed error messages.

## 📄 License

MIT License - feel free to use this in your projects!
