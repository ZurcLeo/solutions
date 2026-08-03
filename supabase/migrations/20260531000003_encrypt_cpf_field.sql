-- RISCO-01: Renomear cpf → cpf_encrypted e adicionar cpf_last4
-- encryptionService.js (AES-256-GCM) é responsável por encrypt/decrypt no backend

ALTER TABLE users
  RENAME COLUMN cpf TO cpf_encrypted;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cpf_last4 TEXT;

COMMENT ON COLUMN users.cpf_encrypted IS
  'CPF criptografado com AES-256-GCM via encryptionService. NUNCA armazenar em plaintext. Decriptografar apenas no backend quando necessário (ex: Asaas).';

COMMENT ON COLUMN users.cpf_last4 IS
  'Últimos 4 dígitos do CPF para referência de UI. Ex: "89". Nunca expor os 11 dígitos.';
