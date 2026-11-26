export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || 'v1',
  corsOrigins: process.env.CORS_ORIGINS || '*',
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/the_dry_clean?replicaSet=rs0',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'atelier_default_secret_key',
    expiresIn: process.env.JWT_EXPIRATION || '15m',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d',
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
  },
  payments: {
    adapter: process.env.PAYMENT_ADAPTER || 'mock',
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_atelier_mock_key',
      keySecret: process.env.RAZORPAY_KEY_SECRET || 'atelier_mock_secret',
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || 'atelier_mock_webhook_secret',
    },
  },
  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    localPath: process.env.STORAGE_LOCAL_PATH || 'uploads',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    bucket: process.env.AWS_S3_BUCKET || 'atelier-proofs-private',
    region: process.env.AWS_REGION || 'ap-south-1',
    endpoint: process.env.AWS_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'atelier_mock_access_key',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'atelier_mock_secret_access_key',
    signedUrlExpirySeconds: parseInt(process.env.STORAGE_SIGNED_URL_EXPIRY || '900', 10),
    maxFileSize: parseInt(process.env.STORAGE_MAX_FILE_SIZE || '5242880', 10), // 5MB in bytes
    minWidth: 800,
    minHeight: 600,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
  },
});
