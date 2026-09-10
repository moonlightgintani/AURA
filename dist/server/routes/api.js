const express = require('express');
const fs = require('fs');
const path = require('path');
const { validateAndCheckSSRF, formatBytes } = require('../services/security');
const { extractMetadata } = require('../services/extractor');
const { createJob, getJob, cancelJob } = require('../services/jobManager');
const { startDownload } = require('../services/downloader');
const { MAX_DOWNLOAD_SIZE_BYTES } = require('../config');

const router = express.Router();

/**
 * POST /api/analyze
 * Analyzes a video URL, checks for SSRF, and extracts permitted formats.
 */
router.post('/analyze', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid video URL.'
      });
    }

    // SSRF & Protocol validation
    const validatedUrl = await validateAndCheckSSRF(url);

    // Extract metadata
    const metadata = await extractMetadata(validatedUrl);

    res.json({
      success: true,
      data: metadata
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to analyze video URL.'
    });
  }
});

/**
 * POST /api/download
 * Initiates a background download job with selected format and quality.
 */
router.post('/download', async (req, res) => {
  try {
    const { url, title, formatId, ext, quality } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid video URL to download.'
      });
    }

    // Re-verify SSRF
    const validatedUrl = await validateAndCheckSSRF(url);

    // Create job
    const job = createJob({
      url: validatedUrl,
      title,
      formatId,
      ext: ext || 'mp4',
      quality: quality || '720p'
    });

    // Start background download
    startDownload(job.id);

    res.status(202).json({
      success: true,
      jobId: job.id,
      message: 'Download job queued successfully.'
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to initialize download.'
    });
  }
});

/**
 * GET /api/progress/:jobId
 * Returns the current download progress and status for a job.
 */
router.get('/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Download job not found or expired.'
    });
  }

  res.json({
    success: true,
    job: {
      id: job.id,
      status: job.status,
      progress: Math.round(job.progress * 10) / 10,
      speed: job.speed,
      eta: job.eta,
      fileName: job.fileName,
      fileSize: job.fileSize,
      fileSizeFormatted: formatBytes(job.fileSize),
      ext: job.ext,
      error: job.error
    }
  });
});

/**
 * GET /api/file/:jobId
 * Streams the completed file to the user. Supports Range requests for video seeking.
 */
router.get('/file/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).send('Download job not found or has expired.');
  }

  if (job.status !== 'completed' || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(400).send('File is not ready or has been removed from server.');
  }

  const filePath = job.filePath;
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // Determine content type
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeTypes = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const downloadFilename = job.fileName || `video.${ext}`;

  // If client requested attachment download vs inline play
  const isDownload = req.query.download === '1' || req.query.download === 'true';

  if (range && !isDownload) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });

    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    // Send full file with attachment disposition
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadFilename)}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`);
    res.setHeader('Accept-Ranges', 'bytes');
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  }
});

/**
 * POST /api/cancel/:jobId
 * Cancels a running download job.
 */
router.post('/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  const success = cancelJob(jobId);

  if (!success) {
    return res.status(404).json({
      success: false,
      error: 'Job not found or already finished.'
    });
  }

  res.json({
    success: true,
    message: 'Download job was cancelled successfully.'
  });
});

/**
 * GET /api/health
 * Health and capabilities endpoint.
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    maxDownloadSize: MAX_DOWNLOAD_SIZE_BYTES,
    maxDownloadSizeFormatted: formatBytes(MAX_DOWNLOAD_SIZE_BYTES),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
