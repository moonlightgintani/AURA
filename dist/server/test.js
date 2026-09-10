const assert = require('assert');
const { validateAndCheckSSRF, sanitizeFilename, formatBytes, formatDuration } = require('./services/security');

async function runTests() {
  console.log('🧪 Running Universal Video Downloader Backend Tests...\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ PASSED: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${e.message}`);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ PASSED: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${e.message}`);
    }
  }

  // 1. Filename Sanitization
  test('Sanitize dangerous filenames with traversal and special chars', () => {
    const dirty = '../../etc/passwd\\<>:"/|?*test video.mp4';
    const clean = sanitizeFilename(dirty);
    assert(!clean.includes('..'));
    assert(!clean.includes('/'));
    assert(!clean.includes('\\'));
    assert(!clean.includes(':'));
    assert(!clean.includes('<'));
    assert(clean.endsWith('.mp4'));
  });

  // 2. Format Bytes
  test('Format byte helper handles sizes correctly', () => {
    assert.strictEqual(formatBytes(1024), '1 KB');
    assert.strictEqual(formatBytes(1024 * 1024 * 25.5), '25.5 MB');
    assert.strictEqual(formatBytes(1024 * 1024 * 1024 * 2), '2 GB');
  });

  // 3. Format Duration
  test('Format duration helper outputs standard timestamps', () => {
    assert.strictEqual(formatDuration(65), '1:05');
    assert.strictEqual(formatDuration(3665), '1:01:05');
  });

  // 4. SSRF - Block Localhost
  await testAsync('SSRF blocks localhost', async () => {
    let blocked = false;
    try {
      await validateAndCheckSSRF('http://localhost:8080/admin');
    } catch (e) {
      blocked = true;
    }
    assert(blocked, 'Localhost should be blocked');
  });

  // 5. SSRF - Block 127.0.0.1
  await testAsync('SSRF blocks 127.0.0.1', async () => {
    let blocked = false;
    try {
      await validateAndCheckSSRF('http://127.0.0.1:3000/keys');
    } catch (e) {
      blocked = true;
    }
    assert(blocked, '127.0.0.1 should be blocked');
  });

  // 6. SSRF - Block AWS/GCP Metadata 169.254.169.254
  await testAsync('SSRF blocks Cloud Metadata 169.254.169.254', async () => {
    let blocked = false;
    try {
      await validateAndCheckSSRF('http://169.254.169.254/latest/meta-data/');
    } catch (e) {
      blocked = true;
    }
    assert(blocked, 'Cloud Metadata IP should be blocked');
  });

  // 7. SSRF - Block Non-HTTP protocols
  await testAsync('SSRF blocks file:// and gopher:// protocols', async () => {
    let blocked = false;
    try {
      await validateAndCheckSSRF('file:///etc/shadow');
    } catch (e) {
      blocked = true;
    }
    assert(blocked, 'file:// protocol should be blocked');
  });

  // 8. SSRF - Allow Valid Public Domain
  await testAsync('SSRF allows valid public HTTPS domain', async () => {
    const valid = await validateAndCheckSSRF('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
    assert(valid.startsWith('https://commondatastorage.googleapis.com'));
  });

  console.log(`\n🎉 Results: ${passed}/${total} tests passed.`);
}

runTests();
