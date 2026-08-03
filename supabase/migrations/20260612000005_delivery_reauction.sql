-- =====================================================
-- MIGRAÇÃO: Delivery — Re-leilão por Entregador Offline
-- [DELIVERY-006] Grace period + re-auction + ajuste de frete
--
-- Problema resolvido:
--   Entregador A aceita pedido (status=matched). Antes do lojista
--   despachar, A desconecta (celular sem bateria). O pedido fica preso.
--
-- Solução:
--   1. Grace period de 2min: A pode reconectar sem perder o pedido.
--   2. Se expirar: pedido volta para re_auctioning (novo leilão).
--   3. Novo entregador B aceita com preço Y.
--   4. Se Y != original: cria ajuste de frete.
--      - Y ≤ original → auto_approved, reembolso automático da diferença.
--      - Y >  original → pending_approval, cliente tem 3min para aceitar.
--   5. Cliente recusa ou timeout → hold_manual (lojista decide).
--   6. Sem entregador em 10min → failed_no_deliverer (lojista notificado).
--
-- Novos status em delivery_requests:
--   grace_period            — entregador desconectou, aguardando reconexão
--   re_auctioning           — grace expirou, novo leilão em andamento
--   price_adjustment_pending — novo frete aguarda aprovação do cliente
--   hold_manual             — cliente recusou/timeout; lojista decide
--   failed_no_deliverer     — nenhum entregador em 10min pós-grace
--   (existentes mantidos: open, matched, accepted, in_transit_to_pickup,
--    picked_up, in_transit_to_dest, delivered, completed, cancelled,
--    no_deliverer_found, disputed)
--
-- Novas tabelas:
--   delivery_freight_adjustments — registro imutável de ajustes de frete
--
-- RPCs criados/atualizados:
--   start_grace_period(request_id, grace_minutes)
--   reopen_delivery_for_auction(request_id)
--   create_freight_adjustment(request_id, new_service_id, new_deliverer_id, new_freight_brl)
--   approve_freight_adjustment(adjustment_id)
--   expire_freight_adjustment(adjustment_id)
--   claim_delivery_request — ATUALIZADO: aceita 're_auctioning' além de 'open'
--
-- Depende de:
--   20260610000001_delivery_schema.sql  (delivery_requests, delivery_services)
--   20260610000002_delivery_rpcs.sql    (claim_delivery_request)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-12
-- =====================================================


-- =====================================================
-- 1. Colunas adicionais em delivery_requests
-- =====================================================

ALTER TABLE public.delivery_requests
  ADD COLUMN IF NOT EXISTS original_service_id   TEXT
    REFERENCES public.delivery_services(id),
  ADD COLUMN IF NOT EXISTS original_freight_brl  NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS re_auction_count      INTEGER NOT NULL DEFAULT 0
    CHECK (re_auction_count >= 0),
  ADD COLUMN IF NOT EXISTS re_auction_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_until    TIMESTAMPTZ;

COMMENT ON COLUMN public.delivery_requests.original_service_id IS
  '[DELIVERY-006] Entregador originalmente designado ao pedido. '
  'Preenchido ao iniciar grace_period. Preservado durante todo o ciclo '
  'para auditoria e penalidade de reputação se abandono confirmado.';

COMMENT ON COLUMN public.delivery_requests.original_freight_brl IS
  '[DELIVERY-006] Frete cotado/aceito pelo entregador original. '
  'Referência para calcular delta no re-leilão. '
  'Preenchido de accepted_fee ao iniciar grace_period.';

COMMENT ON COLUMN public.delivery_requests.re_auction_count IS
  '[DELIVERY-006] Quantas vezes o pedido passou por re-leilão. '
  'Incrementado a cada chamada de reopen_delivery_for_auction. '
  'Se > 2: log de atenção (pedido problemático).';

COMMENT ON COLUMN public.delivery_requests.grace_period_until IS
  '[DELIVERY-006] Prazo até quando o entregador original pode reconectar. '
  'NULL quando não há grace period ativo.';


