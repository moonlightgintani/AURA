const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { TEMP_DIR, MAX_DOWNLOAD_SIZE_BYTES, FFMPEG_PATH } = require('../config');
const { sanitizeFilename, formatBytes } = require('./security');
const { getJob, updateJob, cleanupJobFiles } = require('./jobManager');

/**
 * Starts a background download for a registered job.
 */
function startDownload(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  updateJob(jobId, { status: 'downloading', progress: 0 });

  const isAudioOnly = job.ext === 'mp3' || job.ext === 'm4a';
  const targetExt = job.ext || 'mp4';
  const outputTemplate = path.join(TEMP_DIR, `${jobId}.%(ext)s`);

  // Build yt-dlp arguments
  const args = [
    '-m', 'yt_dlp',
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--socket-timeout', '30',
    '--newline', // Output progress on new lines for easy regex parsing
    '--max-filesize', `${MAX_DOWNLOAD_SIZE_BYTES}`,
    '-o', outputTemplate
  ];

  // Attach FFmpeg location if available
  if (FFMPEG_PATH) {
    args.push('--ffmpeg-location', FFMPEG_PATH);
  }

  if (isAudioOnly) {
    args.push('-x');
    if (targetExt === 'mp3') {
      args.push('--audio-format', 'mp3');
      args.push('--audio-quality', '0');
    } else if (targetExt === 'm4a') {
      args.push('--audio-format', 'm4a');
    }
  } else {
    // Video format selector
    if (job.formatId && job.formatId !== 'best' && job.formatId !== 'direct') {
      args.push('-f', job.formatId);
    } else {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
    }
    // Set container preference
    if (targetExt === 'mp4') {
      args.push('--merge-output-format', 'mp4');
    } else if (targetExt === 'webm') {
      args.push('--merge-output-format', 'webm');
    }
  }

  args.push(job.url);

  const child = spawn('python', args, {
    windowsHide: true
  });

  job.childProcess = child;

  let stderrBuffer = '';

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      parseProgressLine(jobId, line);
    }
  });

  child.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
  });

  child.on('error', (err) => {
    updateJob(jobId, {
      status: 'failed',
      error: `Download process error: ${err.message}`,
      childProcess: null
    });
  });

  child.on('close', (code) => {
    job.childProcess = null;

    if (job.status === 'cancelled') {
      return;
    }

    if (code !== 0) {
      const errLower = stderrBuffer.toLowerCase();
      let userMsg = 'Download failed.';

      if (errLower.includes('file is larger than max-filesize') || errLower.includes('larger than')) {
        userMsg = `File exceeds maximum allowed limit of ${formatBytes(MAX_DOWNLOAD_SIZE_BYTES)}.`;
      } else if (errLower.includes('drm') || errLower.includes('protected')) {
        userMsg = 'Download rejected: Source content is DRM protected.';
      } else if (errLower.includes('forbidden') || errLower.includes('http error 403')) {
        userMsg = 'Access forbidden by source media server.';
      } else if (stderrBuffer.trim()) {
        userMsg = stderrBuffer.split('\n')[0].replace(/\[.*?\]\s*/g, '').trim() || userMsg;
      }

      cleanupJobFiles(job);
      updateJob(jobId, {
        status: 'failed',
        error: userMsg
      });
      return;
    }

    // Locate the finished output file in TEMP_DIR matching `${jobId}.*`
    try {
      const files = fs.readdirSync(TEMP_DIR);
      const matched = files.find(f => f.startsWith(jobId) && !f.endsWith('.part') && !f.endsWith('.ytdl'));

      if (!matched) {
        throw new Error('Downloaded file could not be located on server disk.');
      }

      const finalPath = path.join(TEMP_DIR, matched);
      const stats = fs.statSync(finalPath);
      const actualExt = path.extname(matched).replace('.', '') || targetExt;
      const safeTitle = sanitizeFilename(`${job.title}.${actualExt}`, actualExt);

      updateJob(jobId, {
        status: 'completed',
        progress: 100,
        filePath: finalPath,
        fileName: safeTitle,
        fileSize: stats.size,
        ext: actualExt,
        speed: 'Finished',
        eta: '00:00'
      });
    } catch (err) {
      updateJob(jobId, {
        status: 'failed',
        error: `Error finalizing downloaded file: ${err.message}`
      });
    }
  });
}

/**
 * Parses yt-dlp stdout progress lines e.g.:
 * [download]  42.5% of ~ 15.20MiB at  2.40MiB/s ETA 00:04
 * [download] 100% of 12.34MiB in 00:02
 */
function parseProgressLine(jobId, line) {
  if (!line || !line.includes('[download]')) return;

  const currentJob = getJob(jobId);
  if (!currentJob || currentJob.status === 'cancelled') return;

  // Percentage match
  const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
  let progress = currentJob.progress;
  if (percentMatch) {
    progress = parseFloat(percentMatch[1]);
    if (progress > 100) progress = 100;
  }

  // Speed match
  const speedMatch = line.match(/at\s+([~0-9.]+\s*[kKMGT]?i?B\/s)/);
  const speed = speedMatch ? speedMatch[1].trim() : currentJob.speed;

  // ETA match
  const etaMatch = line.match(/ETA\s+([0-9:]+)/);
  const eta = etaMatch ? etaMatch[1].trim() : currentJob.eta;

  // Size match
  const sizeMatch = line.match(/of\s+~?\s*([0-9.]+\s*[kKMGT]?i?B)/);
  let totalSizeStr = sizeMatch ? sizeMatch[1].trim() : null;

  updateJob(jobId, {
    progress,
    speed,
    eta,
    status: 'downloading'
  });
}

module.exports = {
  startDownload
};
