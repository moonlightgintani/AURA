const dns = require('dns').promises;
const path = require('path');
const url = require('url');
const ipaddr = require('ipaddr.js');
const { ALLOWED_PROTOCOLS } = require('../config');

/**
 * Validates a URL for format, protocol, and resolves its hostname to block SSRF targets.
 * Blocks private IP ranges, loopbacks, link-local, cloud metadata IP, and non-HTTP protocols.
 */
async function validateAndCheckSSRF(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Please provide a valid URL string.');
  }

  const trimmed = rawUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error('Invalid URL format. Please ensure it begins with http:// or https://');
  }

  // Enforce HTTP / HTTPS only
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Forbidden protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`);
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new Error('Invalid URL: missing hostname.');
  }

  // Reject obvious localhost and internal shortcuts directly
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.internal') ||
    lowerHost === '127.0.0.1' ||
    lowerHost === '0.0.0.0' ||
    lowerHost === '::1' ||
    lowerHost === '169.254.169.254' ||
    lowerHost === 'metadata.google.internal'
  ) {
    throw new Error('Access to local, private, or metadata network addresses is strictly prohibited.');
  }

  // Resolve DNS to verify IP addresses are public
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new Error(`Could not resolve hostname "${hostname}".`);
    }

    for (const record of addresses) {
      const ipStr = record.address;
      let parsedIp;
      try {
        parsedIp = ipaddr.parse(ipStr);
      } catch (e) {
        throw new Error(`Invalid IP resolution for hostname: ${ipStr}`);
      }

      const range = parsedIp.range();
      // Block non-unicast/private ranges
      const forbiddenRanges = [
        'unspecified',
        'broadcast',
        'linkLocal',
        'loopback',
        'private',
        'reserved',
        'carrierGradeNat',
        'uniqueLocal'
      ];

      if (forbiddenRanges.includes(range)) {
        throw new Error(`URL resolves to a restricted internal network address (${range}).`);
      }

      // Check IPv4 mapped in IPv6
      if (parsedIp.kind() === 'ipv6' && parsedIp.isIPv4MappedAddress()) {
        const v4 = parsedIp.toIPv4Address();
        if (forbiddenRanges.includes(v4.range())) {
          throw new Error('URL resolves to a restricted internal IPv4-mapped address.');
        }
      }
    }
  } catch (err) {
    if (err.message && err.message.includes('restricted internal network')) {
      throw err;
    }
    // If DNS lookup itself failed
    throw new Error(`Unable to resolve host "${hostname}". Please check if the domain exists and is accessible.`);
  }

  return parsed.toString();
}

/**
 * Sanitizes a filename to ensure safe disk storage and HTTP header attachment.
 */
function sanitizeFilename(filename, defaultExtension = 'mp4') {
  if (!filename || typeof filename !== 'string') {
    return `video_${Date.now()}.${defaultExtension}`;
  }

  // Strip control characters, path traversals, null bytes
  let clean = filename
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  // If empty after sanitization
  if (!clean || clean === '.') {
    clean = `video_${Date.now()}`;
  }

  // Limit max length for safety
  if (clean.length > 180) {
    const ext = path.extname(clean);
    clean = clean.substring(0, 180 - ext.length) + ext;
  }

  return clean;
}

/**
 * Formats byte size into readable text (KB, MB, GB).
 */
function formatBytes(bytes, decimals = 1) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'Unknown Size';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Formats duration seconds into HH:MM:SS or MM:SS
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const sec = Math.floor(seconds);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remainingSecs = sec % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
}

module.exports = {
  validateAndCheckSSRF,
  sanitizeFilename,
  formatBytes,
  formatDuration
};
