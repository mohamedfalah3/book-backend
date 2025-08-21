const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize S3 client for R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

// Security middleware
app.use(helmet());

// CORS configuration for React Native
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000 / 60)
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'R2 Signed URL Service',
    version: '1.0.0'
  });
});

// Get signed download URL
app.get('/getSignedUrl', async (req, res) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({
        error: 'File parameter is required',
        example: '/getSignedUrl?file=books/cover.jpg'
      });
    }

    // Validate file parameter
    if (typeof file !== 'string' || file.trim() === '') {
      return res.status(400).json({
        error: 'Invalid file parameter'
      });
    }

    // Sanitize file path (basic security)
    const sanitizedFile = file.replace(/\.\./g, '').trim();
    
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: sanitizedFile,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    res.json({
      success: true,
      signedUrl,
      file: sanitizedFile,
      expiresIn: 3600,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
    });

  } catch (error) {
    console.error('Error generating download signed URL:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({
        error: 'File not found',
        file: req.query.file
      });
    }
    
    res.status(500).json({
      error: 'Failed to generate signed URL',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get signed upload URL
app.post('/getUploadUrl', async (req, res) => {
  try {
    const { file, contentType = 'application/octet-stream' } = req.body;
    
    if (!file) {
      return res.status(400).json({
        error: 'File parameter is required in request body',
        example: { file: 'books/cover.jpg', contentType: 'image/jpeg' }
      });
    }

    // Validate file parameter
    if (typeof file !== 'string' || file.trim() === '') {
      return res.status(400).json({
        error: 'Invalid file parameter'
      });
    }

    // Sanitize file path (basic security)
    const sanitizedFile = file.replace(/\.\./g, '').trim();
    
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: sanitizedFile,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    res.json({
      success: true,
      signedUrl,
      file: sanitizedFile,
      contentType,
      expiresIn: 3600,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
    });

  } catch (error) {
    console.error('Error generating upload signed URL:', error);
    
    res.status(500).json({
      error: 'Failed to generate signed URL',
      message: error.message || 'Internal server error',
      details: {
        bucket: process.env.R2_BUCKET,
        accountId: process.env.R2_ACCOUNT_ID,
        hasAccessKey: !!process.env.R2_ACCESS_KEY,
        hasSecretKey: !!process.env.R2_SECRET_KEY
      }
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'GET /getSignedUrl?file=FILENAME',
      'POST /getUploadUrl'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 R2 Signed URL Service running on port ${PORT}`);
  console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
