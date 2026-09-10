# GoDaddy Deployment Guide • Universal Video Downloader

This guide provides step-by-step instructions for deploying your **Universal Video Downloader** Node.js application to **GoDaddy**.

---

## 🎯 Which GoDaddy Hosting Plan Are You Using?

Choose the method that matches your GoDaddy hosting type:

1. **Option A (Recommended)**: **GoDaddy VPS / Dedicated Server (Ubuntu/CentOS)**
   - Best performance, no process timeout limits, full root control for Python, `yt-dlp`, and background video processing.
2. **Option B**: **GoDaddy cPanel (Web Hosting Plus / Linux Shared)**
   - Uses the cPanel **"Setup Node.js App"** interface.

---

## 🚀 Option A: Deploying on GoDaddy VPS (Recommended)

### Step 1: Connect to your GoDaddy VPS via SSH
Open your terminal (PowerShell, Command Prompt, or Mac Terminal):
```bash
ssh root@YOUR_SERVER_IP
```

---

### Step 2: Install Node.js 20+, Python 3, and yt-dlp

Run the following commands on Ubuntu/Debian:
```bash
# 1. Update system packages
apt update && apt upgrade -y

# 2. Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git ffmpeg python3 python3-pip

# 3. Install yt-dlp globally
pip3 install yt-dlp --break-system-packages

# 4. Install PM2 (Process Manager for 24/7 uptime)
npm install -g pm2
```

---

### Step 3: Upload or Clone Your Codebase

Navigate to your web directory:
```bash
mkdir -p /var/www/video-downloader
cd /var/www/video-downloader
```

Upload your project files (via Git, SFTP, or SCP) or clone:
```bash
# Example with Git:
git clone https://github.com/your-username/your-repo.git .
```

Install Node.js dependencies:
```bash
npm install --production
```

Configure your `.env` file:
```bash
cp .env.example .env
nano .env
```
*(Make sure `PORT=5000` is configured).*

---

### Step 4: Start the Application with PM2

```bash
# Start the app
pm2 start app.js --name "video-downloader"

# Configure PM2 to start automatically on server reboot
pm2 startup
pm2 save
```

---

### Step 5: Configure Nginx Reverse Proxy with SSL (Domain Routing)

Install Nginx:
```bash
apt install -y nginx certbot python3-certbot-nginx
```

Create an Nginx configuration file for your domain:
```bash
nano /etc/nginx/sites-available/downloader
```

Paste the following configuration (replace `yourdomain.com` with your real GoDaddy domain):
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for video streams
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
```

Enable the configuration and reload Nginx:
```bash
ln -s /etc/nginx/sites-available/downloader /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

Install a Free SSL Certificate (HTTPS):
```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## 📦 Option B: Deploying on GoDaddy cPanel (Web Hosting Plus)

If you are using GoDaddy cPanel:

### Step 1: Upload Your Project Files
1. In your GoDaddy account, open **cPanel** -> **File Manager**.
2. Navigate to your domain directory (e.g., `public_html` or `/home/username/video-downloader`).
3. Upload a `.zip` containing your project files:
   - `server/`
   - `public/`
   - `app.js`
   - `package.json`
   - `.env`
4. Extract the zip file in File Manager.

---

### Step 2: Create the Node.js Application in cPanel
1. In cPanel, find the **Software** section and click **"Setup Node.js App"**.
2. Click **"Create Application"**:
   - **Node.js version**: Choose `20.x` or highest available.
   - **Application mode**: `Production`.
   - **Application root**: Enter the folder path (e.g., `video-downloader` or `public_html`).
   - **Application URL**: Select your domain.
   - **Application startup file**: `app.js`.
3. Click **Create**.

---

### Step 3: Install Dependencies
1. Once created, in the Node.js App page, click **"Run NPM Install"**.
2. Open the cPanel **Terminal** (or SSH) and enter the virtual environment command shown at the top of the cPanel Node.js page (e.g., `source /home/username/nodevenv/...`).
3. Ensure Python and `yt-dlp` are installed for the user:
   ```bash
   pip install --user yt-dlp
   ```
4. Click **"Restart Application"** in cPanel.

---

## 🌐 Pointing GoDaddy DNS to Your App

1. In GoDaddy, go to **My Products** -> **DNS**.
2. Add/Edit the **A Record**:
   - **Type**: `A`
   - **Name**: `@`
   - **Value**: `YOUR_GODADDY_SERVER_IP`
   - **TTL**: `1/2 Hour`
3. Add a **CNAME Record**:
   - **Type**: `CNAME`
   - **Name**: `www`
   - **Value**: `@`

---

## 🔍 Verification & Health Check

After completing deployment:
1. Visit `https://yourdomain.com` in your browser.
2. Check `https://yourdomain.com/api/health` to confirm the backend status:
   ```json
   { "success": true, "status": "online", "maxDownloadSizeFormatted": "500 MB" }
   ```
