const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
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

// Detect Python / yt-dlp binary (supports yt-dlp CLI, python3, python, or custom path)
function getExtractorCmd() {
  if (process.env.YTDLP_PATH) {
    return { cmd: process.env.YTDLP_PATH, baseArgs: [] };
  }
  if (process.env.PYTHON_PATH) {
    return { cmd: process.env.PYTHON_PATH, baseArgs: ['-m', 'yt_dlp'] };
  }

  // 1. Check if standalone yt-dlp CLI is available
  try {
    execSync('yt-dlp --version', { stdio: 'ignore', timeout: 2000, windowsHide: true });
    return { cmd: 'yt-dlp', baseArgs: [] };
  } catch (e) {}

  // 2. Check python3
  try {
    execSync('python3 -c "import yt_dlp"', { stdio: 'ignore', timeout: 2000, windowsHide: true });
    return { cmd: 'python3', baseArgs: ['-m', 'yt_dlp'] };
  } catch (e) {}

  // 3. Check python
  try {
    execSync('python -c "import yt_dlp"', { stdio: 'ignore', timeout: 2000, windowsHide: true });
    return { cmd: 'python', baseArgs: ['-m', 'yt_dlp'] };
  } catch (e) {}

  // Fallback default
  return { cmd: 'python3', baseArgs: ['-m', 'yt_dlp'] };
}

// Auto-detect FFmpeg path (supports system PATH, imageio_ffmpeg, or env variable)
let FFMPEG_PATH = process.env.FFMPEG_PATH || null;
if (!FFMPEG_PATH) {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 2000, windowsHide: true });
    FFMPEG_PATH = 'ffmpeg';
  } catch (e) {
    try {
      const detected = execSync('python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"', {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 3000
      }).trim();
      if (detected && fs.existsSync(detected)) {
        FFMPEG_PATH = detected;
      }
    } catch (e2) {
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
      } catch (e3) {
        FFMPEG_PATH = null;
      }
    }
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
  FFMPEG_PATH,
  getExtractorCmd
};
