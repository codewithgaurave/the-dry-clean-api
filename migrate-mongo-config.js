// migrate-mongo-config.js
// Database migration configuration for The Dry Cleaner
// Source of truth: TECH_STACK.md §4.1, §7.1, §7.2

require('dotenv').config();

const config = {
  mongodb: {
    url:
      process.env.MONGODB_URI ||
      'mongodb://localhost:27017/the_dry_clean?replicaSet=rs0',
    options: {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 5000,
    },
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};

module.exports = config;

