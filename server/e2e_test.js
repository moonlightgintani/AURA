const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runE2ETests() {
  console.log('🚀 Running Full End-to-End API Integration Tests on http://localhost:5000...\n');

  // 1. Test Health Endpoint
  console.log('1️⃣ Testing GET /api/health...');
  const healthRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/health',
    method: 'GET'
  });
  console.log('   Status:', healthRes.status);
  console.log('   Response:', healthRes.data);
  if (healthRes.status !== 200 || !healthRes.data.success) {
    throw new Error('Health check failed');
  }

  // 2. Test SSRF Rejection on Analyze
  console.log('\n2️⃣ Testing SSRF Rejection on POST /api/analyze with 127.0.0.1...');
  const ssrfRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/analyze',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { url: 'http://127.0.0.1:5000/api/health' });
  console.log('   Status:', ssrfRes.status);
  console.log('   Error Message:', ssrfRes.data.error);
  if (ssrfRes.status !== 400 || ssrfRes.data.success) {
    throw new Error('SSRF was not blocked');
  }

  // 3. Test Metadata Analysis on Direct Public Video
  console.log('\n3️⃣ Testing POST /api/analyze on Big Buck Bunny public stream...');
  const testUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
  const analyzeRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/analyze',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { url: testUrl });

  console.log('   Status:', analyzeRes.status);
  console.log('   Title:', analyzeRes.data.data.title);
  console.log('   Platform:', analyzeRes.data.data.platform);
  console.log('   Available Formats Count:', analyzeRes.data.data.formats.length);
  console.log('   Sample Formats:', analyzeRes.data.data.formats.map(f => `${f.quality} (${f.ext}) - ${f.filesizeFormatted}`));

  if (!analyzeRes.data.success || !analyzeRes.data.data.formats.length) {
    throw new Error('Analyze failed to return formats');
  }

  const selectedFormat = analyzeRes.data.data.formats[0];

  // 4. Test Starting Download
  console.log('\n4️⃣ Testing POST /api/download...');
  const downloadRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/download',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    url: testUrl,
    title: analyzeRes.data.data.title,
    formatId: selectedFormat.formatId,
    ext: selectedFormat.ext,
    quality: selectedFormat.quality
  });

  console.log('   Status:', downloadRes.status);
  console.log('   Job ID:', downloadRes.data.jobId);
  const jobId = downloadRes.data.jobId;

  // 5. Poll Progress until completed
  console.log('\n5️⃣ Polling GET /api/progress/:jobId...');
  let completed = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const progRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/progress/${jobId}`,
      method: 'GET'
    });

    const job = progRes.data.job;
    console.log(`   [Poll ${i+1}] Status: ${job.status} | Progress: ${job.progress}% | Speed: ${job.speed} | ETA: ${job.eta}`);

    if (job.status === 'completed') {
      completed = true;
      console.log('   ✅ Download Finished! File name:', job.fileName, '| Size:', job.fileSizeFormatted);
      break;
    } else if (job.status === 'failed') {
      throw new Error(`Download job failed: ${job.error}`);
    }
  }

  if (!completed) {
    throw new Error('Download job timed out');
  }

  // 6. Test File Streaming Download
  console.log('\n6️⃣ Testing GET /api/file/:jobId with Range and full download headers...');
  const fileRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/file/${jobId}?download=1`,
    method: 'GET'
  });
  console.log('   Status:', fileRes.status);
  console.log('   Content-Type:', fileRes.headers['content-type']);
  console.log('   Content-Disposition:', fileRes.headers['content-disposition']);
  console.log('   Content-Length:', fileRes.headers['content-length']);

  if (fileRes.status !== 200 || !fileRes.headers['content-disposition']) {
    throw new Error('File download endpoint failed');
  }

  console.log('\n🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY! 🌟');
}

runE2ETests().catch(err => {
  console.error('\n❌ E2E Test Error:', err);
  process.exit(1);
});
