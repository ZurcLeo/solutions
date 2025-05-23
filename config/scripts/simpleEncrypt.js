// config/scripts/simpleEncrypt.js
const crypto = require('crypto');

// Obter argumentos
const plaintext = process.argv[2];
const masterKey = process.argv[3];

if (!plaintext || !masterKey) {
  console.error('Uso: node config/scripts/simpleEncrypt.js "valor-para-criptografar" "chave-mestra-em-hex"');
  process.exit(1);
}

if (!/^[0-9a-f]{64}$/i.test(masterKey)) {
  console.error('Erro: A chave mestra deve ser uma string hexadecimal de 64 caracteres (32 bytes)');
  process.exit(1);
}

// Função para criptografar
function encryptWithMasterKey(plainValue, masterKey) {
  try {
    const key = Buffer.from(masterKey, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(plainValue, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `ENC:${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('Erro de criptografia:', error.message);
    process.exit(1);
  }
}

// Criptografar o valor
const encryptedValue = encryptWithMasterKey(plaintext, masterKey);

console.log('\nSegredo criptografado:');
console.log('------------------------');
console.log(encryptedValue);
console.log('------------------------');
console.log('\nAdicione esta string como variável de ambiente no Render.');
console.log('Certifique-se de que a chave mestra MASTER_ENCRYPTION_KEY também esteja definida.');