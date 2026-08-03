
const { initializeLocalStorage } = require('./config/scripts/initializeLocalData');
const secretsManager = require('./services/secretsManager');
const encryptionService = require('./services/encryptionService');
const { logger } = require('./logger');

async function testInit() {
  console.log('--- Diagnostic Start ---');
  
  console.log('1. Testing secretsManager.initialize()...');
  await secretsManager.initialize();
  console.log('   OK');

  console.log('2. Testing encryptionService.initialized...');
  await encryptionService.initialized;
  console.log('   OK');

  console.log('3. Testing initializeLocalStorage()...');
  // We wrap it to see if it hangs inside
  const timeout = setTimeout(() => {
    console.error('   TIMEOUT: initializeLocalStorage is taking too long!');
  }, 10000);
  
  await initializeLocalStorage();
  clearTimeout(timeout);
  console.log('   OK');

  console.log('--- All Initializations Finished ---');
  process.exit(0);
}

testInit().catch(err => {
  console.error('--- Initialization Failed ---');
  console.error(err);
  process.exit(1);
});
