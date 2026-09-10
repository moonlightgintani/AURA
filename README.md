# AURA • Luxury Universal Video Downloader (Node.js)

<p align="center">
  <img src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80" alt="AURA Banner" width="100%" style="border-radius: 12px; max-height: 280px; object-fit: cover; border: 1px solid #d4af37;" />
</p>

A state-of-the-art **Universal Video Downloader** web and mobile application built with **Node.js, Express, and yt-dlp**, presented with an ultra-premium **Black and Gold** luxury aesthetic.

---

## ✨ Features

- 🏆 **Black & Gold Luxury Aesthetics**: Obsidian dark surfaces (`#070709`), shimmering gold foil gradients, ambient radial glow effects, and glassmorphism with backdrop blur.
- 📋 **One-Click Paste & Analyze**: Integrated Clipboard API for rapid link insertion and instant media resolution inspection.
- 🎥 **Universal Media Resolution Matrix**:
  - Full HD & 4K UHD (`2160p`, `1440p`, `1080p`, `720p`, `480p`, `360p`).
  - Container Selection: **MP4** (H.264/AAC), **WebM** (VP9/Opus).
  - Audio Extraction: Pure **MP3** (320 kbps) and **M4A / AAC** lossless audio streams.
- ⚡ **Real-Time Progress Engine**:
  - Live percentage dial, data transfer throughput (e.g. `4.8 MB/s`), and ETA countdown timer.
  - Interactive **Cancel** button with clean child process termination.
- 💾 **Automatic Client Device Saving**:
  - Automatically triggers safe local device saving once downloaded.
  - Video preview modal for inline playback directly in the browser.
- 📜 **Download History Drawer**:
  - Persistent history with thumbnail previews, quality tags, and timestamp tracking.
  - Redownload, play, and one-click "Clear All History" controls.
- 🛡️ **Enterprise Security & SSRF Protection**:
  - **SSRF Defense**: Deep DNS resolution checks preventing access to private subnets (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, AWS/GCP metadata, IPv6 mapped loopbacks).
  - **DRM & Rights Compliant**: Gracefully detects and handles DRM encryption, paywalls, and private videos without violating platform protections.
  - **Disk Auto-Purge**: Background garbage collector cleans temporary files older than 15 minutes.
  - **Rate Limiting & Helmet**: DDoS mitigation and strict Content Security Policy.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│        Frontend (Luxury Black & Gold Responsive SPA)    │
│  [URL Input] ──> [Paste Link] ──> [Analyze Link Button] │
│  [Video Preview Card] ──> [Quality Matrix] ──> [History]│
└───────────────────────────┬────────────────────────────┘
                            │ HTTP JSON API / SSE
┌───────────────────────────▼────────────────────────────┐
│                  Node.js / Express Server              │
│  ├─ Helmet & Rate Limiter                              │
│  ├─ SSRF DNS Resolution Guard                          │
│  ├─ Extractor Engine (yt-dlp JSON inspection)          │
│  ├─ Job & Child Process Manager                        │
│  ├─ Stream Delivery & Content-Disposition Sanitizer    │
│  └─ Periodic Garbage Collector                         │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start Guide

### Prerequisites
1. **Node.js**: v18+ (tested on Node v20/v24)
2. **Python**: 3.9+ with `yt-dlp` installed:
   ```bash
   pip install yt-dlp
   ```

### 1. Installation
Clone or navigate to the project directory:
```bash
git clone <repo_url>
cd universal-video-downloader
```

Install Node.js dependencies:
```bash
npm install
```

### 2. Configuration
Copy the environment template:
```bash
cp .env.example .env
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Start the Application
```bash
npm start
```
Open your browser at: **`http://localhost:5000`**

---

## 📡 API Reference

### 1. Analyze Media URL
Extracts metadata, permitted qualities, file sizes, and thumbnail.

- **Endpoint**: `POST /api/analyze`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
}
```
- **Response**:
```json
{
  "success": true,
  "data": {
    "id": "sample_video",
    "title": "Big Buck Bunny (1080p)",
    "uploader": "Blender Foundation",
    "duration": 596,
    "durationFormatted": "9:56",
    "thumbnail": "https://...",
    "platform": "Direct Stream",
    "formats": [
      {
        "formatId": "bestvideo[height<=1080]+bestaudio",
        "quality": "1080p",
        "ext": "mp4",
        "filesize": 158334912,
        "filesizeFormatted": "151 MB",
        "label": "1080p (Full HD) • MP4",
        "isAudioOnly": false
      },
      {
        "formatId": "bestaudio/best",
        "quality": "320 kbps",
        "ext": "mp3",
        "filesizeFormatted": "14.3 MB",
        "label": "Audio MP3",
        "isAudioOnly": true
      }
    ]
  }
}
```

---

### 2. Initialize Download Job
Queues a background download task.

- **Endpoint**: `POST /api/download`
- **Request Body**:
```json
{
  "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "title": "Big Buck Bunny",
  "formatId": "bestvideo[height<=1080]+bestaudio",
  "ext": "mp4",
  "quality": "1080p"
}
```
- **Response** `(202 Accepted)`:
```json
{
  "success": true,
  "jobId": "3f82a17b-944a-4e44-b223-93d395724213",
  "message": "Download job queued successfully."
}
```

---

### 3. Track Progress
Returns the real-time download status, percent, speed, and ETA.

- **Endpoint**: `GET /api/progress/:jobId`
- **Response**:
```json
{
  "success": true,
  "job": {
    "id": "3f82a17b-944a-4e44-b223-93d395724213",
    "status": "downloading",
    "progress": 68.4,
    "speed": "5.2 MiB/s",
    "eta": "00:04",
    "fileName": "Big Buck Bunny.mp4",
    "fileSize": 158334912,
    "fileSizeFormatted": "151 MB"
  }
}
```

---

### 4. Retrieve / Stream Downloaded File
Streams the completed file to the user's device with proper `Content-Disposition`. Supports `Range` headers for resumption.

- **Endpoint**: `GET /api/file/:jobId?download=1`

---

### 5. Cancel Download Job
Aborts a running download and terminates child processes.

- **Endpoint**: `POST /api/cancel/:jobId`
- **Response**:
```json
{
  "success": true,
  "message": "Download job was cancelled successfully."
}
```

---

## 🔒 Security & Policy Implementation

| Threat Vector | Mitigation Strategy |
| :--- | :--- |
| **SSRF / Intranet Exploits** | Strict DNS lookup resolution before fetching. Blocks RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), Loopbacks (`127.0.0.1`), Link-Local & Cloud Metadata (`169.254.169.254`), non-HTTP schemes. |
| **Path Traversal Attacks** | Strict filename sanitization removing `../`, control characters, null bytes, and non-printable characters. |
| **Disk Exhaustion** | Strict maximum download size limit (`500MB` default) + periodic cleanup worker purging files older than 15 minutes. |
| **Process Leaks** | Active child process references are tied to `jobId`. Cancellation sends `SIGTERM` / `SIGKILL` directly to the process tree. |
| **DRM & Access Protection** | Graceful rejection for encrypted streams, paywalled URLs, and private videos with clear human-readable notices. |

---

## 🚢 Deployment

### Running with PM2 (Production Daemon)
```bash
npm install -g pm2
pm2 start server/index.js --name "video-downloader" -i max
pm2 save
```

### Docker Deployment
```dockerfile
FROM node:20-alpine

# Install Python and yt-dlp
RUN apk add --no-cache python3 py3-pip ffmpeg
RUN pip install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 5000
CMD ["node", "server/index.js"]
```

---

## 📜 License
Released under the [MIT License](LICENSE).
