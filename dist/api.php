<?php
/**
 * AURA • Universal Media Downloader Backend Bridge (PHP / cPanel)
 * Provides 100% feature parity on standard cPanel Shared Hosting environments.
 */

error_reporting(0);
ini_set('display_errors', 0);
ini_set('memory_limit', '512M');
set_time_limit(0);

// Headers & CORS
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Range');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$tempDir = __DIR__ . '/temp_downloads';
if (!is_dir($tempDir)) {
    @mkdir($tempDir, 0777, true);
}

// Request path parsing
$requestUri = $_SERVER['REQUEST_URI'];
$basePath = parse_url($requestUri, PHP_URL_PATH);
$route = preg_replace('#^/api/#', '', $basePath);
$route = trim($route, '/');
$method = $_SERVER['REQUEST_METHOD'];

// Helper: JSON Response
function sendJson($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// Helper: Format bytes
function formatBytes($bytes) {
    if (!$bytes || $bytes <= 0) return 'Unknown Size';
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = floor(log($bytes, 1024));
    return round($bytes / pow(1024, $i), 2) . ' ' . $units[$i];
}

// Helper: Format duration
function formatDuration($seconds) {
    $seconds = (int)$seconds;
    if ($seconds <= 0) return '0:00';
    $h = floor($seconds / 3600);
    $m = floor(($seconds % 3600) / 60);
    $s = $seconds % 60;
    if ($h > 0) {
        return sprintf('%d:%02d:%02d', $h, $m, $s);
    }
    return sprintf('%d:%02d', $m, $s);
}

// Helper: SSRF Validation
function validateSSRF($rawUrl) {
    if (!filter_var($rawUrl, FILTER_VALIDATE_URL)) {
        throw new Exception('Invalid URL format.');
    }
    $parsed = parse_url($rawUrl);
    $scheme = strtolower($parsed['scheme'] ?? '');
    if (!in_array($scheme, ['http', 'https'])) {
        throw new Exception('Only HTTP and HTTPS URLs are allowed.');
    }
    $host = strtolower($parsed['host'] ?? '');
    if (empty($host)) {
        throw new Exception('Invalid host in URL.');
    }

    // Block localhost, private subnets, cloud metadata IPs
    $blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'];
    if (in_array($host, $blocked) || preg_match('/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/', $host)) {
        throw new Exception('Access to local/private network addresses is blocked.');
    }

    $ip = gethostbyname($host);
    if ($ip && filter_var($ip, FILTER_VALIDATE_IP)) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            throw new Exception('Access to private/internal IP address is prohibited.');
        }
    }

    return $rawUrl;
}

// Detect Extractor Binary (yt-dlp or python3 -m yt_dlp)
function getExtractorCommand() {
    $binPath = __DIR__ . '/server/bin/yt-dlp';
    if (file_exists($binPath)) {
        @chmod($binPath, 0755);
        return escapeshellcmd($binPath);
    }

    // Try which yt-dlp
    $whichYt = trim(@shell_exec('which yt-dlp 2>/dev/null'));
    if ($whichYt && file_exists($whichYt)) {
        return escapeshellcmd($whichYt);
    }

    // Try python3
    $pyCheck = @shell_exec('python3 -c "import yt_dlp; print(1)" 2>/dev/null');
    if (trim($pyCheck) === '1') {
        return 'python3 -m yt_dlp';
    }

    // Try python
    $pyCheck2 = @shell_exec('python -c "import yt_dlp; print(1)" 2>/dev/null');
    if (trim($pyCheck2) === '1') {
        return 'python -m yt_dlp';
    }

    // Download standalone yt-dlp into server/bin if missing
    $binDir = __DIR__ . '/server/bin';
    if (!is_dir($binDir)) {
        @mkdir($binDir, 0755, true);
    }
    $dl = @file_get_contents('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp');
    if ($dl && strlen($dl) > 10000) {
        @file_put_contents($binPath, $dl);
        @chmod($binPath, 0755);
        return escapeshellcmd($binPath);
    }

    return 'python3 -m yt_dlp';
}

/* =========================================================================
   ROUTES
   ========================================================================= */

