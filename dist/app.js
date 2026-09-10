/**
 * Root entry point for GoDaddy cPanel / Phusion Passenger / PM2 deployments
 */
const app = require('./server/index.js');
module.exports = app;
