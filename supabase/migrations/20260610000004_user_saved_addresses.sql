-- 20260610000004_user_saved_addresses.sql
-- Armazena endereços completos (residencial e comercial) em user_preferences
-- e adiciona campos de endereço completo em seller_profiles (logradouro, CEP, número, complemento)
-- para que a loja do vendedor possa ser vinculada ao endereço configurado nas preferências.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Endereços salvos do usuário (user_preferences)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS addr_res_cep         text,        -- CEP residencial (8 dígitos sem máscara)
  ADD COLUMN IF NOT EXISTS addr_res_logradouro  text,        -- Logradouro / rua
  ADD COLUMN IF NOT EXISTS addr_res_numero      text,        -- Número
  ADD COLUMN IF NOT EXISTS addr_res_complemento text,        -- Complemento (apto, bloco…)
  ADD COLUMN IF NOT EXISTS addr_res_bairro      text,        -- Bairro
  ADD COLUMN IF NOT EXISTS addr_res_cidade      text,        -- Cidade
  ADD COLUMN IF NOT EXISTS addr_res_estado      text,        -- UF (2 chars)

  ADD COLUMN IF NOT EXISTS addr_com_cep         text,        -- CEP comercial
  ADD COLUMN IF NOT EXISTS addr_com_logradouro  text,
  ADD COLUMN IF NOT EXISTS addr_com_numero      text,
  ADD COLUMN IF NOT EXISTS addr_com_complemento text,
  ADD COLUMN IF NOT EXISTS addr_com_bairro      text,
  ADD COLUMN IF NOT EXISTS addr_com_cidade      text,
  ADD COLUMN IF NOT EXISTS addr_com_estado      text;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Endereço completo do ponto de retirada / origem da entrega (seller_profiles)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS address_cep         text,        -- CEP da loja
  ADD COLUMN IF NOT EXISTS address_logradouro  text,        -- Rua/Av. da loja
  ADD COLUMN IF NOT EXISTS address_numero      text,        -- Número
  ADD COLUMN IF NOT EXISTS address_complemento text;        -- Sala, andar, etc.

-- Os campos address_neighborhood, address_city, address_state já existem
-- na migration anterior (20260609000006). Não duplicar.

COMMENT ON COLUMN user_preferences.addr_res_cep IS
  'CEP do endereço residencial salvo nas configurações (LGPD: dado pessoal sensível)';
COMMENT ON COLUMN user_preferences.addr_com_cep IS
  'CEP do endereço comercial salvo nas configurações';
COMMENT ON COLUMN seller_profiles.address_cep IS
  'CEP do ponto de retirada ou origem de entrega da loja';