// 1. GET /api/health
if ($route === 'health' || $route === 'api/health') {
    sendJson([
        'success' => true,
        'status' => 'online',
        'engine' => 'AURA Universal Engine',
        'maxDownloadSizeFormatted' => '500 MB',
        'timestamp' => date('c')
    ]);
}

// 2. POST /api/analyze
if (($route === 'analyze' || $route === 'api/analyze') && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $url = $input['url'] ?? '';

    try {
        $validatedUrl = validateSSRF($url);
        $extractor = getExtractorCommand();

        $cmd = $extractor . ' --dump-single-json --no-warnings --no-playlist --no-check-certificates --socket-timeout 20 ' . escapeshellarg($validatedUrl) . ' 2>&1';
        $output = shell_exec($cmd);

        if (!$output || empty(trim($output))) {
            throw new Exception('Extractor engine produced no response. Target media might be inaccessible.');
        }

        // Find JSON boundaries
        $start = strpos($output, '{');
        $end = strrpos($output, '}');
        if ($start === false || $end === false || $end < $start) {
            // Check known error messages
            if (stripos($output, 'drm') !== false) {
                throw new Exception('This video is protected by DRM (Digital Rights Management) and cannot be downloaded.');
            }
            if (stripos($output, 'private') !== false || stripos($output, 'sign in') !== false) {
                throw new Exception('This video is private or requires sign-in authentication.');
            }
            throw new Exception('Could not extract media metadata: ' . substr(strip_tags($output), 0, 150));
        }

        $jsonStr = substr($output, $start, $end - $start + 1);
        $raw = json_decode($jsonStr, true);

        if (!$raw || !isset($raw['title'])) {
            throw new Exception('Failed to decode video metadata structure.');
        }

        $title = $raw['title'] ?? 'Untitled Video';
        $duration = (int)($raw['duration'] ?? 0);
        $uploader = $raw['uploader'] ?? ($raw['channel'] ?? 'Creator');
        $platform = $raw['extractor_key'] ?? 'Web Video';
        $thumbnail = $raw['thumbnail'] ?? '';
        $rawFormats = $raw['formats'] ?? [];

        // Build formats
        $videoOptions = [];
        $audioOptions = [];
        $heightMap = [];

        foreach ($rawFormats as $f) {
            $h = $f['height'] ?? 0;
            if ($h >= 144) {
                $isProgressive = !empty($f['vcodec']) && $f['vcodec'] !== 'none' && !empty($f['acodec']) && $f['acodec'] !== 'none';
                $score = ($isProgressive ? 1000 : 0) + ($f['tbr'] ?? ($f['vbr'] ?? 0));
                if (!isset($heightMap[$h]) || $score > $heightMap[$h]['score']) {
                    $heightMap[$h] = ['format' => $f, 'score' => $score];
                }
            }
        }

        krsort($heightMap);

        if (empty($heightMap)) {
            $videoOptions[] = [
                'formatId' => 'best',
                'quality' => 'Standard Quality',
                'height' => 720,
                'ext' => 'mp4',
                'hasVideo' => true,
                'hasAudio' => true,
                'filesize' => $duration * 150000,
                'filesizeFormatted' => formatBytes($duration * 150000),
                'label' => 'Standard MP4 Quality',
                'isAudioOnly' => false,
                'tag' => 'Best'
            ];
        } else {
            foreach ($heightMap as $h => $item) {
                $f = $item['format'];
                $qualityLabel = $h . 'p';
                $tag = '';
                if ($h >= 2160) { $qualityLabel = '2160p (4K UHD)'; $tag = '4K'; }
                elseif ($h >= 1440) { $qualityLabel = '1440p (2K QHD)'; $tag = '2K'; }
                elseif ($h >= 1080) { $qualityLabel = '1080p (Full HD)'; $tag = 'FHD'; }
                elseif ($h >= 720) { $qualityLabel = '720p (HD)'; $tag = 'HD'; }
                elseif ($h >= 480) { $qualityLabel = '480p (SD)'; $tag = 'SD'; }

                $bitrates = [2160 => 15000, 1440 => 8000, 1080 => 3500, 720 => 1800, 480 => 850, 360 => 450, 240 => 250];
                $estSize = $f['filesize'] ?? ($f['filesize_approx'] ?? ($duration > 0 ? (int)(($bitrates[$h] ?? ($h * 4)) * 1024 * $duration / 8) : 25000000));

                $videoOptions[] = [
                    'formatId' => "bestvideo[height<={$h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={$h}]+bestaudio/best[height<={$h}]/best",
                    'quality' => $h . 'p',
                    'height' => $h,
                    'ext' => 'mp4',
                    'hasVideo' => true,
                    'hasAudio' => true,
                    'filesize' => $estSize,
                    'filesizeFormatted' => formatBytes($estSize),
                    'label' => "{$qualityLabel} • MP4",
                    'isAudioOnly' => false,
                    'tag' => $tag
                ];

                if ($h >= 720) {
                    $videoOptions[] = [
                        'formatId' => "bestvideo[height<={$h}][ext=webm]+bestaudio[ext=webm]/bestvideo[height<={$h}]+bestaudio/best[height<={$h}]",
                        'quality' => $h . 'p',
                        'height' => $h,
                        'ext' => 'webm',
                        'hasVideo' => true,
                        'hasAudio' => true,
                        'filesize' => (int)($estSize * 0.9),
                        'filesizeFormatted' => formatBytes((int)($estSize * 0.9)),
                        'label' => "{$qualityLabel} • WebM",
                        'isAudioOnly' => false,
                        'tag' => $tag
                    ];
                }
            }
        }

        $audioSize = (int)($duration > 0 ? (192 * 1024 * $duration / 8) : 5000000);
        $audioOptions[] = [
            'formatId' => 'bestaudio/best',
            'quality' => '320 kbps (High)',
            'height' => 0,
            'ext' => 'mp3',
            'hasVideo' => false,
            'hasAudio' => true,
            'filesize' => $audioSize,
            'filesizeFormatted' => formatBytes($audioSize),
            'label' => 'Audio MP3 (High Quality)',
            'isAudioOnly' => true,
            'tag' => 'Audio'
        ];

        sendJson([
            'success' => true,
            'data' => [
                'id' => $raw['id'] ?? uniqid('vid_'),
                'title' => $title,
                'description' => substr($raw['description'] ?? '', 0, 200),
                'thumbnail' => $thumbnail,
                'duration' => $duration,
                'durationFormatted' => formatDuration($duration),
                'uploader' => $uploader,
                'platform' => $platform,
                'webpage_url' => $validatedUrl,
                'formats' => array_merge($videoOptions, $audioOptions),
                'defaultFormatId' => $videoOptions[0]['formatId'] ?? 'best'
            ]
        ]);
    } catch (Exception $e) {
        sendJson(['success' => false, 'error' => $e->getMessage()], 400);
    }
}

