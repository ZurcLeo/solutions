-- =====================================================
-- MIGRAÇÃO: Anti-Panelinha — Pesos decrescentes no Social Score
-- Descrição: Implementa o cálculo do social_score com pesos
--            decrescentes para validadores do mesmo cluster
--            (conexões de 1º e 2º grau), prevenindo que grupos
--            fechados inflem artificialmente a reputação.
--
-- Épico: SOCIAL-KYC | Task: SOCIAL-KYC-006
-- Desbloqueado por: SOCIAL-KYC-001 (migration 20260525000008)
--
-- Funções:
--   calculate_social_score(p_user_id)   — calcula e persiste o score de um usuário
--   recalculate_all_social_scores()     — batch diário (todos os usuários aprovados)
--
-- Algoritmo (documentado em docs/DECISOES.md#social-score-anti-panelinha):
--   1. Para cada validador do usuário (ordenado por validated_at ASC):
--      - Verificar se está no cluster de 1º ou 2º grau via user_connections
--      - Validadores do cluster recebem pesos decrescentes (1ª=1.0, 2ª=0.7, 3ª=0.4, 4ª+=0.1)
--      - Validadores fora do cluster recebem sempre 1.0
--   2. Subtrair penalidades acumuladas (Lastro do Padrinho — kyc_godfather_bonds)
--   3. Garantir score >= 0 (GREATEST)
--
-- Autor: game-agent + compliance-agent (delegado por ClaudIA)
-- Data: 2026-05-25
-- =====================================================


-- =====================================================
-- 1. FUNÇÃO PRINCIPAL: calculate_social_score
-- Calcula e persiste o social_score de um usuário.
-- Idempotente: pode ser chamada múltiplas vezes sem efeitos colaterais.
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_social_score(p_user_id TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_base_score       NUMERIC := 0;
  v_cluster_count    INT     := 0;
  v_weight           NUMERIC;
  v_in_cluster       BOOLEAN;
  v_total_penalties  NUMERIC;
  v_final_score      NUMERIC;
  v_validator        RECORD;
BEGIN
  -- ── Fase 1: Somar pesos das validações recebidas ──────────────────────────
  -- Iterar sobre os validadores ordenados pelo tempo de validação (FIFO)
  -- O ordenamento garante que o 1º validador do cluster receba 1.0,
  -- o 2º receba 0.7, etc.

  FOR v_validator IN
    SELECT v.validator_id
    FROM kyc_social_validations v
    JOIN kyc_social_requests r ON r.id = v.request_id
    WHERE r.user_id = p_user_id
    ORDER BY v.validated_at ASC
  LOOP

    -- Detecção de cluster: 1º grau (direto) OU 2º grau (via intermediário)
    -- user_connections pode ser bidirecional (2 rows) ou unidirecional (1 row),
    -- portanto verificamos ambas as direções.
    SELECT EXISTS (

      -- 1º grau: conexão direta entre p_user_id e o validador
      SELECT 1
      FROM user_connections uc
      WHERE uc.status = 'active'
        AND (
          (uc.user_id           = p_user_id              AND uc.connected_user_id = v_validator.validator_id)
          OR
          (uc.user_id           = v_validator.validator_id AND uc.connected_user_id = p_user_id)
        )

      UNION ALL

      -- 2º grau: p_user_id → intermediário → validador
      SELECT 1
      FROM user_connections uc1
      JOIN user_connections uc2
        ON  uc2.user_id           = uc1.connected_user_id
        AND uc2.connected_user_id = v_validator.validator_id
        AND uc2.status            = 'active'
      WHERE uc1.user_id           = p_user_id
        AND uc1.status            = 'active'
        -- Evitar contar a conexão direta duas vezes
        AND uc1.connected_user_id != v_validator.validator_id

      UNION ALL

      -- 2º grau: validador → intermediário → p_user_id (inverso)
      SELECT 1
      FROM user_connections uc1
      JOIN user_connections uc2
        ON  uc2.user_id           = uc1.connected_user_id
        AND uc2.connected_user_id = p_user_id
        AND uc2.status            = 'active'
      WHERE uc1.user_id           = v_validator.validator_id
        AND uc1.status            = 'active'
        AND uc1.connected_user_id != p_user_id

    ) INTO v_in_cluster;

    IF v_in_cluster THEN
      -- Validador dentro do cluster → pesos decrescentes
      v_cluster_count := v_cluster_count + 1;
      CASE v_cluster_count
        WHEN 1 THEN v_weight := 1.0;
        WHEN 2 THEN v_weight := 0.7;
        WHEN 3 THEN v_weight := 0.4;
        ELSE        v_weight := 0.1;
      END CASE;
    ELSE
      -- Validador fora do cluster → peso total (sem desconto)
      v_weight := 1.0;
    END IF;

    v_base_score := v_base_score + v_weight;
  END LOOP;

  -- ── Fase 2: Subtrair penalidades do Lastro do Padrinho ────────────────────
  -- reputation_penalty_applied armazena penalidades absolutas já aplicadas
  -- quando afilhados do usuário foram banidos (bond_status = 'active' na hora do ban).
  -- Penalidades de vínculos rompidos (bond_status = 'broken') NÃO são subtraídas
  -- pois o padrinho se isentou ao denunciar proativamente.
  SELECT COALESCE(SUM(reputation_penalty_applied), 0)
  INTO v_total_penalties
  FROM kyc_godfather_bonds
  WHERE godfather_id = p_user_id
    AND reputation_penalty_applied > 0;

  v_final_score := GREATEST(0, v_base_score - v_total_penalties);

  -- ── Fase 3: Persistir o score calculado ──────────────────────────────────
  UPDATE users
  SET social_score = v_final_score
  WHERE id = p_user_id;

  RETURN v_final_score;
END;
$$;

COMMENT ON FUNCTION calculate_social_score(TEXT) IS
  '[SOCIAL-KYC-006] Calcula o social_score de um usuário com pesos '
  'decrescentes para validadores do mesmo cluster (anti-panelinha). '
  'Idempotente — pode ser chamada on-demand (após nova validação) ou '
  'em batch pelo job recalculate_all_social_scores (pg_cron 04:00 UTC). '
  'Documentação: docs/DECISOES.md § Social Score Anti-Panelinha.';


-- =====================================================
-- 2. FUNÇÃO BATCH: recalculate_all_social_scores
-- Recalcula o social_score de todos os usuários com KYC aprovado.
-- Chamada pelo job pg_cron diariamente às 04:00 UTC.
-- =====================================================

CREATE OR REPLACE FUNCTION recalculate_all_social_scores()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user    RECORD;
  v_count   INT := 0;
BEGIN
  -- Recalcular apenas usuários com KYC aprovado (têm validações)
  FOR v_user IN
    SELECT DISTINCT r.user_id
    FROM kyc_social_requests r
    WHERE r.status = 'approved'
  LOOP
    PERFORM calculate_social_score(v_user.user_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count; -- Número de usuários recalculados
END;
$$;

COMMENT ON FUNCTION recalculate_all_social_scores() IS
  '[SOCIAL-KYC-006] Recalcula o social_score de todos os usuários '
  'com KYC Social aprovado. Chamada pelo job pg_cron às 04:00 UTC. '
  'Retorna a contagem de usuários processados.';


-- =====================================================
-- 3. JOB pg_cron: recálculo diário às 04:00 UTC
-- Roda 1h após o job de expiração de fotos (03:00 UTC).
-- Fallback: POST /api/kyc-social/admin/recalculate-scores
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'recalculate-social-scores',    -- nome único do job
  '0 4 * * *',                     -- todo dia às 04:00 UTC
  $$ SELECT recalculate_all_social_scores(); $$
);


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar que as funções existem:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('calculate_social_score', 'recalculate_all_social_scores');
-- Esperado: 2 linhas.

-- V2. Testar com usuário real aprovado:
-- SELECT calculate_social_score('uid-de-usuario-aprovado');
-- Esperado: NUMERIC >= 0.

-- V3. Confirmar job no pg_cron:
-- SELECT * FROM cron.job WHERE jobname = 'recalculate-social-scores';
-- Esperado: 1 linha com schedule '0 4 * * *'.
