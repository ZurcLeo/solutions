-- =====================================================
-- MIGRAÇÃO: KYC Social Comunitário (ElosCloud)
-- Descrição: Tabelas do sistema de verificação de identidade
--            baseado em comunidade — sem custo, sem burocracia.
--            Desbloqueia Loja Social para usuários verificados.
--
--            Épico: SOCIAL-KYC | Task: SOCIAL-KYC-001
--            Bloqueador das tasks SOCIAL-KYC-002 a 006.
--
-- Componentes:
--   1. Colunas em `users` (kyc_social_verified, social_score)
--   2. Tabela kyc_social_requests  — solicitações de verificação
--   3. Tabela kyc_social_validations — validações do Círculo de Confiança
--   4. Tabela kyc_godfather_bonds  — vínculo Padrinho ↔ Afilhado
--   5. Índices
--   6. RLS (Row Level Security)
--   7. Trigger anti-deleção em kyc_godfather_bonds (LGPD)
--   8. NOTA sobre bucket 'kyc-docs' no Supabase Storage
--
-- Segurança:
--   - Backend usa service_role → bypassa RLS por design.
--   - RLS se aplica apenas a conexões anon/authenticated (Supabase client).
--   - kyc_godfather_bonds: imutável por LGPD (auditoria de responsabilidade).
--     Delete bloqueado via trigger (defesa-em-profundidade contra service_role).
--
-- Autor: compliance-agent (delegado por ClaudIA)
-- Data: 2026-05-25
-- Refs: SOCIAL-KYC-001, LAUDO_ESTRATEGICO_MERCADO_LOCAL.md §2.2
-- =====================================================


-- =====================================================
-- 1. COLUNAS ADICIONAIS EM users
-- =====================================================

-- Flag de verificação social (Círculo de Confiança atingiu 3 validadores Nível 5+)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS kyc_social_verified BOOLEAN NOT NULL DEFAULT false;

-- Score de reputação social — calculado periodicamente (pg_cron ou on-demand).
-- Usa pesos decrescentes para avaliações do mesmo cluster (anti-panelinha).
-- Nunca decrementado diretamente; ajustado via penalidade do Lastro do Padrinho.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS social_score NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.kyc_social_verified IS
  'TRUE quando o usuário foi aprovado pelo Círculo de Confiança '
  '(≥3 validadores Nível 5+ em kyc_social_validations). '
  'Concede acesso à Loja Social (barter).';

COMMENT ON COLUMN users.social_score IS
  'Score de reputação comunitária. Calculado com pesos decrescentes '
  'para avaliações do mesmo cluster (anti-panelinha, SOCIAL-KYC-006). '
  'Reduzido em -10% via Lastro do Padrinho quando afilhado é banido '
  'e bond_status permanece "active" (SOCIAL-KYC-003).';


-- =====================================================
-- 2. TABELA kyc_social_requests
-- Solicitações de verificação social abertas pelos usuários.
-- Um usuário tem no máximo uma solicitação ativa (UNIQUE em user_id).
-- =====================================================

CREATE TABLE IF NOT EXISTS kyc_social_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNIQUE: um usuário não pode ter duas solicitações simultâneas.
  -- Se precisar re-solicitar (após expiração), a linha existente
  -- é atualizada pelo backend (UPDATE status + document_*).
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- pending: aguardando validadores
  -- approved: ≥3 validações recebidas → kyc_social_verified = true
  -- rejected: admin rejeitou manualmente
  -- expired: 90 dias sem aprovação → usuário deve re-solicitar
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),

  -- URL do documento no bucket 'kyc-docs' (Supabase Storage).
  -- NUNCA exposta diretamente ao validador — backend gera signed URL (TTL 5min).
  -- NULL se usuário optou por verificação apenas presencial/por indicação.
  document_photo_url    TEXT,

  -- Timestamp do upload do documento. Nulo se não foi feito upload.
  document_uploaded_at  TIMESTAMPTZ,

  -- Expiração automática do documento: 90 dias após upload (LGPD).
  -- Populada via trigger (set_kyc_social_document_expires_at) quando
  -- document_uploaded_at é definido. Não editar manualmente.
  -- SOCIAL-KYC-004 cria job agendado que deleta a foto e seta NULL
  -- em document_photo_url quando document_expires_at < now().
  document_expires_at   TIMESTAMPTZ,

  -- Preenchido quando status = 'approved'
  approved_at           TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT kyc_social_requests_user_unique UNIQUE (user_id)
);

