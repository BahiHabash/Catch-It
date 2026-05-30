const mongoose = require('mongoose');
const dns = require('dns');

// Programmatically set Node.js to resolve DNS queries using Google & Cloudflare servers.
// This resolves "querySrv ECONNREFUSED" caused by local ISPs/networks that block SRV records.
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  console.warn('Warning: Could not set custom DNS servers:', e.message);
}

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/catch_it';
    const conn = await mongoose.connect(uri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    // We don't want to crash the process in production if the DB fails temporarily, 
    // but for initial setup, we log it.
  }
};

module.exports = connectDB;