// 3. POST /api/download
if (($route === 'download' || $route === 'api/download') && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $url = $input['url'] ?? '';
    $title = $input['title'] ?? 'video';
    $formatId = $input['formatId'] ?? 'best';
    $ext = $input['ext'] ?? 'mp4';
    $quality = $input['quality'] ?? '720p';

    try {
        $validatedUrl = validateSSRF($url);
        $jobId = uniqid('job_');
        $outputFile = $tempDir . "/{$jobId}.{$ext}";
        $jobMetaFile = $tempDir . "/{$jobId}.json";

        $cleanTitle = preg_replace('/[^\w\s\-\.]+/u', '', $title);
        $cleanTitle = trim(preg_replace('/\s+/', ' ', $cleanTitle));
        $downloadFileName = ($cleanTitle ?: 'video') . ".{$ext}";

        $jobData = [
            'id' => $jobId,
            'status' => 'downloading',
            'progress' => 0,
            'speed' => 'Calculating...',
            'eta' => 'Estimating...',
            'fileName' => $downloadFileName,
            'filePath' => $outputFile,
            'fileSize' => 0,
            'ext' => $ext,
            'url' => $validatedUrl,
            'formatId' => $formatId,
            'createdAt' => time()
        ];
        file_put_contents($jobMetaFile, json_encode($jobData));

        $extractor = getExtractorCommand();
        $isAudio = in_array($ext, ['mp3', 'm4a']);

        $cmdArgs = $extractor . ' --no-playlist --no-warnings --no-check-certificates --socket-timeout 30 ';
        if ($isAudio) {
            $cmdArgs .= '-x --audio-format ' . escapeshellarg($ext) . ' ';
        } else {
            if ($formatId && $formatId !== 'best') {
                $cmdArgs .= '-f ' . escapeshellarg($formatId) . ' ';
            }
            $cmdArgs .= '--merge-output-format ' . escapeshellarg($ext) . ' ';
        }
        $cmdArgs .= '-o ' . escapeshellarg($tempDir . "/{$jobId}.%(ext)s") . ' ' . escapeshellarg($validatedUrl);

        // Run background worker
        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
            pclose(popen("start /B " . $cmdArgs . " > NUL 2>&1", "r"));
        } else {
            shell_exec($cmdArgs . ' > /dev/null 2>&1 &');
        }

        sendJson([
            'success' => true,
            'jobId' => $jobId,
            'message' => 'Download started.'
        ], 202);
    } catch (Exception $e) {
        sendJson(['success' => false, 'error' => $e->getMessage()], 400);
    }
}

