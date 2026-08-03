/**
 * @fileoverview bookingAttachmentService — Upload e gestão de documentos
 * Supabase Storage com signed URLs (TTL 1h).
 * D4: retidos 5 anos, depois removidos do Storage.
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const path                  = require('path');
const { v4: uuidv4 }       = require('uuid');

const SERVICE = 'bookingAttachmentService';
const BUCKET  = 'booking-attachments';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_BOOKING = 10;
const SIGNED_URL_TTL = 3600; // 1 hora
const DELETE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
];

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

async function uploadAttachment(bookingId, userId, file, descricao = null) {
  log('uploadAttachment', 'Uploading file', { bookingId, userId, fileName: file.originalname });

  // Validações
  if (!file) throw new Error('Arquivo é obrigatório');
  if (file.size > MAX_FILE_SIZE) throw new Error('Arquivo excede o limite de 10MB');
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    throw new Error(`Tipo de arquivo não permitido: ${file.mimetype}. Permitidos: PDF, JPG, PNG, XLSX, CSV, DOCX`);
  }

  // Verificar limite de arquivos por booking
  const { count } = await sb()
    .from('booking_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', bookingId);

  if (count >= MAX_FILES_PER_BOOKING) {
    throw new Error(`Máximo de ${MAX_FILES_PER_BOOKING} arquivos por booking atingido`);
  }

  // Determinar seller_id para o path (pode ser booking de pendência ou de service)
  const sellerId = 'shared'; // path genérico — pode ser refinado depois
  const ext = path.extname(file.originalname) || '.bin';
  const storagePath = `${sellerId}/${bookingId}/${uuidv4()}${ext}`;

  // Upload para Supabase Storage
  const { error: uploadErr } = await sb().storage
    .from(BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadErr) throw new Error(`Erro no upload: ${uploadErr.message}`);

  // Registrar no banco
  const { data, error } = await sb()
    .from('booking_attachments')
    .insert({
      booking_id:      bookingId,
      uploaded_by:     userId,
      file_name:       file.originalname,
      file_url:        storagePath,
      file_size_bytes: file.size,
      mime_type:       file.mimetype,
      descricao:       descricao || null,
    })
    .select('id, booking_id, uploaded_by, file_name, file_size_bytes, mime_type, descricao, created_at')
    .single();

  if (error) throw new Error(`Erro ao registrar attachment: ${error.message}`);

  // Gamification: attachment_uploaded
  gamificationService.triggerEvent('attachment_uploaded', userId, { booking_id: bookingId })
    .catch(err => logger.warn(`[${SERVICE}] Gamification trigger falhou: ${err.message}`));

  return data;
}

async function listAttachments(bookingId) {
  const { data, error } = await sb()
    .from('booking_attachments')
    .select('id, booking_id, uploaded_by, file_name, file_size_bytes, mime_type, descricao, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Erro ao listar attachments: ${error.message}`);
  return data || [];
}

async function getSignedUrl(attachmentId) {
  const { data: att, error: findErr } = await sb()
    .from('booking_attachments')
    .select('file_url')
    .eq('id', attachmentId)
    .single();

  if (findErr || !att) throw new Error('Attachment não encontrado');

  const { data, error } = await sb().storage
    .from(BUCKET)
    .createSignedUrl(att.file_url, SIGNED_URL_TTL);

  if (error) throw new Error(`Erro ao gerar URL: ${error.message}`);
  return data.signedUrl;
}

async function deleteAttachment(attachmentId, userId) {
  // Verificar ownership e janela de 24h
  const { data: att, error: findErr } = await sb()
    .from('booking_attachments')
    .select('id, uploaded_by, file_url, created_at')
    .eq('id', attachmentId)
    .single();

  if (findErr || !att) throw new Error('Attachment não encontrado');
  if (att.uploaded_by !== userId) throw new Error('Apenas quem fez upload pode remover');

  const createdAt = new Date(att.created_at);
  if (Date.now() - createdAt.getTime() > DELETE_WINDOW_MS) {
    throw new Error('Documentos só podem ser removidos nas primeiras 24 horas');
  }

  // Remover do Storage
  const { error: storageErr } = await sb().storage
    .from(BUCKET)
    .remove([att.file_url]);

  if (storageErr) {
    logger.warn(`[${SERVICE}] Falha ao remover do storage: ${storageErr.message}`);
  }

  // Remover do banco
  const { error: dbErr } = await sb()
    .from('booking_attachments')
    .delete()
    .eq('id', attachmentId);

  if (dbErr) throw new Error(`Erro ao remover: ${dbErr.message}`);

  return { deleted: true };
}

module.exports = {
  uploadAttachment,
  listAttachments,
  getSignedUrl,
  deleteAttachment,
};
