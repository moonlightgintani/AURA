const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { 
  PORT, 
  HOST, 
  RATE_LIMIT_WINDOW_MS, 
  RATE_LIMIT_MAX_REQUESTS 
} = require('./config');
const apiRoutes = require('./routes/api');

const app = express();

// Security Headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS Configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range']
}));

// Body Parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Rate Limiting on API endpoints
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP. Please wait a few minutes before trying again.'
  }
});

app.use('/api', apiLimiter);
app.use('/api', apiRoutes);

// Handle favicon request
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve static frontend assets
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Fallback to index.html for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Centralized error handling
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: 'An internal server error occurred. Please try again later.'
  });
});

// Start Server
const listenArgs = [];
if (typeof PORT === 'number' || !isNaN(Number(PORT))) {
  listenArgs.push(Number(PORT));
  if (HOST) {
    listenArgs.push(HOST);
  }
} else {
  // Unix domain socket (Passenger / cPanel)
  listenArgs.push(PORT);
}

listenArgs.push(() => {
  console.log('====================================================');
  console.log(`✨ Universal Video Downloader [Black & Gold]`);
  console.log(`🚀 Server listening on: ${PORT}`);
  console.log(`🛡️  SSRF Protection & Rate Limiting Active`);
  console.log('====================================================');
});

const server = app.listen(...listenArgs);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port/Socket ${PORT} is already in use by another process.`);
    console.error(`👉 Solution: Change PORT in .env or restart the process.\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});

module.exports = app;
