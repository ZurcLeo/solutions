-- Migration: adiciona coluna ja3_hash na tabela users
-- Gerada em 2026-05-19 — parte da desconexão do Firestore

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ja3_hash TEXT;

COMMENT ON COLUMN public.users.ja3_hash IS 'TLS fingerprint JA3 hash do cliente (segurança)';