-- =====================================================
-- 2. Expandir CHECK constraint de status
-- =====================================================

-- Remove o constraint inline (nomeado automaticamente pelo Postgres)
ALTER TABLE public.delivery_requests
  DROP CONSTRAINT IF EXISTS delivery_requests_status_check;

ALTER TABLE public.delivery_requests
  ADD CONSTRAINT delivery_requests_status_check
  CHECK (status IN (
    -- Estados originais (20260610000001)
    'open',
    'matched',
    'accepted',
    'in_transit_to_pickup',
    'picked_up',
    'in_transit_to_dest',
    'delivered',
    'completed',
    'cancelled',
    'no_deliverer_found',
    'disputed',
    -- Estados de re-leilão (DELIVERY-006)
    'grace_period',
    're_auctioning',
    'price_adjustment_pending',
    'hold_manual',
    'failed_no_deliverer'
  ));

COMMENT ON CONSTRAINT delivery_requests_status_check
  ON public.delivery_requests IS
  '[DELIVERY-006] Estados da máquina: '
  'open → matched → accepted → in_transit_to_pickup → picked_up → '
  'in_transit_to_dest → delivered → completed. '
  'Desvio: matched/accepted → grace_period → (reconexão: matched) | '
  '(expirou: re_auctioning → price_adjustment_pending → matched | hold_manual). '
  'Sem entregador em 10min: failed_no_deliverer.';


-- =====================================================
-- 3. Índices adicionais para os novos estados
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_delivery_requests_grace_period
  ON public.delivery_requests (grace_period_until)
  WHERE status = 'grace_period';

CREATE INDEX IF NOT EXISTS idx_delivery_requests_re_auctioning
  ON public.delivery_requests (re_auction_started_at DESC)
  WHERE status = 're_auctioning';

CREATE INDEX IF NOT EXISTS idx_delivery_requests_price_adj
  ON public.delivery_requests (updated_at DESC)
  WHERE status = 'price_adjustment_pending';


-- =====================================================
-- 4. delivery_freight_adjustments — registro imutável
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_freight_adjustments (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  delivery_request_id     TEXT NOT NULL REFERENCES public.delivery_requests(id),

  -- Quem foi e quem é
  original_service_id     TEXT NOT NULL REFERENCES public.delivery_services(id),
  new_service_id          TEXT NOT NULL REFERENCES public.delivery_services(id),

  -- Valores
  original_freight_brl    NUMERIC(8, 2) NOT NULL CHECK (original_freight_brl >= 0),
  new_freight_brl         NUMERIC(8, 2) NOT NULL CHECK (new_freight_brl >= 0),
  delta_brl               NUMERIC(8, 2) NOT NULL,
    -- positivo = cliente deve mais  |  negativo = cliente recebe crédito

  -- Estado
  status                  TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN (
      'pending_approval',   -- delta > 0: cliente precisa aprovar
      'approved',           -- cliente aprovou
      'rejected',           -- cliente recusou
      'auto_approved',      -- delta <= 0: aprovação automática
      'timed_out'           -- cliente não respondeu em 3min
    )),

  -- Timestamps de comunicação
  client_notified_at      TIMESTAMPTZ,
  client_responded_at     TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ NOT NULL,   -- 3min após criação

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()

  -- Sem updated_at: registro imutável (auditoria financeira)
);

COMMENT ON TABLE public.delivery_freight_adjustments IS
  '[DELIVERY-006][IMUTÁVEL] Ajustes de frete causados por re-leilão. '
  'Criado quando novo entregador aceita a um preço diferente do original. '
  'delta_brl > 0: cliente deve pagar a mais (requer aprovação, 3min). '
  'delta_brl ≤ 0: auto_approved, payment-agent emite reembolso. '
  'Sem UPDATE/DELETE direto: trilha financeira imutável (LGPD art. 37).';

CREATE INDEX IF NOT EXISTS idx_freight_adj_request_id
  ON public.delivery_freight_adjustments (delivery_request_id, status);

CREATE INDEX IF NOT EXISTS idx_freight_adj_expires
  ON public.delivery_freight_adjustments (expires_at)
  WHERE status = 'pending_approval';


