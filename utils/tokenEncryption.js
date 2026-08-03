'use strict';

const crypto = require('crypto');

// Chave derivada da env var ML_TOKEN_ENCRYPTION_KEY (32 bytes hex ou base64)
function _getKey() {
    const raw = process.env.ML_TOKEN_ENCRYPTION_KEY;
    if (!raw) throw new Error('ML_TOKEN_ENCRYPTION_KEY not configured');
    // Aceita hex (64 chars) ou base64 (44 chars)
    if (raw.length === 64) return Buffer.from(raw, 'hex');
    return Buffer.from(raw, 'base64');
}

/**
 * Criptografa texto com AES-256-GCM.
 * Retorna: iv:authTag:ciphertext (tudo hex, separado por ':')
 */
function encrypt(plaintext) {
    const key = _getKey();
    const iv = crypto.randomBytes(12); // 96-bit IV para GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Descriptografa texto AES-256-GCM.
 * Espera formato: iv:authTag:ciphertext (hex)
 */
function decrypt(encryptedStr) {
    const key = _getKey();
    const [ivHex, authTagHex, ciphertext] = encryptedStr.split(':');
    if (!ivHex || !authTagHex || !ciphertext) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

module.exports = { encrypt, decrypt };
