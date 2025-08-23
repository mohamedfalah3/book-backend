const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cache configuration
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS) || 600; // 10 minutes default
const CACHE_CHECK_PERIOD = 60; // Check for expired keys every 60 seconds
const MAX_CACHE_KEYS = parseInt(process.env.MAX_CACHE_KEYS) || 1000; // Maximum cached URLs

// Initialize in-memory cache
const signedUrlCache = new NodeCache({
  stdTTL: CACHE_TTL,
  checkperiod: CACHE_CHECK_PERIOD,
  maxKeys: MAX_CACHE_KEYS,
  useClones: false // Better performance, we don't modify cached objects
});

// Optional Redis cache (if Redis URL is provided)
let redisClient = null;
if (process.env.REDIS_URL) {
  const redis = require('redis');
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    retry_strategy: (options) => {
      if (options.error && options.error.code === 'ECONNREFUSED') {
        console.log('Redis connection refused, falling back to in-memory cache');
        return undefined; // Stop retrying
      }
      if (options.total_retry_time > 1000 * 60 * 60) {
        return new Error('Redis retry time exhausted');
      }
      return Math.min(options.attempt * 100, 3000);
    }
  });

  redisClient.on('error', (err) => {
    console.log('Redis Client Error:', err);
    console.log('Falling back to in-memory cache');
    redisClient = null;
  });

  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });

  // Connect to Redis
  if (redisClient) {
    redisClient.connect().catch((err) => {
      console.log('Failed to connect to Redis:', err);
      redisClient = null;
    });
  }
}

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

// Cache utility functions
class CacheService {
  static generateCacheKey(bucket, key, operation = 'get') {
    return `r2:${operation}:${bucket}:${key}`;
  }

  static async get(cacheKey) {
    try {
      // Try Redis first if available
      if (redisClient && redisClient.isReady) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          console.log(`✅ Cache HIT (Redis): ${cacheKey}`);
          return cached;
        }
      }

      // Fall back to in-memory cache
      const cached = signedUrlCache.get(cacheKey);
      if (cached) {
        console.log(`✅ Cache HIT (Memory): ${cacheKey}`);
        return cached;
      }

      console.log(`❌ Cache MISS: ${cacheKey}`);
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  static async set(cacheKey, value, ttl = CACHE_TTL) {
    try {
      // Store in Redis if available
      if (redisClient && redisClient.isReady) {
        await redisClient.setEx(cacheKey, ttl, value);
        console.log(`💾 Cached to Redis: ${cacheKey} (TTL: ${ttl}s)`);
      }

      // Always store in memory cache as backup
      signedUrlCache.set(cacheKey, value, ttl);
      console.log(`💾 Cached to Memory: ${cacheKey} (TTL: ${ttl}s)`);
    } catch (error) {
      console.error('Cache set error:', error);
      // Continue execution even if caching fails
    }
  }

  static async del(cacheKey) {
    try {
      if (redisClient && redisClient.isReady) {
        await redisClient.del(cacheKey);
      }
      signedUrlCache.del(cacheKey);
      console.log(`🗑️ Cache DELETED: ${cacheKey}`);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  static getStats() {
    const memoryStats = signedUrlCache.getStats();
    return {
      memory: {
        keys: memoryStats.keys,
        hits: memoryStats.hits,
        misses: memoryStats.misses,
        hitRate: memoryStats.hits / (memoryStats.hits + memoryStats.misses) || 0
      },
      redis: redisClient && redisClient.isReady ? 'connected' : 'disconnected'
    };
  }
}

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

// Cache statistics endpoint
app.get('/cache-stats', (req, res) => {
  try {
    const stats = CacheService.getStats();
    res.status(200).json({
      success: true,
      cache: stats,
      config: {
        cacheTTL: CACHE_TTL,
        maxCacheKeys: MAX_CACHE_KEYS,
        checkPeriod: CACHE_CHECK_PERIOD
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve cache statistics'
    });
  }
});

// Clear cache endpoint (for debugging/maintenance)
app.post('/clear-cache', (req, res) => {
  try {
    const { pattern } = req.body;
    
    if (pattern) {
      // Clear specific pattern (basic implementation)
      const memoryKeys = signedUrlCache.keys();
      const matchingKeys = memoryKeys.filter(key => key.includes(pattern));
      
      matchingKeys.forEach(key => {
        signedUrlCache.del(key);
      });
      
      res.json({
        success: true,
        message: `Cleared ${matchingKeys.length} cache entries matching pattern: ${pattern}`,
        clearedKeys: matchingKeys.length
      });
    } else {
      // Clear all cache
      signedUrlCache.flushAll();
      if (redisClient && redisClient.isReady) {
        redisClient.flushAll().catch(err => console.error('Redis flush error:', err));
      }
      
      res.json({
        success: true,
        message: 'All cache cleared'
      });
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache'
    });
  }
});

// Get signed download URL with caching
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
    
    // Generate cache key
    const cacheKey = CacheService.generateCacheKey(process.env.R2_BUCKET, sanitizedFile, 'get');
    
    // Check cache first
    const cachedResponse = await CacheService.get(cacheKey);
    if (cachedResponse) {
      const cached = JSON.parse(cachedResponse);
      // Check if cached URL is still valid (with 5 minute buffer before expiry)
      const expiryTime = new Date(cached.expiresAt).getTime();
      const bufferTime = 5 * 60 * 1000; // 5 minutes
      
      if (Date.now() < (expiryTime - bufferTime)) {
        console.log(`🚀 Serving cached signed URL for: ${sanitizedFile}`);
        return res.json({
          ...cached,
          fromCache: true,
          cacheKey
        });
      } else {
        // URL is close to expiry, remove from cache
        await CacheService.del(cacheKey);
        console.log(`⏰ Cached URL expired for: ${sanitizedFile}`);
      }
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
    console.log(`🔄 Generating new signed URL for: ${sanitizedFile}`);
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
      // iOS-compatible options - avoid problematic query parameters
      signableHeaders: new Set(['host']), // Only sign host header
    });

    const response = {
      success: true,
      signedUrl,
      file: sanitizedFile,
      contentType: responseContentType,
      expiresIn: 3600,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      fromCache: false
    };

    // Cache the response
    await CacheService.set(cacheKey, JSON.stringify(response), CACHE_TTL);

    res.json(response);

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

    // Invalidate cache for this file
    const cacheKey = CacheService.generateCacheKey(process.env.R2_BUCKET, sanitizedFile, 'get');
    await CacheService.del(cacheKey);

    console.log(`Successfully deleted file: ${sanitizedFile}`);

    res.json({
      success: true,
      message: 'File deleted successfully',
      file: sanitizedFile,
      deletedAt: new Date().toISOString(),
      cacheInvalidated: true
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
      'DELETE /deleteFile',
      'GET /cache-stats',
      'POST /clear-cache',
      'POST /invalidate-cache'
    ]
  });
});

// Invalidate cache for uploaded files
app.post('/invalidate-cache', (req, res) => {
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

    // Sanitize file path
    const sanitizedFile = file.replace(/\.\./g, '').trim();
    
    // Invalidate cache for this file
    const cacheKey = CacheService.generateCacheKey(process.env.R2_BUCKET, sanitizedFile, 'get');
    CacheService.del(cacheKey);

    res.json({
      success: true,
      message: 'Cache invalidated successfully',
      file: sanitizedFile,
      cacheKey,
      invalidatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error invalidating cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to invalidate cache',
      message: error.message
    });
  }
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