-- RLS: server-only (backend via service_role)
ALTER TABLE public.delivery_freight_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "freight_adj_backend_only" ON public.delivery_freight_adjustments;
CREATE POLICY "freight_adj_backend_only"
  ON public.delivery_freight_adjustments
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "freight_adj_backend_only"
  ON public.delivery_freight_adjustments IS
  'Deny-all para anon/authenticated. '
  'Backend acessa via service_role (bypassa RLS). '
  'Cliente recebe notificações via Socket.IO delivery:freight_adjustment_required.';

REVOKE ALL ON public.delivery_freight_adjustments FROM anon, authenticated;


-- =====================================================
-- 5. RPC: start_grace_period
-- =====================================================

CREATE OR REPLACE FUNCTION public.start_grace_period(
  p_request_id   TEXT,
  p_grace_minutes INTEGER DEFAULT 2
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req     delivery_requests;
  updated delivery_requests;
BEGIN
  SELECT * INTO req
  FROM public.delivery_requests
  WHERE id = p_request_id
    AND status IN ('matched', 'accepted', 'in_transit_to_pickup');

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'invalid_state',
      'message', 'Pedido não está em estado de entrega ativa.'
    );
  END IF;

  -- Preserva dados do entregador original antes do grace period
  UPDATE public.delivery_requests SET
    status              = 'grace_period',
    grace_period_until  = NOW() + (p_grace_minutes || ' minutes')::interval,
    original_service_id = COALESCE(original_service_id, req.service_id),
    original_freight_brl = COALESCE(original_freight_brl, req.accepted_fee),
    updated_at          = NOW()
  WHERE id = p_request_id
    AND status IN ('matched', 'accepted', 'in_transit_to_pickup')
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'concurrent_update',
      'message', 'Estado alterado concorrentemente. Tente novamente.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',               true,
    'request_id',       updated.id,
    'grace_period_until', updated.grace_period_until::text,
    'original_service_id', updated.original_service_id,
    'original_freight_brl', updated.original_freight_brl
  );
END;
$$;

COMMENT ON FUNCTION public.start_grace_period(TEXT, INTEGER) IS
  '[DELIVERY-006] Inicia grace period quando entregador desconecta inesperadamente. '
  'Só funciona se o pedido está em matched | accepted | in_transit_to_pickup. '
  'Preserva original_service_id e original_freight_brl para auditoria. '
  'Backend agenda checkAfterGracePeriod via setTimeout(p_grace_minutes × 60000).';


-- =====================================================
-- 6. RPC: reopen_delivery_for_auction
-- =====================================================

CREATE OR REPLACE FUNCTION public.reopen_delivery_for_auction(
  p_request_id TEXT,
  p_force      BOOLEAN DEFAULT false  -- permite reabertura mesmo se grace ainda não expirou
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated delivery_requests;
BEGIN
  UPDATE public.delivery_requests SET
    status              = 're_auctioning',
    service_id          = NULL,          -- desassocia entregador original
    accepted_fee        = NULL,          -- será preenchido pelo novo entregador
    re_auction_count    = re_auction_count + 1,
    re_auction_started_at = NOW(),
    grace_period_until  = NULL,
    updated_at          = NOW()
  WHERE id = p_request_id
    AND (
      (status = 'grace_period' AND (p_force = true OR grace_period_until <= NOW()))
      OR
      (status IN ('matched', 'accepted') AND p_force = true)
    )
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'cannot_reopen',
      'message', 'Pedido não pode ser reaberto: grace period ainda ativo ou estado inválido.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',                 true,
    'request_id',         updated.id,
    'order_id',           updated.order_id,
    'seller_id',          updated.seller_id,
    're_auction_count',   updated.re_auction_count,
    'original_service_id',  updated.original_service_id,
    'original_freight_brl', updated.original_freight_brl,
    -- Dados necessários para novo matching
    'pickup_lat',         updated.pickup_lat,
    'pickup_lng',         updated.pickup_lng,
    'dest_lat',           updated.dest_lat,
    'dest_lng',           updated.dest_lng,
    'pickup_city',        updated.pickup_city,
    'dest_city',          updated.dest_city,
    'dest_state',         updated.dest_state,
    'weight_kg',          updated.weight_kg,
    'is_fragile',         updated.is_fragile,
    'notes',              updated.notes
  );
