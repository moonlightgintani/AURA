/**
 * Comprehensive End-to-End (E2E) Integration Test Suite
 * Supports both local testing (auto-starts local server if not running)
 * and remote server testing (e.g. node server/e2e_test.js https://aura.srecieee.org).
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Determine target base URL from CLI argument, env variable, or default to localhost:5000
const rawTarget = process.argv[2] || process.env.TARGET_URL || 'http://127.0.0.1:5000';
const BASE_URL = new URL(rawTarget);

function request(path, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const isHttps = BASE_URL.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      protocol: BASE_URL.protocol,
      hostname: BASE_URL.hostname,
      port: BASE_URL.port || (isHttps ? 443 : 80),
      path: path,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 30000
    };

    let bodyPayload = null;
    if (postData) {
      bodyPayload = typeof postData === 'string' ? postData : JSON.stringify(postData);
      requestOptions.headers['Content-Type'] = requestOptions.headers['Content-Type'] || 'application/json';
      requestOptions.headers['Content-Length'] = Buffer.byteLength(bodyPayload);
    }

    const req = client.request(requestOptions, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          // Non-JSON response (e.g., HTML 404/500 error page or binary stream)
        }
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          data: parsed,
          raw: body
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after 30s for ${path}`));
    });

    req.on('error', reject);

    if (bodyPayload) {
      req.write(bodyPayload);
    }
    req.end();
  });
}

async function isServerRunning() {
  try {
    const res = await request('/api/health');
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

async function runE2ETests() {
  console.log('===============================================================');
  console.log(`🚀 Starting Universal Downloader E2E Tests on: ${BASE_URL.origin}`);
  console.log('===============================================================\n');

  // Check if server is running; if targeting local and not running, launch it
  const isLocal = BASE_URL.hostname === 'localhost' || BASE_URL.hostname === '127.0.0.1';
  let serverInstance = null;

  if (isLocal) {
    const running = await isServerRunning();
    if (!running) {
      console.log('⚡ Local server not detected. Auto-launching Express backend for tests...');
      try {
        process.env.PORT = BASE_URL.port || '5000';
        require('./index.js');
        // Wait for server to bind
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        if (err.code !== 'EADDRINUSE') {
          console.warn('Note on server start:', err.message);
        }
      }
    }
  }

  // 1. Test Health Endpoint
  console.log('1️⃣ Testing GET /api/health...');
  const healthRes = await request('/api/health');
  console.log('   Status:', healthRes.status);
  console.log('   Response Body:', healthRes.data || healthRes.raw.substring(0, 100));

  if (healthRes.status !== 200 || !healthRes.data || !healthRes.data.success) {
    throw new Error(`Health check failed on ${BASE_URL.origin}/api/health (Status: ${healthRes.status}). Ensure the Node.js app is running and /api routes are reachable.`);
  }
  console.log('   ✅ Backend health check OK (Engine: Online)');

  // 2. Test SSRF Protection on /api/analyze
  console.log('\n2️⃣ Testing SSRF Rejection on POST /api/analyze with 127.0.0.1...');
  const ssrfRes = await request('/api/analyze', { method: 'POST' }, { url: 'http://127.0.0.1:5000/api/health' });
  console.log('   Status:', ssrfRes.status);
  console.log('   Error Returned:', ssrfRes.data ? ssrfRes.data.error : ssrfRes.raw.substring(0, 100));

  if (ssrfRes.status !== 400 || (ssrfRes.data && ssrfRes.data.success)) {
    throw new Error('SSRF security verification failed: Private IP was not blocked');
  }
  console.log('   ✅ SSRF successfully prevented');

  // 3. Test Metadata Analysis on Direct Public Video
  console.log('\n3️⃣ Testing POST /api/analyze on Public Test Stream (Big Buck Bunny)...');
  const testUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
  const analyzeRes = await request('/api/analyze', { method: 'POST' }, { url: testUrl });

  console.log('   Status:', analyzeRes.status);
  if (!analyzeRes.data || !analyzeRes.data.success || !analyzeRes.data.data) {
    throw new Error(`Analyze failed: ${analyzeRes.data ? analyzeRes.data.error : analyzeRes.raw.substring(0, 200)}`);
  }

  const meta = analyzeRes.data.data;
  console.log('   Title:', meta.title);
  console.log('   Platform:', meta.platform);
  console.log('   Available Formats Count:', meta.formats ? meta.formats.length : 0);
  if (meta.formats && meta.formats.length > 0) {
    console.log('   Sample Formats:', meta.formats.map(f => `${f.quality} (${f.ext}) - ${f.filesizeFormatted}`).join(', '));
  }
  console.log('   ✅ Media analysis successful');

  const selectedFormat = meta.formats[0];

  // 4. Test Initiating Download Job
  console.log('\n4️⃣ Testing POST /api/download...');
  const downloadRes = await request('/api/download', { method: 'POST' }, {
    url: testUrl,
    title: meta.title,
    formatId: selectedFormat.formatId,
    ext: selectedFormat.ext,
    quality: selectedFormat.quality
  });

  console.log('   Status:', downloadRes.status);
  if (!downloadRes.data || !downloadRes.data.success || !downloadRes.data.jobId) {
    throw new Error(`Download job creation failed: ${downloadRes.data ? downloadRes.data.error : downloadRes.raw}`);
  }

  const jobId = downloadRes.data.jobId;
  console.log('   Job ID:', jobId);
  console.log('   ✅ Download job queued');

  // 5. Poll Job Progress
  console.log('\n5️⃣ Polling GET /api/progress/:jobId...');
  let completed = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const progRes = await request(`/api/progress/${jobId}`);

    if (progRes.status === 200 && progRes.data && progRes.data.job) {
      const job = progRes.data.job;
      console.log(`   [Poll ${i + 1}] Status: ${job.status} | Progress: ${job.progress}% | Speed: ${job.speed || 'N/A'} | ETA: ${job.eta || 'N/A'}`);

      if (job.status === 'completed') {
        completed = true;
        console.log(`   ✅ Download Finished! File: "${job.fileName}" (${job.fileSizeFormatted})`);
        break;
      } else if (job.status === 'failed') {
        throw new Error(`Download job failed on backend: ${job.error}`);
      }
    } else {
      console.log(`   [Poll ${i + 1}] Response status: ${progRes.status}`);
    }
  }

  if (!completed) {
    throw new Error('Download job timed out after 30 seconds');
  }

  // 6. Test File Streaming Download
  console.log('\n6️⃣ Testing GET /api/file/:jobId?download=1...');
  const fileRes = await request(`/api/file/${jobId}?download=1`);
  console.log('   Status:', fileRes.status);
  console.log('   Content-Type:', fileRes.headers['content-type']);
  console.log('   Content-Disposition:', fileRes.headers['content-disposition']);
  console.log('   Content-Length:', fileRes.headers['content-length']);

  if (fileRes.status !== 200 || !fileRes.headers['content-disposition']) {
    throw new Error(`File download failed (Status: ${fileRes.status})`);
  }
  console.log('   ✅ File streaming download verified');

  console.log('\n===============================================================');
  console.log('🎉 ALL END-TO-END INTEGRATION TESTS PASSED SUCCESSFULLY! 🌟');
  console.log('===============================================================\n');
}

runE2ETests().catch(err => {
  console.error('\n❌ E2E Test Error:', err.message);
  process.exit(1);
});
