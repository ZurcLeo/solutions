const fs = require('fs');
const path = require('path');

module.exports = () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return {
        key: process.env.SSL_KEY ? Buffer.from(process.env.SSL_KEY, 'base64') : undefined,
        cert: process.env.SSL_CERT ? Buffer.from(process.env.SSL_CERT, 'base64') : undefined,
        ca: process.env.SSL_CA ? Buffer.from(process.env.SSL_CA, 'base64') : undefined
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