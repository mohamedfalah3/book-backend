const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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

// R2 Domain Configuration
const R2_CONFIG = {
  useCustomDomain: process.env.R2_USE_CUSTOM_DOMAIN === 'true',
  customDomain: process.env.R2_CUSTOM_DOMAIN || null,
  directEndpoint: `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  bucketName: process.env.R2_BUCKET
};

/**
 * Get the appropriate URL for R2 files
 */
function getR2FileUrl(filePath) {
  // Remove r2:// prefix if present
  const cleanPath = filePath.startsWith('r2://') ? filePath.replace('r2://', '') : filePath;
  
  if (R2_CONFIG.useCustomDomain && R2_CONFIG.customDomain) {
    return `https://${R2_CONFIG.customDomain}/${cleanPath}`;
  }
  
  return `https://${R2_CONFIG.directEndpoint}/${cleanPath}`;
}

// Security middleware
app.use(helmet());

// CORS configuration for React Native
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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
    version: '1.0.0',
    r2Config: {
      useCustomDomain: R2_CONFIG.useCustomDomain,
      customDomain: R2_CONFIG.customDomain || 'not configured',
      bucketName: R2_CONFIG.bucketName
    }
  });
});

// Get CDN URL (direct access via custom domain)
app.get('/getCDNUrl', async (req, res) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({
        error: 'File parameter is required',
        example: '/getCDNUrl?file=books/cover.jpg'
      });
    }

    // Validate file parameter
    if (typeof file !== 'string' || file.trim() === '') {
      return res.status(400).json({
        error: 'Invalid file parameter'
      });
    }

    // Sanitize file path
    const sanitizedFile = file.replace(/\.\./g, '').trim();
    
    // Check if custom domain is configured
    if (!R2_CONFIG.useCustomDomain || !R2_CONFIG.customDomain) {
      return res.status(503).json({
        error: 'CDN not configured',
        message: 'Custom domain is not set up for this R2 bucket',
        fallback: 'Use /getSignedUrl instead'
      });
    }
    
    // Generate CDN URL
    const cdnUrl = getR2FileUrl(sanitizedFile);
    
    res.json({
      success: true,
      cdnUrl,
      file: sanitizedFile,
      domain: R2_CONFIG.customDomain,
      cached: true,
      expiresIn: 86400, // CDN cache duration
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      source: 'cdn'
    });

  } catch (error) {
    console.error('Error generating CDN URL:', error);
    
    res.status(500).json({
      error: 'Failed to generate CDN URL',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Batch CDN URLs endpoint
app.post('/getBatchCDNUrls', async (req, res) => {
  try {
    const { files } = req.body;
    
    if (!files || !Array.isArray(files)) {
      return res.status(400).json({
        error: 'Files array is required',
        example: { files: ['books/cover1.jpg', 'books/cover2.jpg'] }
      });
    }

    if (files.length > 100) {
      return res.status(400).json({
        error: 'Too many files requested',
        message: 'Maximum 100 files per batch request'
      });
    }
    
    // Check if custom domain is configured
    if (!R2_CONFIG.useCustomDomain || !R2_CONFIG.customDomain) {
      return res.status(503).json({
        error: 'CDN not configured',
        message: 'Custom domain is not set up for this R2 bucket'
      });
    }
    
    // Generate CDN URLs for all files
    const results = files.map(file => {
      const sanitizedFile = file.replace(/\.\./g, '').trim();
      return {
        originalFile: file,
        file: sanitizedFile,
        cdnUrl: getR2FileUrl(sanitizedFile)
      };
    });
    
    res.json({
      success: true,
      results,
      domain: R2_CONFIG.customDomain,
      cached: true,
      totalFiles: files.length,
      source: 'cdn-batch'
    });

  } catch (error) {
    console.error('Error generating batch CDN URLs:', error);
    
    res.status(500).json({
      error: 'Failed to generate batch CDN URLs',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Debug endpoint to check environment variables
app.get('/debug-env', (req, res) => {
  res.status(200).json({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    R2_ACCESS_KEY: !!process.env.R2_ACCESS_KEY,
    R2_SECRET_KEY: !!process.env.R2_SECRET_KEY,
    R2_ACCOUNT_ID: !!process.env.R2_ACCOUNT_ID,
    R2_BUCKET: !!process.env.R2_BUCKET,
    R2_BUCKET_VALUE: process.env.R2_BUCKET,
    allR2Vars: Object.keys(process.env).filter(key => key.startsWith('R2_'))
  });
});

// Get signed download URL
app.get('/getSignedUrl', async (req, res) => {
  try {
    const { file, preferCDN } = req.query;
    
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
    
    // If CDN is preferred and available, return CDN URL instead of signed URL
    if (preferCDN === 'true' && R2_CONFIG.useCustomDomain && R2_CONFIG.customDomain) {
      const cdnUrl = getR2FileUrl(sanitizedFile);
      return res.json({
        success: true,
        signedUrl: cdnUrl,
        file: sanitizedFile,
        contentType: 'application/octet-stream',
        expiresIn: 86400, // CDN cached for 1 day
        expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
        source: 'cdn'
      });
    }
    
    // Determine content type and headers based on file extension
    const fileExtension = sanitizedFile.split('.').pop()?.toLowerCase();
    let responseContentType = 'application/octet-stream';
    let responseContentDisposition = 'inline';
    
    if (fileExtension) {
      if (['mp3'].includes(fileExtension)) {
        responseContentType = 'audio/mpeg';
      } else if (['m4a'].includes(fileExtension)) {
        responseContentType = 'audio/mp4';
      } else if (['aac'].includes(fileExtension)) {
        responseContentType = 'audio/aac';
      } else if (['wav'].includes(fileExtension)) {
        responseContentType = 'audio/wav';
      } else if (['jpg', 'jpeg'].includes(fileExtension)) {
        responseContentType = 'image/jpeg';
      } else if (['png'].includes(fileExtension)) {
        responseContentType = 'image/png';
      }
    }
    
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: sanitizedFile,
      ResponseContentType: responseContentType,
      ResponseContentDisposition: responseContentDisposition,
      ResponseCacheControl: responseContentType.startsWith('audio/') ? 'public, max-age=31536000' : undefined,
    });

    // Generate iOS-compatible signed URL
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
      // iOS-compatible options - avoid problematic query parameters
      signableHeaders: new Set(['host']), // Only sign host header
    });

    res.json({
      success: true,
      signedUrl,
      file: sanitizedFile,
      contentType: responseContentType,
      expiresIn: 3600,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      source: 'signed'
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

// Get iOS-compatible signed download URL for audio files
app.get('/getIOSAudioUrl', async (req, res) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({
        error: 'File parameter is required',
        example: '/getIOSAudioUrl?file=books/audio.mp3'
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
    
    // Check if it's an audio file
    const audioExtensions = ['.mp3', '.m4a', '.aac', '.wav'];
    const isAudioFile = audioExtensions.some(ext => sanitizedFile.toLowerCase().endsWith(ext));
    
    if (!isAudioFile) {
      return res.status(400).json({
        error: 'File must be an audio file (.mp3, .m4a, .aac, .wav)'
      });
    }
    
    // Determine optimal content type for iOS
    const fileExtension = sanitizedFile.split('.').pop()?.toLowerCase();
    let responseContentType = 'audio/mpeg';
    
    if (fileExtension === 'm4a') {
      responseContentType = 'audio/mp4';
    } else if (fileExtension === 'aac') {
      responseContentType = 'audio/aac';
    } else if (fileExtension === 'wav') {
      responseContentType = 'audio/wav';
    } else if (fileExtension === 'mp3') {
      responseContentType = 'audio/mpeg';
    }
    
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: sanitizedFile,
      // iOS-optimized response headers
      ResponseContentType: responseContentType,
      ResponseContentDisposition: 'inline',
      ResponseCacheControl: 'public, max-age=31536000',
      // Ensure range requests work for iOS AVPlayer
      ResponseAcceptRanges: 'bytes',
    });

    // Generate iOS-compatible signed URL with minimal parameters
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
      // iOS-compatible options - minimal query parameters
      signableHeaders: new Set(['host']), // Only sign host header
    });

    res.json({
      success: true,
      signedUrl,
      file: sanitizedFile,
      contentType: responseContentType,
      expiresIn: 3600,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      platform: 'ios-optimized',
      headers: {
        'Content-Type': responseContentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000',
        'Accept-Ranges': 'bytes'
      }
    });

  } catch (error) {
    console.error('Error generating iOS audio signed URL:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({
        error: 'Audio file not found',
        file: req.query.file
      });
    }
    
    res.status(500).json({
      error: 'Failed to generate iOS audio signed URL',
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
    
    // Prepare metadata for audio files
    const metadata = {};
    if (contentType.startsWith('audio/')) {
      metadata['Content-Disposition'] = 'inline';
      metadata['Cache-Control'] = 'public, max-age=31536000';
      
      // Ensure proper content type for iOS compatibility
      if (contentType === 'audio/mpeg') {
        metadata['Content-Type'] = 'audio/mpeg';
      } else if (contentType === 'audio/mp4') {
        metadata['Content-Type'] = 'audio/mp4';
      } else if (contentType === 'audio/aac') {
        metadata['Content-Type'] = 'audio/aac';
      }
    }
    
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: sanitizedFile,
      ContentType: contentType,
      Metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    // Generate iOS-compatible signed URL
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
      // iOS-compatible options - avoid problematic query parameters
      signableHeaders: new Set(['host']), // Only sign host header
    });

    res.json({
      success: true,
      signedUrl,
      file: sanitizedFile,
      contentType,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
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

// Delete file from R2
app.delete('/deleteFile', async (req, res) => {
  try {
    const { file } = req.body;
    
    if (!file) {
      return res.status(400).json({
        error: 'File parameter is required in request body',
        example: { file: 'books/cover.jpg' }
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
    
    console.log(`Attempting to delete file: ${sanitizedFile} from bucket: ${process.env.R2_BUCKET}`);
    
    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: sanitizedFile,
    });

    await s3Client.send(command);

    console.log(`Successfully deleted file: ${sanitizedFile}`);

    res.json({
      success: true,
      message: 'File deleted successfully',
      file: sanitizedFile,
      deletedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error deleting file from R2:', error);
    
    // Check if it's a "NoSuchKey" error (file doesn't exist)
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({
        error: 'File not found',
        message: 'The specified file does not exist in the bucket',
        file: req.body.file
      });
    }
    
    res.status(500).json({
      error: 'Failed to delete file',
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
      'POST /getUploadUrl',
      'DELETE /deleteFile'
    ]
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 R2 Signed URL Service running on port ${PORT}`);
  console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Local: http://localhost:${PORT}/health`);
  console.log(`🔗 Network: http://192.168.100.15:${PORT}/health`);
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
