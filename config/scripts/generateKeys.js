// config/scripts/generateKeys.js
const crypto = require('crypto');

// Gerar chave mestra
const masterKey = crypto.randomBytes(32).toString('hex');
console.log('\nChave Mestra (MASTER_ENCRYPTION_KEY):');
console.log(masterKey);

// Gerar chave de criptografia principal
const encryptionKey = crypto.randomBytes(32).toString('hex');
console.log('\nChave de Criptografia (ENCRYPTION_KEY):');
console.log(encryptionKey);

// Gerar chave de criptografia de backup (V1)
const encryptionKeyV1 = crypto.randomBytes(32).toString('hex');
console.log('\nChave de Criptografia V1 (ENCRYPTION_KEY_V1):');
console.log(encryptionKeyV1);

// Gerar chave de criptografia de backup (V2)
const encryptionKeyV2 = crypto.randomBytes(32).toString('hex');
console.log('\nChave de Criptografia V2 (ENCRYPTION_KEY_V2):');
console.log(encryptionKeyV2);

// Gerar chave de criptografia de backup (V3)
const encryptionKeyV3 = crypto.randomBytes(32).toString('hex');
console.log('\nChave de Criptografia V3 (ENCRYPTION_KEY_V3):');
console.log(encryptionKeyV3);

// Criptografar as chaves com a chave mestra
function encryptWithMasterKey(value, masterKey) {
  const key = Buffer.from(masterKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `ENC:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

// Criptografar as chaves
const encryptedMainKey = encryptWithMasterKey(encryptionKey, masterKey);
const encryptedKeyV1 = encryptWithMasterKey(encryptionKeyV1, masterKey);
const encryptedKeyV2 = encryptWithMasterKey(encryptionKeyV2, masterKey);
const encryptedKeyV3 = encryptWithMasterKey(encryptionKeyV3, masterKey);


console.log('\nChaves Criptografadas para o Render:');
console.log(`ENCRYPTION_KEY=${encryptedMainKey}`);
console.log(`ENCRYPTION_KEY_V1=${encryptedKeyV1}`);
console.log(`ENCRYPTION_KEY_V2=${encryptedKeyV2}`);
console.log(`ENCRYPTION_KEY_V3=${encryptedKeyV3}`);

console.log('\n\nIMPORTANTE: Armazene estas chaves em um local seguro!');
console.log('Você precisará da chave mestra para descriptografar as demais chaves.');