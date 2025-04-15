const fs = require('fs');
const path = require('path');

module.exports = () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return {
        key: fs.readFileSync(process.env.SSL_KEY_FILE),
        cert: fs.readFileSync(process.env.SSL_CRT_FILE),
        ca: process.env.SSL_CHAIN_FILE ? fs.readFileSync(process.env.SSL_CHAIN_FILE) : undefined
      };
    } else {
      return {
        key: fs.readFileSync(path.join(__dirname, '../../certificates', 'private.key')),
        cert: fs.readFileSync(path.join(__dirname, '../../certificates', 'certificate.crt')),
        requestCert: false,
        rejectUnauthorized: false
      };
    }
  } catch (error) {
    throw new Error(`Failed to read SSL certificates: ${error.message}`);
  }
};