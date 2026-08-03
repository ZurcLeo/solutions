/**
 * @fileoverview Helper centralizado para construir URLs de assets usados em emails.
 *
 * Em produção as imagens de email (QR codes, logos, default avatars, etc.) são
 * armazenadas no Supabase Storage (bucket `eloscloud-public`, path `email/...`)
 * e servidas via rewrite do Firebase Hosting em:
 *
 *   https://eloscloud.com/emails/assets/{path}
 *
 * Este módulo garante que todas as URLs de assets de email apontem para o
 * domínio próprio, eliminando dependência de URLs diretas do Supabase Storage
 * em templates e serviços.
 *
 * Mapeamento:
 *   ANTES  → https://<ref>.supabase.co/storage/v1/object/public/eloscloud-public/email/{path}
 *   DEPOIS → https://eloscloud.com/emails/assets/{path}
 *
 * @module utils/emailAssets
 */

/**
 * Base URL dos assets de email, configurável via env var para flexibilidade
 * em ambientes de staging/dev.
 *
 * Fly.io secret (opcional):
 *   EMAIL_ASSETS_BASE_URL=https://eloscloud.com/emails/assets
 *
 * @type {string}
 */
const EMAIL_ASSETS_BASE_URL =
  process.env.EMAIL_ASSETS_BASE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://eloscloud.com/emails/assets'
    : 'https://eloscloud.com/emails/assets');

/**
 * Constrói a URL pública de um asset de email a partir do seu path relativo
 * dentro do bucket (sem o prefixo `email/`).
 *
 * @param {string} relativePath - Caminho relativo do asset (ex: `qrcodes/abc.png`,
 *   `logos/logo.png`, `defaults/profile.png`).
 * @returns {string} URL pública completa (ex: `https://eloscloud.com/emails/assets/qrcodes/abc.png`).
 *
 * @example
 *   const { emailAssetUrl } = require('../utils/emailAssets');
 *   const url = emailAssetUrl('qrcodes/abc-123.png');
 *   // → 'https://eloscloud.com/emails/assets/qrcodes/abc-123.png'
 *
 * @example
 *   const url = emailAssetUrl('defaults/profile.png');
 *   // → 'https://eloscloud.com/emails/assets/defaults/profile.png'
 */
const emailAssetUrl = (relativePath) => {
  // Remove barra inicial duplicada, se houver
  const cleanPath = relativePath.replace(/^\/+/, '');
  return `${EMAIL_ASSETS_BASE_URL}/${cleanPath}`;
};

/**
 * Path de upload no Supabase Storage para assets de email.
 * O bucket é `eloscloud-public` e o prefixo é `email/`.
 *
 * @param {string} relativePath - Caminho relativo (ex: `qrcodes/abc.png`).
 * @returns {string} Path completo para upload (ex: `email/qrcodes/abc.png`).
 *
 * @example
 *   const { emailStoragePath } = require('../utils/emailAssets');
 *   const path = emailStoragePath('qrcodes/abc-123.png');
 *   // → 'email/qrcodes/abc-123.png'
 */
const emailStoragePath = (relativePath) => {
  const cleanPath = relativePath.replace(/^\/+/, '');
  return `email/${cleanPath}`;
};

/**
 * Nome do bucket no Supabase Storage onde ficam os assets de email.
 * @type {string}
 */
const EMAIL_STORAGE_BUCKET = 'eloscloud-public';

module.exports = {
  EMAIL_ASSETS_BASE_URL,
  EMAIL_STORAGE_BUCKET,
  emailAssetUrl,
  emailStoragePath,
};