COMMENT ON TABLE kyc_social_requests IS
  '[SOCIAL-KYC] Solicitações de verificação social. '
  'Um usuário = no máximo uma solicitação (UNIQUE user_id). '
  'Documentos expiram em 90 dias (LGPD). '
  'Backend delega aprovação ao Círculo de Confiança (3x Nível 5+).';

COMMENT ON COLUMN kyc_social_requests.document_photo_url IS
  'URL no bucket Supabase Storage "kyc-docs". '
  'NUNCA retornada diretamente ao validador — '
  'backend gera signed URL com TTL de 5 minutos (Interface Cega, SOCIAL-KYC-005). '
  'CPF e número do RG são mascarados antes de exibir ao validador.';

COMMENT ON COLUMN kyc_social_requests.document_expires_at IS
  'GENERATED ALWAYS AS (document_uploaded_at + 90d). '
  'SOCIAL-KYC-004: job diário deleta a foto do Storage e seta '
  'document_photo_url = NULL após esta data. '
  'Se status ainda for "pending": muda para "expired".';


-- =====================================================
-- 3. TABELA kyc_social_validations
-- Cada linha representa uma confirmação de identidade feita por
-- um usuário Nível 5+ sobre uma solicitação pendente.
-- A aprovação automática ocorre no backend quando count = 3.
-- =====================================================

CREATE TABLE IF NOT EXISTS kyc_social_validations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  request_id    UUID NOT NULL REFERENCES kyc_social_requests(id) ON DELETE CASCADE,

  -- Validador deve ser Nível 5+ (verificado no backend e na policy de INSERT).
  -- Validador não pode ser o próprio padrinho do solicitante
  -- (regra de negócio — verificada no backend, não no RLS).
  validator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  validated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Impede que o mesmo validador confirme duas vezes a mesma solicitação.
  CONSTRAINT kyc_social_validations_unique UNIQUE (request_id, validator_id)
);

COMMENT ON TABLE kyc_social_validations IS
  '[SOCIAL-KYC] Validações do Círculo de Confiança. '
  'Cada linha = um validador Nível 5+ confirmando a identidade do solicitante. '
  'Ao atingir 3 validações distintas: backend seta kyc_social_requests.status = "approved" '
  'e users.kyc_social_verified = true. '
  'REGRA ANTI-CONLUIO: validador não pode ser o padrinho do solicitante '
  '(verificado no backend via kyc_godfather_bonds).';

COMMENT ON COLUMN kyc_social_validations.validator_id IS
  'Usuário que confirmou a identidade. Deve ter current_level >= 5 '
  'em user_gamification (checado no backend e na RLS de INSERT).';


-- =====================================================
-- 4. TABELA kyc_godfather_bonds
-- Vínculo de responsabilidade entre quem convidou (padrinho)
-- e quem foi convidado (afilhado/protegido).
--
-- IMUTABILIDADE LGPD:
--   Esta tabela é de auditoria de responsabilidade e NUNCA pode
--   ter linhas deletadas. Apenas bond_status pode mudar.
--   Garantido por:
--     (a) Ausência de DELETE policy no RLS (nega a clientes)
--     (b) Trigger block_kyc_godfather_bonds_delete (nega a service_role)
-- =====================================================

CREATE TABLE IF NOT EXISTS kyc_godfather_bonds (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Quem convidou (padrinho/madrinha)
  godfather_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Quem foi convidado — UNIQUE: cada afilhado tem um único padrinho registrado
  protege_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- active: vínculo ativo (padrinho assume responsabilidade)
  -- broken: padrinho denunciou o afilhado antes do banimento
  --         → isento da penalidade de reputação
  bond_status                 TEXT NOT NULL DEFAULT 'active'
                                CHECK (bond_status IN ('active', 'broken')),

  -- Penalidade de reputação aplicada (em pontos absolutos de social_score).
  -- 0 enquanto afilhado não é banido ou bond_status = 'broken'.
  -- Preenchido pelo backend quando banimento é confirmado e bond_status = 'active'.
  reputation_penalty_applied  NUMERIC NOT NULL DEFAULT 0,

  -- Preenchido quando padrinho rompe o vínculo antes do banimento.
  broken_at                   TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT kyc_godfather_bonds_protege_unique UNIQUE (protege_id)
);

