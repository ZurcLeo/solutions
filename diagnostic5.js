
console.log('--- Diagnostic 5 Start ---');

console.log('1. Requiring roleController...');
const roleController = require('./controllers/roleController');
console.log('   roleController keys:', Object.keys(roleController));
console.log('   initializeSystem:', roleController.initializeSystem);

console.log('--- Diagnostic 5 Finished ---');
process.exit(0);
