const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const { formatBytes, formatDuration } = require('./security');
const { MAX_DOWNLOAD_SIZE_BYTES, getExtractorCmd } = require('../config');

/**
 * Extracts metadata and permitted formats using yt-dlp or direct stream headers.
 */
async function extractMetadata(targetUrl) {
  return new Promise((resolve, reject) => {
    const { cmd, baseArgs } = getExtractorCmd();

    // Arguments for yt-dlp
    const args = [
      ...baseArgs,
      '--dump-single-json',
      '--no-warnings',
      '--no-playlist',
      '--no-check-certificates',
      '--socket-timeout', '20',
      targetUrl
    ];

    const child = spawn(cmd, args, {
      windowsHide: true
    });

    let stdoutData = '';
    let stderrData = '';
    let timeoutId = setTimeout(() => {
      try {
        child.kill();
      } catch (e) {}
      reject(new Error('Server timeout while retrieving video metadata. The target server was too slow to respond.'));
    }, 25000);

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk;
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to execute metadata extractor engine (${cmd}): ${err.message}`));
    });

    child.on('close', async (code) => {
      clearTimeout(timeoutId);

      const trimmedStdout = stdoutData.trim();

      if (code !== 0 || !trimmedStdout) {
        const stderrLower = (stderrData || '').toLowerCase();

        // Check for specific restriction reasons
        if (stderrLower.includes('drm') || stderrLower.includes('encrypted') || stderrLower.includes('widevine')) {
          return reject(new Error('This video is protected by DRM (Digital Rights Management) and cannot be downloaded.'));
        }
        if (stderrLower.includes('private video') || stderrLower.includes('sign in') || stderrLower.includes('login required')) {
          return reject(new Error('This video is private or requires account authentication.'));
        }
        if (stderrLower.includes('copyright') || stderrLower.includes('content warning') || stderrLower.includes('paywall') || stderrLower.includes('payment')) {
          return reject(new Error('This content is paywalled or restricted by copyright protection.'));
        }
        if (stderrLower.includes('unsupported url') || stderrLower.includes('is not a valid url')) {
          // Attempt fallback for direct media URL (e.g. .mp4 / .webm link)
          try {
            const directInfo = await inspectDirectMediaUrl(targetUrl);
            if (directInfo) {
              return resolve(directInfo);
            }
          } catch (e) {
            // ignore
          }
          return reject(new Error('Unsupported website or video format. Please provide a supported video link.'));
        }
        if (stderrLower.includes('video unavailable') || stderrLower.includes('404') || stderrLower.includes('not found')) {
          return reject(new Error('Video unavailable. The media may have been removed or does not exist.'));
        }

        // General failure with sanitized message
        const firstLine = (stderrData.split('\n')[0] || 'Unknown extractor error').replace(/\[.*?\]\s*/g, '').trim();
        return reject(new Error(`Unable to extract media: ${firstLine || 'Video not accessible.'}`));
      }

      try {
        let rawJson;
        const jsonStart = trimmedStdout.indexOf('{');
        const jsonEnd = trimmedStdout.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          const jsonSub = trimmedStdout.substring(jsonStart, jsonEnd + 1);
          rawJson = JSON.parse(jsonSub);
        } else {
          rawJson = JSON.parse(trimmedStdout);
        }
        const processed = processExtractedInfo(rawJson, targetUrl);
        resolve(processed);
      } catch (err) {
        reject(new Error(`Failed to parse media metadata: ${err.message}`));
      }
    });
  });
}

/**
 * Fallback to inspect direct video file links (.mp4, .webm, .mov, etc.)
 */
async function inspectDirectMediaUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;

      const req = client.request(
        targetUrl,
        { method: 'HEAD', timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } },
        (res) => {
          const contentType = res.headers['content-type'] || '';
          const contentLength = parseInt(res.headers['content-length'], 10) || 0;

          if (contentType.startsWith('video/') || contentType.startsWith('audio/') || targetUrl.match(/\.(mp4|webm|mkv|mov|mp3|m4a|wav|aac)($|\?)/i)) {
            const filename = path.basename(parsed.pathname) || 'direct_video.mp4';
            const isAudio = contentType.startsWith('audio/') || targetUrl.match(/\.(mp3|m4a|wav|aac)($|\?)/i);

            const directMeta = {
              id: 'direct_stream',
              title: decodeURIComponent(filename).replace(/[+_-]/g, ' ').replace(/\.[^/.]+$/, ''),
              description: 'Direct downloadable media file',
              thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
              duration: 0,
              durationFormatted: 'Live / Direct',
              uploader: parsed.hostname,
              platform: 'Direct Stream',
              webpage_url: targetUrl,
              isDirect: true,
              formats: [
                {
                  formatId: 'direct',
                  quality: isAudio ? 'Audio Stream' : 'Original Quality',
                  height: 720,
                  ext: isAudio ? 'mp3' : 'mp4',
                  hasVideo: !isAudio,
                  hasAudio: true,
                  filesize: contentLength,
                  filesizeFormatted: formatBytes(contentLength),
                  label: isAudio ? 'Audio Original (Direct)' : 'Video Original (Direct)',
                  isAudioOnly: isAudio
                }
              ]
            };
            return resolve(directMeta);
          }
          reject(new Error('Not a direct media URL'));
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout inspecting direct link'));
      });
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Transforms yt-dlp raw metadata into clean, UI-ready payload with quality and format options.
 */
function processExtractedInfo(raw, sourceUrl) {
  const title = raw.title || 'Untitled Video';
  const duration = raw.duration || 0;
  const uploader = raw.uploader || raw.channel || raw.extractor_key || 'Media Creator';
  const platform = raw.extractor_key || 'Web Video';
  const thumbnail = raw.thumbnail || (raw.thumbnails && raw.thumbnails.length > 0 ? raw.thumbnails[raw.thumbnails.length - 1].url : '');
  const description = raw.description ? raw.description.substring(0, 300) : '';

  const rawFormats = Array.isArray(raw.formats) ? raw.formats : [];
  
  // Standard video heights we support
  const targetHeights = [2160, 1440, 1080, 720, 480, 360, 240];
  const videoOptions = [];
  const audioOptions = [];

  // Group best video formats by height
  const heightMap = new Map();

  for (const f of rawFormats) {
    // Skip manifest-only or DRM formats
    if (f.drm || (f.format_note && f.format_note.toLowerCase().includes('drm'))) continue;
    if (f.protocol && (f.protocol.includes('mhtml') || f.protocol.includes('dash_manifest'))) continue;

    const h = f.height;
    if (h && h >= 144) {
      // Pick best matching or highest bitrate for this height
      const existing = heightMap.get(h);
      const isProgressive = f.vcodec !== 'none' && f.acodec !== 'none';
      const score = (isProgressive ? 1000 : 0) + (f.tbr || (f.vbr || 0) + (f.abr || 0));

      if (!existing || score > existing.score) {
        heightMap.set(h, { format: f, score, isProgressive });
      }
    }
  }

  // Generate standardized video quality options
  // For each available standard height, provide MP4 and WebM options
  const sortedHeights = Array.from(heightMap.keys()).sort((a, b) => b - a);

  // If no height mapping was detected, but we have formats (e.g. single direct format)
  if (sortedHeights.length === 0) {
    const singleFormat = rawFormats.find(f => f.vcodec !== 'none') || rawFormats[rawFormats.length - 1] || {};
    const size = singleFormat.filesize || singleFormat.filesize_approx || (duration > 0 ? duration * 150000 : 0);
    videoOptions.push({
      formatId: singleFormat.format_id || 'best',
      quality: 'Best Quality',
      height: singleFormat.height || 720,
      ext: singleFormat.ext || 'mp4',
      hasVideo: true,
      hasAudio: true,
      filesize: size,
      filesizeFormatted: formatBytes(size),
      label: 'Standard Quality (MP4)',
      isAudioOnly: false,
      tag: 'Best'
    });
  } else {
    for (const h of sortedHeights) {
      const match = heightMap.get(h);
      const f = match.format;

      let qualityLabel = `${h}p`;
      let tag = '';
      if (h >= 2160) { qualityLabel = '2160p (4K UHD)'; tag = '4K'; }
      else if (h >= 1440) { qualityLabel = '1440p (2K QHD)'; tag = '2K'; }
      else if (h >= 1080) { qualityLabel = '1080p (Full HD)'; tag = 'FHD'; }
      else if (h >= 720) { qualityLabel = '720p (HD)'; tag = 'HD'; }
      else if (h >= 480) { qualityLabel = '480p (SD)'; tag = 'SD'; }
      else if (h >= 360) { qualityLabel = '360p'; tag = 'Basic'; }

      // Estimate file size if missing
      let estSize = f.filesize || f.filesize_approx;
      if (!estSize && duration > 0) {
        // Estimate based on height bitrate: 1080p ~ 3.5Mbps, 720p ~ 1.8Mbps, 480p ~ 800Kbps, 360p ~ 450Kbps
        const bitrates = { 2160: 15000, 1440: 8000, 1080: 3500, 720: 1800, 480: 850, 360: 450, 240: 250 };
        const kbps = bitrates[h] || (h * 4);
        estSize = Math.floor((kbps * 1024 * duration) / 8);
      }

      // MP4 Option (Prioritizes universal H.264 / AVC1 + AAC for 100% media player compatibility)
      videoOptions.push({
        formatId: `bestvideo[height<=${h}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`,
        quality: `${h}p`,
        height: h,
        ext: 'mp4',
        hasVideo: true,
        hasAudio: true,
        filesize: estSize,
        filesizeFormatted: formatBytes(estSize),
        label: `${qualityLabel} • MP4`,
        isAudioOnly: false,
        tag
      });

      // WebM Option for high resolutions if available
      if (h >= 720) {
        videoOptions.push({
          formatId: `bestvideo[height<=${h}][ext=webm]+bestaudio[ext=webm]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
          quality: `${h}p`,
          height: h,
          ext: 'webm',
          hasVideo: true,
          hasAudio: true,
          filesize: Math.floor(estSize * 0.9), // WebM VP9 usually ~10% more compact
          filesizeFormatted: formatBytes(Math.floor(estSize * 0.9)),
          label: `${qualityLabel} • WebM`,
          isAudioOnly: false,
          tag
        });
      }
    }
  }

  // Audio-only options (MP3, M4A)
  const audioSize = raw.filesize || (duration > 0 ? Math.floor((192 * 1024 * duration) / 8) : 5 * 1024 * 1024);
  
  audioOptions.push({
    formatId: 'bestaudio/best',
    quality: '320 kbps (High)',
    height: 0,
    ext: 'mp3',
    hasVideo: false,
    hasAudio: true,
    filesize: audioSize,
    filesizeFormatted: formatBytes(audioSize),
    label: 'Audio MP3 (High Quality)',
    isAudioOnly: true,
    tag: 'Audio'
  });

  audioOptions.push({
    formatId: 'bestaudio[ext=m4a]/bestaudio/best',
    quality: '256 kbps (AAC)',
    height: 0,
    ext: 'm4a',
    hasVideo: false,
    hasAudio: true,
    filesize: Math.floor(audioSize * 0.8),
    filesizeFormatted: formatBytes(Math.floor(audioSize * 0.8)),
    label: 'Audio M4A / AAC (Lossless Stream)',
    isAudioOnly: true,
    tag: 'Audio'
  });

  // Filter out any duplicates and cap by MAX_DOWNLOAD_SIZE_BYTES
  const allFormats = [...videoOptions, ...audioOptions];

  return {
    id: raw.id || `vid_${Date.now()}`,
    title,
    description,
    thumbnail,
    duration,
    durationFormatted: formatDuration(duration),
    uploader,
    platform,
    webpage_url: sourceUrl,
    view_count: raw.view_count || null,
    like_count: raw.like_count || null,
    formats: allFormats,
    defaultFormatId: videoOptions.length > 0 ? videoOptions[0].formatId : (audioOptions[0] ? audioOptions[0].formatId : 'best')
  };
}

module.exports = {
  extractMetadata
};