COMMENT ON TABLE kyc_godfather_bonds IS
  '[SOCIAL-KYC / LGPD art. 37] Vínculo Padrinho ↔ Afilhado. '
  'Auditoria imutável de responsabilidade comunitária. '
  'NUNCA deletar linhas — apenas bond_status pode mudar. '
  'Penalidade: -10%% do social_score do padrinho se afilhado é banido '
  'e bond_status = "active". '
  'Padrinho pode romper o vínculo (broken) antes do banimento, '
  'isentando-se da penalidade futura.';

COMMENT ON COLUMN kyc_godfather_bonds.reputation_penalty_applied IS
  'Pontos de social_score descontados do padrinho quando afilhado foi banido. '
  'Zero se bond_status = "broken" (padrinho denunciou antes do banimento).';

COMMENT ON COLUMN kyc_godfather_bonds.broken_at IS
  'Timestamp em que o padrinho rompeu o vínculo via '
  'POST /api/kyc-social/bonds/:protegeId/break. '
  'Notificação enviada ao afilhado via email-agent.';


-- =====================================================
-- 5. ÍNDICES
-- =====================================================

-- kyc_social_requests: busca por status (fila de revisão admin)
CREATE INDEX IF NOT EXISTS idx_kyc_social_requests_status
  ON kyc_social_requests(status)
  WHERE status IN ('pending', 'expired');

-- kyc_social_requests: expiração de documentos (job SOCIAL-KYC-004)
CREATE INDEX IF NOT EXISTS idx_kyc_social_requests_expires
  ON kyc_social_requests(document_expires_at)
  WHERE document_photo_url IS NOT NULL;

-- kyc_social_validations: contagem de validações por solicitação
-- (backend verifica se count >= 3 para aprovar automaticamente)
CREATE INDEX IF NOT EXISTS idx_kyc_social_validations_request
  ON kyc_social_validations(request_id);

-- kyc_social_validations: histórico de validações feitas por um usuário
CREATE INDEX IF NOT EXISTS idx_kyc_social_validations_validator
  ON kyc_social_validations(validator_id);

-- kyc_godfather_bonds: busca por padrinho (dashboard de vínculos)
CREATE INDEX IF NOT EXISTS idx_kyc_godfather_bonds_godfather
  ON kyc_godfather_bonds(godfather_id);

-- kyc_godfather_bonds: verificar se padrinho de um afilhado é o validador
-- (regra anti-conluio — join usado pelo backend)
CREATE INDEX IF NOT EXISTS idx_kyc_godfather_bonds_protege
  ON kyc_godfather_bonds(protege_id);


-- =====================================================
-- 6. TRIGGERS em kyc_social_requests
-- =====================================================

-- 6a. Auto-preenchimento de document_expires_at = uploaded_at + 90 dias
-- (TIMESTAMPTZ + INTERVAL não é imutável no PostgreSQL, então não pode
--  ser GENERATED ALWAYS AS — usamos trigger para o mesmo efeito)

CREATE OR REPLACE FUNCTION set_kyc_social_document_expires_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.document_uploaded_at IS NOT NULL THEN
    NEW.document_expires_at := NEW.document_uploaded_at + INTERVAL '90 days';
  ELSE
    NEW.document_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kyc_social_document_expires ON kyc_social_requests;
CREATE TRIGGER trg_kyc_social_document_expires
  BEFORE INSERT OR UPDATE OF document_uploaded_at ON kyc_social_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_kyc_social_document_expires_at();

CREATE OR REPLACE FUNCTION update_kyc_social_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kyc_social_requests_updated_at ON kyc_social_requests;
CREATE TRIGGER trg_kyc_social_requests_updated_at
  BEFORE UPDATE ON kyc_social_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_kyc_social_requests_updated_at();


-- =====================================================
-- 7. TRIGGER: Bloqueio de DELETE em kyc_godfather_bonds (LGPD)
--
-- Por que trigger além do RLS?
--   O backend usa service_role → bypassa RLS por design do Supabase.
--   O trigger garante imutabilidade MESMO contra operações do backend,
--   mitigando bugs ou chamadas acidentais de DELETE.
--   Conformidade: LGPD art. 37 (registro de operações de tratamento).
-- =====================================================

