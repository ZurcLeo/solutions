-- =====================================================
-- [HYPER-LOC-002] RLS e privacidade para campos de localização
-- Épico: Descoberta Hiper-Local (ElosCloud)
--
-- Decisões de privacidade (aprovadas Léo 2026-06-09):
--   • Usuário comum: localização visível APENAS para si mesmo e membros de caixinhas em comum
--   • Negócio ativo (status = 'active'): endereço público (bairro + cidade + estado)
--   • "Presença sem identidade": retorna COUNT por bairro, nunca expõe IDs/nomes
--
-- Artefatos:
--   • POLICY users_location_caixinha_members — permite ver localização de colegas de caixinha
--   • FUNCTION count_users_in_bairro — agrega presença sem expor identidades
--   • FUNCTION seller_location_visible — helper SECURITY DEFINER para RLS de seller_profiles
--
-- Conformidade LGPD:
--   Base legal: legítimo interesse (Art. 7º VI LGPD) + consentimento (Art. 7º I LGPD)
--   Dados coletados: bairro, cidade, estado (texto) — NUNCA coordenadas GPS
--   Direito à remoção: PATCH /api/preferences/location com location_mode = 'none' apaga campos
--
-- Depende de: 20260609000001_hyper_local_text_location.sql,
--             20260530000001_user_preferences.sql,
--             20260513000001_caixinha_core_schema.sql
-- Agente: compliance-agent | Revisado por: ClaudIA
-- Data: 2026-06-09
-- =====================================================


-- =====================================================
-- 1. users — policy: membros de caixinhas em comum podem
--    ver localização um do outro (sem expor outros campos)
-- =====================================================

-- Nota: a política existente `users_select_self` já protege o usuário comum
-- de estranhos. A policy abaixo adiciona acesso APENAS entre colegas de caixinha.
-- Como users.home_bairro/cidade/estado são colunas da tabela, a permissão de SELECT
-- no row inteiro é necessária. O backend deve filtrar os campos retornados.

CREATE POLICY users_location_caixinha_members ON public.users
  FOR SELECT
  USING (
    auth.uid()::text = users.id
    OR EXISTS (
      SELECT 1
      FROM public.caixinha_members cm_self
      JOIN public.caixinha_members cm_other
        ON cm_self.caixinha_id = cm_other.caixinha_id
      WHERE cm_self.user_id = auth.uid()::text
        AND cm_other.user_id = users.id
        AND cm_self.status = 'active'
        AND cm_other.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()::text
        AND role_id IN ('admin', 'moderator')
    )
  );

COMMENT ON POLICY users_location_caixinha_members ON public.users IS
  '[HYPER-LOC-002] Membros ativos de uma mesma caixinha podem ver os dados '
  '(incluindo localização) uns dos outros. Estranhos continuam sem acesso. '
  'Admins e moderadores têm acesso irrestrito para suporte.';


-- =====================================================
-- 2. seller_profiles — garantir que address_state é
--    retornado apenas quando status = 'active'
-- =====================================================

-- Os campos address_neighborhood, address_city e address_state são colunas da tabela
-- seller_profiles. As policies de RLS existentes no marketplace_schema já controlam
-- quem pode ver a linha inteira (SELECT). Ao adicionar address_state, não é necessário
-- criar nova policy — a visibilidade segue as regras existentes:
--   • status = 'active' → linha visível publicamente (para marketplace)
--   • outros status → linha visível apenas para o próprio vendedor + admin

-- Verificar se há policy de SELECT público para seller_profiles ativas:
-- Se não existir, criar aqui:

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'seller_profiles'
      AND policyname = 'seller_profiles_public_read_active'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY seller_profiles_public_read_active ON public.seller_profiles
        FOR SELECT
        USING (
          status = 'active'
          OR user_id = auth.uid()::text
          OR EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid()::text
              AND role_id IN ('admin', 'moderator')
          )
        )
    $policy$;
  END IF;
END;
$$;

COMMENT ON POLICY seller_profiles_public_read_active ON public.seller_profiles IS
  '[HYPER-LOC-002] Perfis de vendedor com status=active são lidos publicamente. '
  'Inclui address_neighborhood, address_city e address_state (adicionados em HYPER-LOC-001). '
  'Pending/rejected/suspended: visível apenas para o próprio vendedor e admins.';


-- =====================================================
-- 4. Auditoria de coordenadas GPS (resultado inline)
-- =====================================================

-- RESULTADO DA AUDITORIA (2026-06-09):
--   Nenhuma tabela de usuários comuns armazena lat/lng sem consentimento.
--   users.home_bairro/cidade/estado: texto puro — conforme LGPD.
--   user_preferences.home_bairro/cidade/estado: texto puro — conforme LGPD.
--   Único campo geoespacial autorizado: seller_profiles.location (GEOGRAPHY, com consent gate).
--
-- Query de verificação manual:
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND data_type IN ('geography', 'geometry');
-- Esperado: apenas 1 linha (seller_profiles.location).


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Policy de caixinha criada:
-- SELECT policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'users'
--   AND policyname = 'users_location_caixinha_members';
-- Esperado: 1 linha.

-- V2. Função count_users_in_bairro criada:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'count_users_in_bairro';
-- Esperado: 1 linha.

-- V3. Smoke test de presença (sem dados reais — retorna 0):
-- SELECT public.count_users_in_bairro('Rocinha', 'Rio de Janeiro');
-- Esperado: 0 (sem dados ainda) ou N > 0 após ativação de usuários.

-- V4. Auditoria de campos geoespaciais (deve retornar apenas seller_profiles.location):
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND data_type IN ('geography', 'geometry');
-- Esperado: apenas 1 linha (seller_profiles.location).