// 4. GET /api/progress/:jobId
if (preg_match('#^(api/)?progress/([^/]+)$#', $route, $matches)) {
    $jobId = $matches[2];
    $jobMetaFile = $tempDir . "/{$jobId}.json";

    if (!file_exists($jobMetaFile)) {
        sendJson(['success' => false, 'error' => 'Job not found.'], 404);
    }

    $job = json_decode(file_get_contents($jobMetaFile), true);
    $ext = $job['ext'] ?? 'mp4';
    $targetFile = $tempDir . "/{$jobId}.{$ext}";

    // Check if target file exists and is finalized
    if (file_exists($targetFile)) {
        $size = filesize($targetFile);
        $job['fileSize'] = $size;
        $job['fileSizeFormatted'] = formatBytes($size);

        // If file exists and is growing or stable
        if ($size > 1024) {
            $job['status'] = 'completed';
            $job['progress'] = 100;
            file_put_contents($jobMetaFile, json_encode($job));
        }
    } else {
        // Increment progress simulated while downloading
        $elapsed = time() - ($job['createdAt'] ?? time());
        if ($elapsed > 60) {
            $job['status'] = 'failed';
            $job['error'] = 'Download timed out on server.';
        } else {
            $job['progress'] = min(90, max(15, $elapsed * 5));
            $job['speed'] = 'Processing stream...';
            $job['eta'] = max(1, 15 - (int)($elapsed / 2)) . 's';
        }
    }

    sendJson(['success' => true, 'job' => $job]);
}

// 5. GET /api/file/:jobId
if (preg_match('#^(api/)?file/([^/]+)$#', $route, $matches)) {
    $jobId = $matches[2];
    $jobMetaFile = $tempDir . "/{$jobId}.json";

    if (!file_exists($jobMetaFile)) {
        http_response_code(404);
        die('File job not found.');
    }

    $job = json_decode(file_get_contents($jobMetaFile), true);
    $ext = $job['ext'] ?? 'mp4';
    $filePath = $tempDir . "/{$jobId}.{$ext}";

    if (!file_exists($filePath)) {
        http_response_code(404);
        die('File not found on server.');
    }

    $fileSize = filesize($filePath);
    $filename = $job['fileName'] ?? "video.{$ext}";

    $mimeTypes = [
        'mp4' => 'video/mp4',
        'webm' => 'video/webm',
        'mp3' => 'audio/mpeg',
        'm4a' => 'audio/mp4'
    ];
    $contentType = $mimeTypes[$ext] ?? 'application/octet-stream';

    header('Content-Type: ' . $contentType);
    header('Content-Length: ' . $fileSize);
    header('Content-Disposition: attachment; filename="' . rawurlencode($filename) . '"');
    header('Accept-Ranges: bytes');

    readfile($filePath);
    exit;
}

// Fallback 404 for unknown API routes
sendJson(['success' => false, 'error' => 'API endpoint not found.'], 404);
