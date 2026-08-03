
console.log('--- Diagnostic 2 Start ---');

console.log('1. Loading firebaseAdmin...');
const { getFirestore } = require('./firebaseAdmin');
console.log('   OK');

console.log('2. Calling getFirestore()...');
const db = getFirestore();
console.log('   OK');

console.log('3. Loading socketConfig...');
try {
  const socketConfig = require('./config/socket/socketConfig');
  console.log('   OK');
} catch (err) {
  console.error('   FAILED loading socketConfig:', err);
}

console.log('4. Loading index.js (partial)...');
// This might be tricky because index.js has top-level side effects
try {
  // We can't easily require index.js without running it, 
  // but we can try to see if it hangs on specific parts.
} catch (err) {}

console.log('--- Diagnostic 2 Finished ---');
process.exit(0);
