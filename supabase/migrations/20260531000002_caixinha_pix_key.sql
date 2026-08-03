-- Migration: 20260531000002_caixinha_pix_key.sql
-- Adiciona chave PIX opcional do administrador à tabela caixinhas.
--
-- pix_key: chave PIX pessoal do admin para receber contribuições diretas.
--          Nenhuma custódia — o admin recebe diretamente na sua conta pessoal.
--          NULL = sem chave configurada (sem QR code na caixinha).

ALTER TABLE caixinhas
  ADD COLUMN IF NOT EXISTS pix_key TEXT CHECK (
    pix_key IS NULL
    OR length(trim(pix_key)) >= 4
  );

COMMENT ON COLUMN caixinhas.pix_key
  IS 'Chave PIX pessoal do administrador (CPF, e-mail, telefone ou chave aleatória). Sem custódia — pagamentos vão diretamente ao admin.';