CREATE OR REPLACE FUNCTION block_kyc_godfather_bonds_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'kyc_godfather_bonds é imutável por obrigação LGPD (art. 37). '
    'Registro de auditoria de responsabilidade não pode ser deletado. '
    'Para desfazer o vínculo, atualize bond_status para "broken".';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_kyc_godfather_bonds_delete ON kyc_godfather_bonds;
CREATE TRIGGER trg_block_kyc_godfather_bonds_delete
  BEFORE DELETE ON kyc_godfather_bonds
  FOR EACH ROW
  EXECUTE FUNCTION block_kyc_godfather_bonds_delete();


-- =====================================================
-- 8. ROW LEVEL SECURITY
-- =====================================================

-- ---------------------------------------------------------
-- 8.1  kyc_social_requests
--
-- SELECT: próprio usuário OU admin OU support
-- INSERT: próprio usuário (status inicial = 'pending')
-- UPDATE: apenas admin e support (aprovação, rejeição, expiração)
-- DELETE: negado a todos via RLS (backend usa ON DELETE CASCADE via users)
-- ---------------------------------------------------------

ALTER TABLE kyc_social_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: usuário vê apenas a própria solicitação
DROP POLICY IF EXISTS "kyc_social_requests_select_own" ON kyc_social_requests;
CREATE POLICY "kyc_social_requests_select_own"
  ON kyc_social_requests
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
    OR check_global_role(auth.uid()::text, 'support')
  );

-- INSERT: usuário cria a própria solicitação
-- Backend valida level-gating (Nível 3+) antes de permitir
DROP POLICY IF EXISTS "kyc_social_requests_insert_own" ON kyc_social_requests;
CREATE POLICY "kyc_social_requests_insert_own"
  ON kyc_social_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

-- UPDATE: apenas admin e support alteram status/aprovação
DROP POLICY IF EXISTS "kyc_social_requests_update_staff" ON kyc_social_requests;
CREATE POLICY "kyc_social_requests_update_staff"
  ON kyc_social_requests
  FOR UPDATE
  TO authenticated
  USING (
    check_global_role(auth.uid()::text, 'admin')
    OR check_global_role(auth.uid()::text, 'support')
  )
  WITH CHECK (
    check_global_role(auth.uid()::text, 'admin')
    OR check_global_role(auth.uid()::text, 'support')
  );

-- anon: sem acesso
REVOKE ALL ON kyc_social_requests FROM anon;


-- ---------------------------------------------------------
-- 8.2  kyc_social_validations
--
-- SELECT: o próprio validador vê as validações que fez OU admin
-- INSERT: usuário autenticado com Nível 5+ (user_gamification.current_level >= 5)
--         A regra "validador ≠ padrinho" é verificada no backend
-- UPDATE/DELETE: negado via RLS (imutabilidade do voto)
-- ---------------------------------------------------------

ALTER TABLE kyc_social_validations ENABLE ROW LEVEL SECURITY;

-- SELECT: validador vê as próprias validações; admin vê tudo
DROP POLICY IF EXISTS "kyc_social_validations_select" ON kyc_social_validations;
CREATE POLICY "kyc_social_validations_select"
  ON kyc_social_validations
  FOR SELECT
  TO authenticated
  USING (
    validator_id = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

-- INSERT: apenas usuários com Nível 5+ podem validar identidades
-- A subquery verifica current_level >= 5 em user_gamification.
-- O backend também valida antes de aceitar o request.
DROP POLICY IF EXISTS "kyc_social_validations_insert_level5" ON kyc_social_validations;
CREATE POLICY "kyc_social_validations_insert_level5"
  ON kyc_social_validations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    validator_id = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM user_gamification ug
      WHERE ug.user_id = auth.uid()::text
        AND ug.current_level >= 5
    )
  );

-- anon: sem acesso
REVOKE ALL ON kyc_social_validations FROM anon;


-- ---------------------------------------------------------
-- 8.3  kyc_godfather_bonds
--
-- SELECT: padrinho vê os próprios vínculos OU admin
-- INSERT: negado via RLS — apenas service_role (backend) insere
--         (criado automaticamente ao validar convite com KYC Social)
-- UPDATE: padrinho pode romper o próprio vínculo (bond_status = 'broken')
--         admin pode aplicar penalidade (reputation_penalty_applied)
-- DELETE: negado via RLS + trigger LGPD (imutabilidade total)
-- ---------------------------------------------------------

