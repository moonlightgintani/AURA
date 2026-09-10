const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const IS_WIN = process.platform === 'win32';
const LOCAL_BINARY = path.join(BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');

/**
 * Ensures yt-dlp binary is available, automatically downloading it if not present.
 */
async function ensureYtDlp() {
  // 1. Check if custom path is defined in env
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return { cmd: process.env.YTDLP_PATH, baseArgs: [] };
  }
  if (process.env.PYTHON_PATH) {
    return { cmd: process.env.PYTHON_PATH, baseArgs: ['-m', 'yt_dlp'] };
  }

  // 2. Check if yt-dlp exists in PATH
  try {
    execSync('yt-dlp --version', { stdio: 'ignore', timeout: 2000, windowsHide: true });
    return { cmd: 'yt-dlp', baseArgs: [] };
  } catch (e) {}

  // 3. Check if python3 has yt_dlp
  try {
    execSync('python3 -c "import yt_dlp"', { stdio: 'ignore', timeout: 2000, windowsHide: true });
    return { cmd: 'python3', baseArgs: ['-m', 'yt_dlp'] };
  } catch (e) {}

  // 4. Check if python has yt_dlp
  try {
    execSync('python -c "import yt_dlp"', { stdio: 'ignore', timeout: 2000, windowsHide: true });
    return { cmd: 'python', baseArgs: ['-m', 'yt_dlp'] };
  } catch (e) {}

  // 5. Check if local binary in server/bin exists
  if (fs.existsSync(LOCAL_BINARY)) {
    try {
      if (!IS_WIN) {
        fs.chmodSync(LOCAL_BINARY, 0o755);
      }
      return { cmd: LOCAL_BINARY, baseArgs: [] };
    } catch (e) {}
  }

  // 6. Automatically download standalone yt-dlp binary from GitHub Releases
  try {
    if (!fs.existsSync(BIN_DIR)) {
      fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    const downloadUrl = IS_WIN
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

    console.log(`[AURA] Auto-fetching standalone yt-dlp binary to ${LOCAL_BINARY}...`);
    await downloadFileWithRedirects(downloadUrl, LOCAL_BINARY);

    if (!IS_WIN) {
      fs.chmodSync(LOCAL_BINARY, 0o755);
    }
    console.log('[AURA] yt-dlp binary ready.');
    return { cmd: LOCAL_BINARY, baseArgs: [] };
  } catch (err) {
    console.warn(`[AURA] Fallback to python3: ${err.message}`);
    return { cmd: 'python3', baseArgs: ['-m', 'yt_dlp'] };
  }
}

/**
 * Downloads a file handling GitHub 302 redirects.
 */
function downloadFileWithRedirects(sourceUrl, destPath) {
  return new Promise((resolve, reject) => {
    https.get(sourceUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFileWithRedirects(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download binary: HTTP ${res.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(destPath);
      });

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

module.exports = {
  ensureYtDlp
};
