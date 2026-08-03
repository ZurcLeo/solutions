-- REG-001: Registro Profissional como fonte de verdade em user_preferences
-- Padrão idêntico ao endereço (addr_res_*/addr_com_*): dados pessoais do usuário,
-- seller_profiles mantém sua cópia para exibição pública.

-- 1. Adicionar colunas de registro profissional em user_preferences
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS reg_prof_tipo   TEXT CHECK (reg_prof_tipo IN ('CRC','OAB','CRM','CREA','CAU','COREN','CRP','CRN','outro')),
  ADD COLUMN IF NOT EXISTS reg_prof_numero TEXT,
  ADD COLUMN IF NOT EXISTS reg_prof_uf     TEXT;

-- 2. Backfill: copiar dados existentes de seller_profiles para user_preferences
-- (apenas sellers que já declararam registro e cujo user_preferences já existe)
UPDATE user_preferences up
SET
  reg_prof_tipo   = sp.registro_profissional_tipo,
  reg_prof_numero = sp.registro_profissional_numero,
  reg_prof_uf     = sp.registro_profissional_uf
FROM seller_profiles sp
WHERE sp.user_id = up.user_id
  AND sp.registro_profissional_tipo IS NOT NULL
  AND up.reg_prof_tipo IS NULL;

-- 3. Para sellers que têm registro mas NÃO têm row em user_preferences ainda, inserir
INSERT INTO user_preferences (user_id, reg_prof_tipo, reg_prof_numero, reg_prof_uf)
SELECT sp.user_id, sp.registro_profissional_tipo, sp.registro_profissional_numero, sp.registro_profissional_uf
FROM seller_profiles sp
WHERE sp.registro_profissional_tipo IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM user_preferences up WHERE up.user_id = sp.user_id)
ON CONFLICT (user_id) DO NOTHING;
