const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { TEMP_DIR, JOB_TIMEOUT_MS, CLEANUP_INTERVAL_MS } = require('../config');

// Ensure temp download directory exists
if (!fs.existsSync(TEMP_DIR)) {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  } catch (err) {
    console.error(`Failed to create temp directory at ${TEMP_DIR}:`, err);
  }
}

// In-memory jobs store
const jobs = new Map();

/**
 * Creates a new download job record.
 */
function createJob({ url, title, formatId, ext, quality }) {
  const jobId = uuidv4();
  const job = {
    id: jobId,
    status: 'queued', // queued, downloading, completed, failed, cancelled
    url,
    title: title || 'video',
    formatId: formatId || 'best',
    ext: ext || 'mp4',
    quality: quality || '720p',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: '0 KB/s',
    eta: '--:--',
    filePath: null,
    fileName: null,
    fileSize: 0,
    error: null,
    childProcess: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  jobs.set(jobId, job);
  return job;
}

/**
 * Retrieves a job by ID.
 */
function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/**
 * Updates a job's properties.
 */
function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (!job) return null;

  Object.assign(job, updates, { updatedAt: Date.now() });
  return job;
}

/**
 * Cancels a job and terminates any running process.
 */
function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;

  if (job.childProcess) {
    try {
      job.childProcess.kill('SIGTERM');
      // On Windows sometimes SIGKILL / tree-kill is needed if subshell is spawned
      setTimeout(() => {
        try {
          if (job.childProcess && !job.childProcess.killed) {
            job.childProcess.kill('SIGKILL');
          }
        } catch (e) {}
      }, 1000);
    } catch (e) {
      console.warn(`Error killing process for job ${jobId}:`, e.message);
    }
  }

  job.status = 'cancelled';
  job.updatedAt = Date.now();
  job.childProcess = null;

  // Clean partial files if present
  cleanupJobFiles(job);
  return true;
}

/**
 * Deletes files associated with a job from disk.
 */
function cleanupJobFiles(job) {
  if (job.filePath && fs.existsSync(job.filePath)) {
    try {
      fs.unlinkSync(job.filePath);
    } catch (err) {
      console.warn(`Failed to unlink file ${job.filePath}:`, err.message);
    }
  }

  // Also clean any .part or .temp files in TEMP_DIR matching jobId
  try {
    const files = fs.readdirSync(TEMP_DIR);
    for (const f of files) {
      if (f.startsWith(job.id)) {
        const fullPath = path.join(TEMP_DIR, f);
        try {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
}

/**
 * Periodically cleans up expired jobs and orphaned files.
 */
function cleanupExpiredJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    const age = now - job.createdAt;
    if (age > JOB_TIMEOUT_MS) {
      // Clean disk files
      cleanupJobFiles(job);
      // Remove from map
      jobs.delete(jobId);
    }
  }

  // Also clean any leftover orphaned files in TEMP_DIR older than JOB_TIMEOUT_MS
  try {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      const fullPath = path.join(TEMP_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > JOB_TIMEOUT_MS) {
          fs.unlinkSync(fullPath);
        }
      } catch (e) {}
    }
  } catch (e) {}
}

// Start periodic cleanup timer
setInterval(cleanupExpiredJobs, CLEANUP_INTERVAL_MS);

module.exports = {
  createJob,
  getJob,
  updateJob,
  cancelJob,
  cleanupJobFiles,
  jobs
};
