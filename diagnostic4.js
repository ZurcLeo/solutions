
const express = require('express');
const app = express();

console.log('--- Diagnostic 4 Start ---');

console.log('1. Loading setupRoutes...');
const setupRoutes = require('./config/routes/routesConfig');
console.log('   OK');

console.log('2. Calling setupRoutes(app)...');
try {
  setupRoutes(app);
  console.log('   OK, routes set up');
} catch (err) {
  console.error('   FAILED calling setupRoutes:', err);
}

console.log('--- Diagnostic 4 Finished ---');
process.exit(0);
