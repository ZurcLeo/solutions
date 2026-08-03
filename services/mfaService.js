/**
 * @fileoverview Servico de autenticacao em dois fatores (2FA)
 * Suporta TOTP (app autenticador), SMS (Firebase Phone Auth) e codigos de backup.
 * Segredos e codigos de backup sao armazenados com criptografia AES-256-CBC.
 *
 * @module services/mfaService
 * @requires speakeasy
 * @requires qrcode
 * @requires crypto
 */

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { logger } = require('../logger');

// Chave de criptografia para segredos TOTP e codigos de backup
// Deve ser uma string hex de 64 caracteres (32 bytes)
const ENCRYPTION_KEY = process.env.DOCUMENT_ENCRYPTION_KEY;

/**
 * Criptografa um texto usando AES-256-CBC.
 * @param {string} text - Texto a ser criptografado
 * @returns {string} Texto criptografado no formato "iv_hex:encrypted_hex"
 */
function encrypt(text) {
  if (!ENCRYPTION_KEY) {
    throw new Error('DOCUMENT_ENCRYPTION_KEY nao esta configurada');
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Descriptografa um texto criptografado com AES-256-CBC.
 * @param {string} text - Texto criptografado no formato "iv_hex:encrypted_hex"
 * @returns {string} Texto original
 */
function decrypt(text) {
  if (!ENCRYPTION_KEY) {
    throw new Error('DOCUMENT_ENCRYPTION_KEY nao esta configurada');
  }
  const [ivHex, encrypted] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

class MFAService {
  /**
   * Gera segredo TOTP + QR code para configuracao do app autenticador.
   * @param {string} userId - ID do usuario
   * @param {string} email - Email do usuario (exibido no app autenticador)
   * @returns {Promise<{secret: string, qrCode: string, manualKey: string}>}
   *   secret: segredo criptografado para armazenamento
   *   qrCode: data URL da imagem QR code
   *   manualKey: chave base32 para entrada manual (exibida uma vez)
   */
  async generateTOTPSetup(userId, email) {
    logger.info('MFAService: gerando setup TOTP', { service: 'mfaService', userId });

    const secret = speakeasy.generateSecret({
      name: `ElosCloud:${email}`,
      issuer: 'ElosCloud',
      length: 32,
    });

    // Adiciona parâmetro image para apps que suportam (Google Authenticator, Authy)
    const otpauthUrl = secret.otpauth_url + '&image=https%3A%2F%2Feloscloud.com%2Flogo192.png';
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Criptografa segredo para armazenamento seguro
    const encryptedSecret = encrypt(secret.base32);

    return {
      secret: encryptedSecret,
      qrCode: qrCodeUrl,
      manualKey: secret.base32,
    };
  }

  /**
   * Verifica um codigo TOTP contra o segredo criptografado.
   * @param {string} encryptedSecret - Segredo TOTP criptografado
   * @param {string} code - Codigo de 6 digitos do app autenticador
   * @returns {boolean} Se o codigo e valido
   */
  verifyTOTPCode(encryptedSecret, code) {
    const secret = decrypt(encryptedSecret);
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: String(code).trim(),
      window: 1, // Permite 30s de desvio de relogio
    });
  }

  /**
   * Gera 10 codigos de backup aleatorios (8 caracteres hex cada).
   * @returns {string[]} Array de 10 codigos de backup em maiusculo
   */
  generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 10; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    logger.info('MFAService: codigos de backup gerados', { service: 'mfaService', count: codes.length });
    return codes;
  }

  /**
   * Criptografa codigos de backup para armazenamento.
   * @param {string[]} codes - Array de codigos de backup
   * @returns {string} Codigos criptografados
   */
  encryptBackupCodes(codes) {
    return encrypt(JSON.stringify(codes));
  }

  /**
   * Descriptografa e retorna codigos de backup.
   * @param {string} encrypted - Codigos criptografados
   * @returns {string[]} Array de codigos de backup
   */
  decryptBackupCodes(encrypted) {
    return JSON.parse(decrypt(encrypted));
  }

  /**
   * Usa um codigo de backup (remove da lista, re-criptografa os restantes).
   * @param {string} encryptedCodes - Codigos de backup criptografados
   * @param {string} code - Codigo de backup informado pelo usuario
   * @returns {{valid: boolean, remaining: string|null, count: number}}
   */
  useBackupCode(encryptedCodes, code) {
    const codes = this.decryptBackupCodes(encryptedCodes);
    const normalizedCode = String(code).trim().toUpperCase();
    const index = codes.indexOf(normalizedCode);

    if (index === -1) {
      logger.warn('MFAService: codigo de backup invalido', { service: 'mfaService' });
      return { valid: false, remaining: null, count: codes.length };
    }

    codes.splice(index, 1);
    logger.info('MFAService: codigo de backup utilizado', {
      service: 'mfaService',
      remainingCount: codes.length,
    });

    return {
      valid: true,
      remaining: this.encryptBackupCodes(codes),
      count: codes.length,
    };
  }
}

module.exports = new MFAService();
