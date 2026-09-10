const path = require('path');
require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Storage paths
const TEMP_DIR = process.env.TEMP_DIR 
  ? path.resolve(process.env.TEMP_DIR)
  : path.join(__dirname, '..', 'temp_downloads');

// Security & Constraints
const MAX_DOWNLOAD_SIZE_BYTES = parseInt(process.env.MAX_DOWNLOAD_SIZE_BYTES, 10) || 1024 * 1024 * 500; // 500MB default
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS, 10) || 1000 * 60 * 15; // 15 minutes
const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS, 10) || 1000 * 60 * 5; // 5 minutes
const MAX_CONCURRENT_DOWNLOADS = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS, 10) || 10;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000; // 15 mins
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100;

// Allowed protocols
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

const { execSync } = require('child_process');
const fs = require('fs');

// Auto-detect FFmpeg path (supports imageio_ffmpeg, system PATH, or env variable)
let FFMPEG_PATH = process.env.FFMPEG_PATH || null;
if (!FFMPEG_PATH) {
  try {
    const detected = execSync('python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"', {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000
    }).trim();
    if (detected && fs.existsSync(detected)) {
      FFMPEG_PATH = detected;
    }
  } catch (e) {
    FFMPEG_PATH = null;
  }
}

module.exports = {
  PORT,
  HOST,
  TEMP_DIR,
  MAX_DOWNLOAD_SIZE_BYTES,
  JOB_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  MAX_CONCURRENT_DOWNLOADS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  ALLOWED_PROTOCOLS,
  FFMPEG_PATH
};
