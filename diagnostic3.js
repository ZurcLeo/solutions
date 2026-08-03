
const http = require('http');
const express = require('express');
const app = express();
const server = http.createServer(app);

console.log('--- Diagnostic 3 Start ---');

console.log('1. Loading socketConfig...');
const configureSocket = require('./config/socket/socketConfig');
console.log('   OK');

console.log('2. Calling configureSocket(server)...');
try {
  const io = configureSocket(server);
  console.log('   OK, io created');
} catch (err) {
  console.error('   FAILED calling configureSocket:', err);
}

console.log('--- Diagnostic 3 Finished ---');
process.exit(0);
