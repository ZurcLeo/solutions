-- =====================================================
-- SCRIPT MANUAL: RLS para Supabase Storage — bucket `contracts/`
-- Descrição: Políticas de Row Level Security no storage.objects
--            para o bucket de contratos digitais.
-- Autor: infra-agent
-- Data: 2026-05-18
-- Dependências: contract_signatories (Sprint Contratos-1), user_roles
--
-- COMO APLICAR:
--   NÃO usar `supabase db push` — o schema `storage` requer superuser.
--   Aplicar via: Supabase Dashboard → SQL Editor → colar e executar.
--   Executar APÓS o Sprint Contratos-1 (depende de contract_signatories).
--
-- POR QUE NÃO É URGENTE:
--   O backend usa SUPABASE_SERVICE_ROLE_KEY que bypassa RLS.
--   Esta policy é defense-in-depth para acesso direto via SDK.
--
-- ESTRUTURA DE PATH ESPERADA:
--   contracts/{caixinha_id}/{contract_id}/contract.pdf.enc
--   contracts/{caixinha_id}/{contract_id}/clicksign_report.pdf.enc
--   path_tokens[1] = caixinha_id
--   path_tokens[2] = contract_id
--   path_tokens[3] = filename
-- =====================================================

-- =====================================================
-- 1. FUNÇÃO AUXILIAR: extrair contract_id do path
-- =====================================================
-- O path dentro do bucket é: {caixinha_id}/{contract_id}/filename
-- storage.foldername(name) retorna array de segmentos de pasta.
-- path_tokens é array: [bucket_id, caixinha_id, contract_id, filename]
-- Usamos (storage.foldername(name))[2] para o contract_id (1-indexed em SQL arrays).

CREATE OR REPLACE FUNCTION storage.get_contract_id_from_path(object_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT split_part(object_name, '/', 2);
$$;

COMMENT ON FUNCTION storage.get_contract_id_from_path IS
  'Extrai o contract_id do path do objeto no bucket contracts/. Path: {caixinha_id}/{contract_id}/filename';

-- =====================================================
-- 2. RLS POLICIES — storage.objects (bucket: contracts)
-- =====================================================
-- O backend usa SUPABASE_SERVICE_ROLE_KEY que bypassa RLS.
-- Estas políticas são defesa em profundidade para chamadas
-- via anon/authenticated key (ex: futuro acesso direto do frontend).
-- =====================================================

-- SELECT: signatários do contrato + admins globais
CREATE POLICY "contracts_select_signatories_and_admins"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'contracts'
  AND (
    -- Admin global pode baixar qualquer contrato
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()::text
        AND ur.role = 'admin'
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    )
    OR
    -- Signatário listado para o contrato pode baixar
    -- (tabela criada no Sprint Contratos-1; política ativa após migration)
    EXISTS (
      SELECT 1 FROM contract_signatories cs
      WHERE cs.contract_id = storage.get_contract_id_from_path(name)
        AND cs.user_id = auth.uid()::text
    )
  )
);

-- INSERT: apenas service_role (backend) — nenhum usuário faz upload direto
-- Sem política de INSERT para authenticated/anon = bloqueado por padrão com RLS ativo.
-- O backend usa service_role key que bypassa RLS; não há policy de INSERT necessária.

-- UPDATE: bloqueado para todos (contratos são imutáveis após geração)
-- Sem policy de UPDATE = bloqueado. O service_role bypassa RLS e pode atualizar
-- apenas via código explícito no ContractService (não via Storage API diretamente).

-- DELETE: bloqueado para todos via RLS (apenas operações internas autorizadas)
-- Sem policy de DELETE = bloqueado. Deleção controlada por retain_until no app.

-- =====================================================
-- 3. COMENTÁRIOS
-- =====================================================

COMMENT ON POLICY "contracts_select_signatories_and_admins"
ON storage.objects IS
  'Permite download de contratos apenas a signatários listados em contract_signatories e admins globais. INSERT/UPDATE/DELETE bloqueados por RLS — apenas service_role (backend) pode operar.';

-- =====================================================
-- 4. NOTA SOBRE A TABELA contract_signatories
-- Esta policy referencia contract_signatories que será criada
-- no Sprint Contratos-1. Enquanto a tabela não existir, a policy
-- de SELECT falha graciosamente (signatários não terão acesso direto,
-- o que é seguro — o backend usa service_role e ignora RLS).
-- =====================================================