ALTER TABLE kyc_godfather_bonds ENABLE ROW LEVEL SECURITY;

-- SELECT: padrinho vê os próprios vínculos; admin vê tudo
DROP POLICY IF EXISTS "kyc_godfather_bonds_select" ON kyc_godfather_bonds;
CREATE POLICY "kyc_godfather_bonds_select"
  ON kyc_godfather_bonds
  FOR SELECT
  TO authenticated
  USING (
    godfather_id = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

-- UPDATE: padrinho pode romper o vínculo; admin pode aplicar penalidade
-- O trigger LGPD impede DELETE — UPDATE é a única operação permitida.
DROP POLICY IF EXISTS "kyc_godfather_bonds_update" ON kyc_godfather_bonds;
CREATE POLICY "kyc_godfather_bonds_update"
  ON kyc_godfather_bonds
  FOR UPDATE
  TO authenticated
  USING (
    godfather_id = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  )
  WITH CHECK (
    -- Padrinho só pode mudar bond_status para 'broken' (não pode desfazer)
    -- Admin pode atualizar qualquer campo (penalidade)
    check_global_role(auth.uid()::text, 'admin')
    OR (
      godfather_id = auth.uid()::text
      AND bond_status = 'broken'  -- WITH CHECK: novo valor deve ser 'broken'
    )
  );

-- Sem policy de INSERT via RLS: apenas service_role (backend) pode inserir.
-- Sem policy de DELETE via RLS: negado por padrão (RLS ativo sem policy = deny).
-- Defense in depth: trigger bloqueia DELETE mesmo de service_role.

-- anon: sem acesso
REVOKE ALL ON kyc_godfather_bonds FROM anon;


-- =====================================================
-- NOTA: Bucket 'kyc-docs' no Supabase Storage
--
-- Este bucket deve ser criado MANUALMENTE no painel do Supabase
-- (Storage → New Bucket) ou via API com as seguintes configurações:
--
--   Nome: kyc-docs
--   Public: false  (NUNCA público — documentos de identidade)
--   File size limit: 5 MB (RG/CNH comprimido)
--   Allowed MIME types: image/jpeg, image/png, image/webp
--
-- Políticas de acesso (Storage RLS — configurar no painel):
--   - Upload: apenas o próprio usuário (via backend com signed upload URL)
--   - Download: apenas o próprio usuário e admin (via signed URL, TTL 5min)
--   - Deleção automática: job SOCIAL-KYC-004 usa service_role
--
-- IMPORTANTE: O frontend NUNCA acessa o bucket diretamente.
--   O backend gera uma signed URL com TTL curto para cada acesso.
--   Para validadores (Interface Cega): o backend mascara CPF/RG
--   antes de gerar a URL ou processa a imagem para sobrepor retângulo
--   sobre os dados sensíveis (SOCIAL-KYC-005).
-- =====================================================


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar que as 3 tabelas existem:
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('kyc_social_requests','kyc_social_validations','kyc_godfather_bonds');
-- Esperado: 3 linhas.

-- V2. Confirmar RLS ativado nas 3 tabelas:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('kyc_social_requests','kyc_social_validations','kyc_godfather_bonds');
-- Esperado: rowsecurity = true para todas.

-- V3. Confirmar que DELETE em kyc_godfather_bonds é bloqueado (trigger LGPD):
-- INSERT INTO kyc_godfather_bonds (godfather_id, protege_id)
--   VALUES ('test-godfather', 'test-protege');
-- DELETE FROM kyc_godfather_bonds WHERE protege_id = 'test-protege';
-- Esperado: ERROR 'kyc_godfather_bonds é imutável por obrigação LGPD'.

-- V4. Confirmar colunas em users:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'users'
--   AND column_name IN ('kyc_social_verified', 'social_score');
-- Esperado: 2 linhas (boolean DEFAULT false, numeric DEFAULT 0).

-- V5. Confirmar que o trigger de expiração é GENERATED:
-- SELECT column_name, generation_expression
-- FROM information_schema.columns
-- WHERE table_name = 'kyc_social_requests'
--   AND column_name = 'document_expires_at';
-- Esperado: generation_expression = 'document_uploaded_at + interval ''90 days'''.