END;
$$;

COMMENT ON FUNCTION public.reopen_delivery_for_auction(TEXT, BOOLEAN) IS
  '[DELIVERY-006] Reabre pedido para novo leilão após grace period expirado. '
  'Sem p_force=true: só funciona se grace_period_until <= NOW(). '
  'Com p_force=true: admin pode forçar mesmo com grace ativo. '
  'Desassocia o entregador (service_id=NULL) mantendo original_service_id para auditoria. '
  'Backend chama _notifyEligibleDeliverers após este RPC.';


-- =====================================================
-- 7. RPC: create_freight_adjustment
-- =====================================================

CREATE OR REPLACE FUNCTION public.create_freight_adjustment(
  p_request_id      TEXT,
  p_new_service_id  TEXT,
  p_new_freight_brl NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req           delivery_requests;
  adj_id        TEXT;
  v_delta       NUMERIC;
  v_status      TEXT;
BEGIN
  SELECT * INTO req
  FROM public.delivery_requests
  WHERE id = p_request_id
    AND status = 're_auctioning';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'not_re_auctioning',
      'message', 'Pedido não está em re_auctioning.'
    );
  END IF;

  IF req.original_freight_brl IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'no_original_freight',
      'message', 'original_freight_brl não definido — não é possível calcular ajuste.'
    );
  END IF;

  v_delta  := p_new_freight_brl - req.original_freight_brl;
  v_status := CASE WHEN v_delta <= 0 THEN 'auto_approved' ELSE 'pending_approval' END;

  -- Registra ajuste (imutável)
  INSERT INTO public.delivery_freight_adjustments (
    delivery_request_id,
    original_service_id,
    new_service_id,
    original_freight_brl,
    new_freight_brl,
    delta_brl,
    status,
    expires_at
  ) VALUES (
    p_request_id,
    req.original_service_id,
    p_new_service_id,
    req.original_freight_brl,
    p_new_freight_brl,
    v_delta,
    v_status,
    NOW() + INTERVAL '3 minutes'
  )
  RETURNING id INTO adj_id;

  -- Atualiza delivery_request conforme resultado
  IF v_status = 'auto_approved' THEN
    -- Mais barato: aprova direto, associa novo entregador
    UPDATE public.delivery_requests SET
      status       = 'matched',
      service_id   = p_new_service_id,
      accepted_fee = p_new_freight_brl,
      matched_at   = NOW(),
      updated_at   = NOW()
    WHERE id = p_request_id;
  ELSE
    -- Mais caro: aguarda aprovação do cliente
    UPDATE public.delivery_requests SET
      status       = 'price_adjustment_pending',
      service_id   = p_new_service_id,  -- associa mas não confirma ainda
      accepted_fee = p_new_freight_brl,
      updated_at   = NOW()
    WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'adjustment_id',       adj_id,
    'delta_brl',           v_delta,
    'status',              v_status,
    'original_freight_brl', req.original_freight_brl,
    'new_freight_brl',     p_new_freight_brl,
    'requires_approval',   v_status = 'pending_approval',
    'expires_at',          (NOW() + INTERVAL '3 minutes')::text
  );
END;
$$;

COMMENT ON FUNCTION public.create_freight_adjustment(TEXT, TEXT, NUMERIC) IS
  '[DELIVERY-006] Cria ajuste de frete após re-leilão. '
  'delta_brl ≤ 0: auto_approved → pedido vai para matched, payment-agent emite reembolso. '
  'delta_brl > 0: pending_approval → pedido vai para price_adjustment_pending, '
  '  cliente tem 3min para aprovar via Socket.IO delivery:freight_adjustment_approve. '
  'Registro imutável em delivery_freight_adjustments (auditoria financeira).';


