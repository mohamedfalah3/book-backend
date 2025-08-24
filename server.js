const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const NodeCache = require('node-cache');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error);
    console.log('⚠️ Books API endpoints will not work without Firebase credentials');
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Cache configuration
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS) || 3600; // 1 hour default (increased)
const SIGNED_URL_EXPIRY = parseInt(process.env.SIGNED_URL_EXPIRY_SECONDS) || 7200; // 2 hours signed URL expiry
const CACHE_CHECK_PERIOD = 60; // Check for expired keys every 60 seconds
const MAX_CACHE_KEYS = parseInt(process.env.MAX_CACHE_KEYS) || 5000; // Increased cache capacity
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS) || 50; // Reduced delay for faster processing

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

// NOTE: Rate limiting completely disabled for development and unlimited access
// This removes the 429 "Too Many Requests" errors that were blocking the app

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

  // Batch cache operations for high-volume scenarios
  static async setBatch(entries, ttl = CACHE_TTL) {
    try {
      if (redisClient && redisClient.isReady && entries.length > 0) {
        // Use Redis pipeline for batch operations
        const pipeline = redisClient.multi();
        entries.forEach(({ key, value }) => {
          pipeline.setEx(key, ttl, value);
        });
        await pipeline.exec();
        console.log(`💾 Batch cached ${entries.length} entries to Redis (TTL: ${ttl}s)`);
      }

      // Batch store in memory cache
      entries.forEach(({ key, value }) => {
        signedUrlCache.set(key, value, ttl);
      });
      console.log(`💾 Batch cached ${entries.length} entries to Memory (TTL: ${ttl}s)`);
    } catch (error) {
      console.error('Batch cache set error:', error);
      // Fall back to individual caching
      for (const { key, value } of entries) {
        await this.set(key, value, ttl);
      }
    }
  }

  static async getBatch(cacheKeys) {
    const results = new Map();
    
    try {
      if (redisClient && redisClient.isReady && cacheKeys.length > 0) {
        // Use Redis pipeline for batch get
        const pipeline = redisClient.multi();
        cacheKeys.forEach(key => pipeline.get(key));
        const redisResults = await pipeline.exec();
        
        cacheKeys.forEach((key, index) => {
          const result = redisResults[index];
          if (result && result[1]) {
            results.set(key, result[1]);
            console.log(`✅ Batch Cache HIT (Redis): ${key}`);
          }
        });
      }

      // Check memory cache for any missed keys
      cacheKeys.forEach(key => {
        if (!results.has(key)) {
          const cached = signedUrlCache.get(key);
          if (cached) {
            results.set(key, cached);
            console.log(`✅ Batch Cache HIT (Memory): ${key}`);
          } else {
            console.log(`❌ Batch Cache MISS: ${key}`);
          }
        }
      });

      return results;
    } catch (error) {
      console.error('Batch cache get error:', error);
      // Fall back to individual gets
      for (const key of cacheKeys) {
        const value = await this.get(key);
        if (value) {
          results.set(key, value);
        }
      }
      return results;
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
      expiresIn: SIGNED_URL_EXPIRY, // 2 hours (configurable)
      // iOS-compatible options - avoid problematic query parameters
      signableHeaders: new Set(['host']), // Only sign host header
    });

    const response = {
      success: true,
      signedUrl,
      file: sanitizedFile,
      contentType: responseContentType,
      expiresIn: SIGNED_URL_EXPIRY,
      expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRY * 1000).toISOString(),
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
      expiresIn: SIGNED_URL_EXPIRY, // 2 hours (configurable)
      // iOS-compatible options - minimal query parameters
      signableHeaders: new Set(['host']), // Only sign host header
    });

    res.json({
      success: true,
      signedUrl,
      file: sanitizedFile,
      contentType: responseContentType,
      expiresIn: SIGNED_URL_EXPIRY,
      expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRY * 1000).toISOString(),
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

// Batch signed URLs endpoint for multiple files
app.post('/getBatchSignedUrls', async (req, res) => {
  try {
    const { files, batchSize = 15 } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        error: 'Files array is required',
        example: { files: ['books/cover1.jpg', 'books/cover2.jpg'] }
      });
    }

    // Increased maximum for high-volume scenarios
    if (files.length > 500) {
      return res.status(400).json({
        error: 'Maximum 500 files per batch request. For larger batches, split into multiple requests.'
      });
    }

    console.log(`📦 Processing high-volume batch request for ${files.length} files (batch size: ${batchSize})`);
    
    const results = [];
    const errors = [];
    const startTime = Date.now();
    
    // Process files in optimized batches
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      console.log(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(files.length / batchSize)}`);
      
      const batchPromises = batch.map(async (file) => {
        try {
          // Validate file parameter
          if (typeof file !== 'string' || file.trim() === '') {
            return { file, error: 'Invalid file parameter' };
          }

          // Sanitize file path
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
              console.log(`🚀 Batch: Serving cached signed URL for: ${sanitizedFile}`);
              return {
                ...cached,
                fromCache: true,
                file: sanitizedFile
              };
            } else {
              // URL is close to expiry, remove from cache
              await CacheService.del(cacheKey);
              console.log(`⏰ Batch: Cached URL expired for: ${sanitizedFile}`);
            }
          }
          
          // Determine content type based on file extension
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

          // Generate signed URL
          console.log(`🔄 Batch: Generating new signed URL for: ${sanitizedFile}`);
          const signedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: SIGNED_URL_EXPIRY, // 2 hours (configurable)
            signableHeaders: new Set(['host']),
          });

          const response = {
            success: true,
            signedUrl,
            file: sanitizedFile,
            contentType: responseContentType,
            expiresIn: SIGNED_URL_EXPIRY,
            expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRY * 1000).toISOString(),
            fromCache: false
          };

          // Cache the response
          await CacheService.set(cacheKey, JSON.stringify(response), CACHE_TTL);

          return response;

        } catch (error) {
          console.error(`Error processing file ${file}:`, error);
          return { 
            file, 
            error: error.message || 'Failed to generate signed URL',
            success: false
          };
        }
      });

      // Wait for current batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Separate successful results from errors
      batchResults.forEach(result => {
        if (result.success !== false) {
          results.push(result);
        } else {
          errors.push(result);
        }
      });

      // Smart delay between batches - shorter delay for smaller batches
      if (i + batchSize < files.length) {
        const delayMs = Math.max(BATCH_DELAY_MS, Math.min(200, batchSize * 10));
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    const processingTime = Date.now() - startTime;
    const avgTimePerFile = processingTime / files.length;
    
    console.log(`✅ High-volume batch completed: ${results.length} successful, ${errors.length} errors in ${processingTime}ms`);

    res.json({
      success: true,
      results,
      errors,
      stats: {
        total: files.length,
        successful: results.length,
        failed: errors.length,
        cached: results.filter(r => r.fromCache).length,
        fresh: results.filter(r => !r.fromCache).length,
        performance: {
          totalTimeMs: processingTime,
          avgTimePerFileMs: Math.round(avgTimePerFile * 100) / 100,
          throughputFilesPerSecond: Math.round((files.length / processingTime) * 1000 * 100) / 100
        }
      },
      processedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in batch signed URL generation:', error);
    res.status(500).json({
      error: 'Failed to process batch request',
      message: error.message || 'Internal server error'
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
      expiresIn: SIGNED_URL_EXPIRY, // 2 hours (configurable)
      // iOS-compatible options - avoid problematic query parameters
      signableHeaders: new Set(['host']), // Only sign host header
    });

    res.json({
      success: true,
      signedUrl,
      file: sanitizedFile,
      contentType,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      expiresIn: SIGNED_URL_EXPIRY,
      expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRY * 1000).toISOString()
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
      'POST /getBatchSignedUrls - Batch processing for multiple files',
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

// Books summary cache and pagination
const booksCache = new Map();
const BOOKS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// New route: Get paginated books summary
app.get('/api/books-summary', async (req, res) => {
  try {
    // Check if Firebase is available
    if (!admin.apps.length || !admin.firestore) {
      console.error('❌ Firebase not available for books summary');
      return res.status(503).json({ 
        error: 'Books service temporarily unavailable',
        message: 'Firebase connection not established'
      });
    }

    const { page = 1, limit = 20, lastBookId } = req.query;
    const pageSize = Math.min(parseInt(limit), 50); // Max 50 per page
    
    // Check cache first
    const cacheKey = `books_summary_${page}_${pageSize}_${lastBookId || 'first'}`;
    const cached = booksCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < BOOKS_CACHE_TTL) {
      console.log('📚 Returning cached books summary');
      return res.json(cached.data);
    }

    console.log(`🔄 Fetching books summary: page ${page}, limit ${pageSize}`);
    
    // Get books from Firestore with pagination
    let query = admin.firestore()
      .collection('books')
      .orderBy('updatedAt', 'desc')
      .limit(pageSize);
    
    // If we have a lastBookId, start after it
    if (lastBookId) {
      const lastBookDoc = await admin.firestore()
        .collection('books')
        .doc(lastBookId)
        .get();
      
      if (lastBookDoc.exists) {
        query = query.startAfter(lastBookDoc);
      }
    }
    
    const snapshot = await query.get();
    const books = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      books.push({
        id: doc.id,
        title: data.title,
        author: data.author,
        genre: data.genre,
        coverImage: data.coverImage,
        duration: data.duration,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        // Only essential fields for listing
      });
    });
    
    const result = {
      books,
      hasMore: books.length === pageSize,
      nextPage: books.length === pageSize ? parseInt(page) + 1 : null,
      lastBookId: books.length > 0 ? books[books.length - 1].id : null,
      totalFetched: books.length,
      page: parseInt(page),
      pageSize
    };
    
    // Cache the result
    booksCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });
    
    console.log(`✅ Fetched ${books.length} books for page ${page}`);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error fetching books summary:', error);
    
    // Check if it's a Firebase connection error
    if (error.code === 'app/no-app' || error.code === 'app/duplicate-app') {
      return res.status(503).json({ 
        error: 'Books service temporarily unavailable',
        message: 'Firebase connection issue'
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// New route: Get single book by ID (for detail view)
app.get('/api/books/:id', async (req, res) => {
  try {
    // Check if Firebase is available
    if (!admin.apps.length || !admin.firestore) {
      console.error('❌ Firebase not available for single book');
      return res.status(503).json({ 
        error: 'Book service temporarily unavailable',
        message: 'Firebase connection not established'
      });
    }

    const { id } = req.params;
    
    // Check cache first
    const cacheKey = `book_${id}`;
    const cached = booksCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < BOOKS_CACHE_TTL) {
      console.log(`📚 Returning cached book: ${id}`);
      return res.json(cached.data);
    }
    
    console.log(`🔄 Fetching book: ${id}`);
    
    const doc = await admin.firestore()
      .collection('books')
      .doc(id)
      .get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    const bookData = doc.data();
    const book = {
      id: doc.id,
      ...bookData,
      updatedAt: bookData.updatedAt?.toDate?.() || bookData.updatedAt,
    };
    
    // Cache the result
    booksCache.set(cacheKey, {
      data: book,
      timestamp: Date.now()
    });
    
    console.log(`✅ Fetched book: ${book.title}`);
    res.json(book);
    
  } catch (error) {
    console.error('❌ Error fetching book:', error);
    
    // Check if it's a Firebase connection error
    if (error.code === 'app/no-app' || error.code === 'app/duplicate-app') {
      return res.status(503).json({ 
        error: 'Book service temporarily unavailable',
        message: 'Firebase connection issue'
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

// Fallback books endpoint when Firebase is not available
app.get('/api/books-fallback', (req, res) => {
  console.log('📚 Serving fallback books data (Firebase not available)');
  
  const fallbackBooks = [
    {
      id: 'fallback-1',
      title: 'Sample Book 1',
      author: 'Sample Author',
      genre: 'Fiction',
      coverImage: 'https://via.placeholder.com/300x400/cccccc/666666?text=Book+1',
      duration: 3600,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'fallback-2',
      title: 'Sample Book 2',
      author: 'Sample Author',
      genre: 'Non-Fiction',
      coverImage: 'https://via.placeholder.com/300x400/cccccc/666666?text=Book+2',
      duration: 7200,
      updatedAt: new Date().toISOString(),
    }
  ];
  
  res.json({
    books: fallbackBooks,
    hasMore: false,
    nextPage: null,
    lastBookId: null,
    totalFetched: fallbackBooks.length,
    page: 1,
    pageSize: fallbackBooks.length,
    fallback: true,
    message: 'Using fallback data - Firebase not available'
  });
});

// Enhanced signed URL batching and caching
const BATCH_SIZE = 5; // Process 5 URLs at a time
const BATCH_DELAY = 100; // 100ms delay between batches

// Helper: Generate signed URL with retry logic
async function generateSignedUrl(key, retries = 3) {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { success: true, url, key };
  } catch (error) {
    if (error.name === 'TooManyRequestsException' && retries > 0) {
      console.log(`🔄 R2 rate limited for ${key}, retrying in ${(4 - retries) * 1000}ms...`);
      await new Promise(resolve => setTimeout(resolve, (4 - retries) * 1000));
      return generateSignedUrl(key, retries - 1);
    }
    return { success: false, error: error.message, key };
  }
}

// Helper: Process URL batch with delay
async function processUrlBatch(keys, batchIndex) {
  if (batchIndex > 0) {
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
  }
  
  console.log(`🔄 Processing batch ${batchIndex + 1}: ${keys.length} URLs`);
  const promises = keys.map(key => generateSignedUrl(key));
  return Promise.all(promises);
}

// Enhanced batch signed URLs route
app.post('/api/signed-urls', async (req, res) => {
  try {
    const { keys } = req.body;
    
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'Keys array is required' });
    }
    
    if (keys.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 keys per request' });
    }
    
    console.log(`🔄 Requesting ${keys.length} signed URLs`);
    
    // Check cache first
    const cachedUrls = {};
    const uncachedKeys = [];
    
    keys.forEach(key => {
      const cached = signedUrlCache.get(key);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL * 1000) {
        cachedUrls[key] = cached.url;
      } else {
        uncachedKeys.push(key);
      }
    });
    
    console.log(`📚 Cache hit: ${Object.keys(cachedUrls).length}, Miss: ${uncachedKeys.length}`);
    
    let newUrls = {};
    
    if (uncachedKeys.length > 0) {
      // Process in batches to avoid R2 rate limits
      const batches = [];
      for (let i = 0; i < uncachedKeys.length; i += BATCH_SIZE) {
        batches.push(uncachedKeys.slice(i, i + BATCH_SIZE));
      }
      
      console.log(`🔄 Processing ${uncachedKeys.length} URLs in ${batches.length} batches`);
      
      for (let i = 0; i < batches.length; i++) {
        const batchResults = await processUrlBatch(batches[i], i);
        
        batchResults.forEach(result => {
          if (result.success) {
            newUrls[result.key] = result.url;
            // Cache the new URL
            signedUrlCache.set(result.key, result.url);
          } else {
            console.error(`❌ Failed to generate URL for ${result.key}:`, result.error);
          }
        });
      }
    }
    
    // Combine cached and new URLs
    const allUrls = { ...cachedUrls, ...newUrls };
    
    // Set cache headers
    res.set({
      'Cache-Control': 'private, max-age=600', // 10 minutes
      'X-Cache-Hit-Ratio': `${Object.keys(cachedUrls).length / keys.length}`,
      'X-Urls-Generated': Object.keys(newUrls).length.toString(),
    });
    
    console.log(`✅ Generated ${Object.keys(allUrls).length} signed URLs`);
    res.json({ urls: allUrls });
    
  } catch (error) {
    console.error('❌ Error generating signed URLs:', error);
    res.status(500).json({ error: 'Failed to generate signed URLs' });
  }
});

// Metrics collection
const metrics = {
  signedUrlRequests: 0,
  signedUrlCacheHits: 0,
  signedUrlCacheMisses: 0,
  r2RateLimitHits: 0,
  averageResponseTime: 0,
  totalRequests: 0,
};

// Middleware to collect metrics
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.totalRequests++;
    metrics.averageResponseTime = 
      (metrics.averageResponseTime * (metrics.totalRequests - 1) + duration) / metrics.totalRequests;
  });
  
  next();
});

// Metrics endpoint
app.get('/api/metrics', (req, res) => {
  const cacheHitRatio = metrics.signedUrlRequests > 0 
    ? (metrics.signedUrlCacheHits / metrics.signedUrlRequests * 100).toFixed(2)
    : 0;
    
  res.json({
    signedUrls: {
      totalRequests: metrics.signedUrlRequests,
      cacheHits: metrics.signedUrlCacheHits,
      cacheMisses: metrics.signedUrlCacheMisses,
      cacheHitRatio: `${cacheHitRatio}%`,
      r2RateLimitHits: metrics.r2RateLimitHits,
    },
    performance: {
      averageResponseTime: `${metrics.averageResponseTime.toFixed(2)}ms`,
      totalRequests: metrics.totalRequests,
    },
    cache: {
      booksCacheSize: booksCache.size,
      signedUrlCacheSize: signedUrlCache.size,
    },
    timestamp: new Date().toISOString(),
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
