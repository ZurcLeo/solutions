-- Migration: adiciona cpf_encrypted em user_kyc_verifications
-- Necessário para que a aprovação manual (admin) copie o CPF criptografado para users.
-- Sem esta coluna, após aprovação manual o campo users.cpf_encrypted permanecia NULL,
-- bloqueando a validação PIX com "CPF não verificado".

ALTER TABLE public.user_kyc_verifications
  ADD COLUMN IF NOT EXISTS cpf_encrypted JSONB;

COMMENT ON COLUMN public.user_kyc_verifications.cpf_encrypted
  IS 'CPF criptografado (AES-256-GCM, mesmo esquema de users.cpf_encrypted). '
     'Preenchido apenas quando status = manual_review, para que a aprovação pelo admin '
     'possa copiar o valor para users.cpf_encrypted. Nunca retornado em queries de leitura pública.';