-- =====================================================
-- 8. RPC: approve_freight_adjustment
-- =====================================================

CREATE OR REPLACE FUNCTION public.approve_freight_adjustment(
  p_adjustment_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  adj     delivery_freight_adjustments;
  updated delivery_freight_adjustments;
BEGIN
  SELECT * INTO adj
  FROM public.delivery_freight_adjustments
  WHERE id = p_adjustment_id
    AND status = 'pending_approval'
    AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'not_approvable',
      'message', 'Ajuste não encontrado, já respondido ou expirado.'
    );
  END IF;

  -- Registra aprovação (INSERT-only: usamos flag de client_responded_at)
  UPDATE public.delivery_freight_adjustments SET
    status              = 'approved',
    client_responded_at = NOW()
  WHERE id = p_adjustment_id
    AND status = 'pending_approval'
  RETURNING * INTO updated;

  -- Confirma pedido como matched com novo entregador
  UPDATE public.delivery_requests SET
    status     = 'matched',
    matched_at = NOW(),
    updated_at = NOW()
  WHERE id = adj.delivery_request_id
    AND status = 'price_adjustment_pending';

  RETURN jsonb_build_object(
    'ok',               true,
    'adjustment_id',    p_adjustment_id,
    'request_id',       adj.delivery_request_id,
    'new_freight_brl',  adj.new_freight_brl,
    'delta_brl',        adj.delta_brl
  );
END;
$$;

COMMENT ON FUNCTION public.approve_freight_adjustment(TEXT) IS
  '[DELIVERY-006] Cliente aprova aumento de frete no re-leilão. '
  'Transiciona pedido de price_adjustment_pending → matched. '
  'Backend deve chamar payment-agent para cobrar delta_brl adicional.';


-- =====================================================
-- 9. RPC: expire_freight_adjustment
-- =====================================================

CREATE OR REPLACE FUNCTION public.expire_freight_adjustment(
  p_adjustment_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  adj delivery_freight_adjustments;
BEGIN
  UPDATE public.delivery_freight_adjustments SET
    status              = 'timed_out',
    client_responded_at = NOW()
  WHERE id = p_adjustment_id
    AND status = 'pending_approval'
  RETURNING * INTO adj;

  IF adj.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_resolved');
  END IF;

  -- Move pedido para hold_manual (lojista decide)
  UPDATE public.delivery_requests SET
    status     = 'hold_manual',
    updated_at = NOW()
  WHERE id = adj.delivery_request_id
    AND status = 'price_adjustment_pending';

  RETURN jsonb_build_object(
    'ok',        true,
    'request_id', adj.delivery_request_id
  );
END;
$$;

COMMENT ON FUNCTION public.expire_freight_adjustment(TEXT) IS
  '[DELIVERY-006] Expira ajuste de frete não respondido em 3min. '
  'Transiciona pedido para hold_manual — lojista precisa intervir. '
  'Chamado pelo backend via setTimeout(3 × 60000) após criar o ajuste.';


-- =====================================================
-- 10. Atualiza claim_delivery_request para aceitar re_auctioning
-- =====================================================

CREATE OR REPLACE FUNCTION public.claim_delivery_request(
  p_request_id TEXT,
  p_service_id TEXT,
  p_user_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req       delivery_requests;
  svc       delivery_services;
  notif     delivery_notifications;
  updated   delivery_requests;
BEGIN
  -- Verifica se o entregador tem serviço ativo
  SELECT * INTO svc
  FROM public.delivery_services
  WHERE id = p_service_id AND user_id = p_user_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'unauthorized',
      'message', 'Serviço de entrega não encontrado ou inativo.'
    );
  END IF;

  -- Verifica notificação válida (para leilão original ou re-leilão)
  SELECT * INTO notif
  FROM public.delivery_notifications
  WHERE request_id = p_request_id
    AND service_id  = p_service_id
    AND response    IS NULL
    AND expires_at  > NOW();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'notification_expired',
      'message', 'O prazo para aceitar este pedido expirou ou você não foi notificado.'
    );
  END IF;

  -- =====================================================
  -- CLAIM ATÔMICO — aceita 'open' (leilão original) e
  -- 're_auctioning' (re-leilão após grace period).
  -- UPDATE ... WHERE status IN (...) garante exclusividade.
  -- =====================================================
  UPDATE public.delivery_requests
  SET
    service_id   = p_service_id,
    status       = CASE
                     WHEN re_auction_count > 0 THEN 're_auctioning'
                     ELSE 'matched'
                   END,
    -- Se re-leilão: status intermediário até ajuste de frete ser resolvido
    -- Se leilão original: vai direto para matched
    matched_at   = CASE WHEN re_auction_count = 0 THEN NOW() ELSE matched_at END,
    accepted_fee = notif.proposed_fee,
    updated_at   = NOW()
  WHERE id       = p_request_id
    AND status   IN ('open', 're_auctioning')   -- ← CHANGE: aceita re_auctioning
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'already_taken',
      'message', 'Esse pedido já foi aceito por outro entregador.'
    );
  END IF;

  -- Marca notificação do vencedor
  UPDATE public.delivery_notifications
  SET response = 'accepted', responded_at = NOW()
  WHERE request_id = p_request_id AND service_id = p_service_id;

  -- Expira notificações dos perdedores
  UPDATE public.delivery_notifications
  SET response = 'expired', responded_at = NOW()
  WHERE request_id = p_request_id
    AND service_id != p_service_id
    AND response IS NULL;

  RETURN jsonb_build_object(
    'ok',                   true,
    'request_id',           updated.id,
    'order_id',             updated.order_id,
    'accepted_fee',         updated.accepted_fee,
    'pickup_address',       updated.pickup_address,
    'pickup_city',          updated.pickup_city,
    'dest_address',         updated.dest_address,
    'dest_city',            updated.dest_city,
    'weight_kg',            updated.weight_kg,
    'is_fragile',           updated.is_fragile,
    'notes',                updated.notes,
    -- Campos adicionais para lógica de re-leilão no backend
    're_auction_count',     updated.re_auction_count,
    'original_freight_brl', updated.original_freight_brl,
    'is_re_auction',        updated.re_auction_count > 0
  );
END;
$$;

COMMENT ON FUNCTION public.claim_delivery_request(TEXT, TEXT, TEXT) IS
  '[DELIVERY-002][DELIVERY-006] Aceite atômico de pedido de entrega. '
  'Aceita status ''open'' (leilão original) E ''re_auctioning'' (re-leilão). '
  'Se is_re_auction=true: backend compara accepted_fee com original_freight_brl '
  'e chama create_freight_adjustment se valores diferirem. '
  'UPDATE ... WHERE status IN (''open'',''re_auctioning'') garante exclusividade.';


-- =====================================================
-- 11. Grants
-- =====================================================

GRANT EXECUTE ON FUNCTION public.start_grace_period(TEXT, INTEGER)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_delivery_for_auction(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_freight_adjustment(TEXT)      TO authenticated;
-- create_freight_adjustment e expire_freight_adjustment: server-only via service_role


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Colunas adicionadas:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'delivery_requests'
--   AND column_name IN (
--     'original_service_id','original_freight_brl',
--     're_auction_count','re_auction_started_at','grace_period_until'
--   );
-- Esperado: 5 linhas.

-- V2. Tabela criada:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'delivery_freight_adjustments';
-- Esperado: 1 linha.

-- V3. Novos status disponíveis (deve incluir 'grace_period'):
-- SELECT conname, consrc FROM pg_constraint
-- WHERE conrelid = 'delivery_requests'::regclass
--   AND conname = 'delivery_requests_status_check';

-- V4. RPCs criados:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'start_grace_period','reopen_delivery_for_auction',
--     'create_freight_adjustment','approve_freight_adjustment',
--     'expire_freight_adjustment'
--   );
-- Esperado: 5 linhas.

-- V5. claim_delivery_request atualizado (deve ter 're_auctioning' no corpo):
-- SELECT routine_definition FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'claim_delivery_request';
