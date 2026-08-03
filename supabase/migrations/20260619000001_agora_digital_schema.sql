-- =============================================================================
-- ÁGORA DIGITAL: Participação Cívica Hiperlocal
--
-- Decisões travadas (PO):
--   D1: Threshold 10 padrão, configurável por região (3-500), audit log
--   D2: Moderação híbrida: Guardiões L5 + admin override + SLA 24h
--   D3: API Fala.BR NÃO integrada. Dataset local CGU + IA (Claude)
--   D4: Apenas recomendar + educar. Upload de resolução opcional
--   D5: Pilar Cidadania (novo, separado de Jurídico)
--   D6: Regiões CRUD admin + audit log via trigger
--   D7: Relatos identificados. CPF mascarado no manifesto. Peso legal
--   D8: Conteúdo sobre poderes paralelos nunca armazenado
--
-- Identidade:
--   Relatos/Assinaturas = IDENTIFICADOS (user_id plaintext)
--   Votos/Respostas enquete = ANÔNIMOS (HMAC trigger)
-- =============================================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. agora_regioes — hierarquia de regiões cívicas
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_regioes (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nome            TEXT NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('comunidade', 'bairro', 'zona', 'municipio')),
  pai_id          TEXT REFERENCES agora_regioes(id),
  municipio_ibge  TEXT,                         -- código IBGE do município
  estado_uf       TEXT,                         -- UF (2 chars)
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  raio_km         DOUBLE PRECISION DEFAULT 5.0, -- raio de abrangência

  -- Thresholds configuráveis por tipo
  threshold_relato     INTEGER NOT NULL DEFAULT 10 CHECK (threshold_relato BETWEEN 3 AND 500),
  threshold_enquete    INTEGER NOT NULL DEFAULT 10 CHECK (threshold_enquete BETWEEN 3 AND 200),

  canal_oficial   JSONB DEFAULT '{}',           -- {"ouvidoria_url": "", "telefone": "", ...}
  alto_risco      BOOLEAN NOT NULL DEFAULT false,
  ativo           BOOLEAN NOT NULL DEFAULT true,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agora_regioes_pai ON agora_regioes(pai_id);
CREATE INDEX IF NOT EXISTS idx_agora_regioes_municipio ON agora_regioes(municipio_ibge);
CREATE INDEX IF NOT EXISTS idx_agora_regioes_geo ON agora_regioes(latitude, longitude) WHERE latitude IS NOT NULL;

-- Trigger updated_at
CREATE TRIGGER set_agora_regioes_updated_at
  BEFORE UPDATE ON agora_regioes
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- =============================================================================
-- 2. agora_regioes_log — audit trail automático de alterações em regiões
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_regioes_log (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  regiao_id       TEXT NOT NULL REFERENCES agora_regioes(id),
  campo           TEXT NOT NULL,
  valor_anterior  TEXT,
  valor_novo      TEXT,
  alterado_por    TEXT NOT NULL,                 -- admin user_id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agora_regioes_log_regiao ON agora_regioes_log(regiao_id, created_at DESC);

-- Trigger: registra alterações em campos auditáveis
CREATE OR REPLACE FUNCTION agora_regioes_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user TEXT;
BEGIN
  v_user := coalesce(current_setting('app.current_user_id', true), 'system');

  IF OLD.threshold_relato IS DISTINCT FROM NEW.threshold_relato THEN
    INSERT INTO agora_regioes_log(regiao_id, campo, valor_anterior, valor_novo, alterado_por)
    VALUES (NEW.id, 'threshold_relato', OLD.threshold_relato::text, NEW.threshold_relato::text, v_user);
  END IF;

  IF OLD.threshold_enquete IS DISTINCT FROM NEW.threshold_enquete THEN
    INSERT INTO agora_regioes_log(regiao_id, campo, valor_anterior, valor_novo, alterado_por)
    VALUES (NEW.id, 'threshold_enquete', OLD.threshold_enquete::text, NEW.threshold_enquete::text, v_user);
  END IF;

  IF OLD.canal_oficial::text IS DISTINCT FROM NEW.canal_oficial::text THEN
    INSERT INTO agora_regioes_log(regiao_id, campo, valor_anterior, valor_novo, alterado_por)
    VALUES (NEW.id, 'canal_oficial', OLD.canal_oficial::text, NEW.canal_oficial::text, v_user);
  END IF;

  IF OLD.alto_risco IS DISTINCT FROM NEW.alto_risco THEN
    INSERT INTO agora_regioes_log(regiao_id, campo, valor_anterior, valor_novo, alterado_por)
    VALUES (NEW.id, 'alto_risco', OLD.alto_risco::text, NEW.alto_risco::text, v_user);
  END IF;

  IF OLD.ativo IS DISTINCT FROM NEW.ativo THEN
    INSERT INTO agora_regioes_log(regiao_id, campo, valor_anterior, valor_novo, alterado_por)
    VALUES (NEW.id, 'ativo', OLD.ativo::text, NEW.ativo::text, v_user);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agora_regioes_audit
  AFTER UPDATE ON agora_regioes
  FOR EACH ROW EXECUTE FUNCTION agora_regioes_audit();

-- =============================================================================
-- 3. agora_relatos — relatos de infraestrutura (IDENTIFICADOS)
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_relatos (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  regiao_id             TEXT NOT NULL REFERENCES agora_regioes(id),
  criado_por            TEXT NOT NULL REFERENCES users(id),  -- IDENTIFICADO
  criado_por_nome_pub   BOOLEAN NOT NULL DEFAULT true,       -- mostra nome no relato

  -- Conteúdo
  titulo                TEXT NOT NULL,
  descricao             TEXT NOT NULL,
  categoria             TEXT NOT NULL CHECK (categoria IN (
    'infraestrutura', 'saude', 'educacao', 'seguranca_publica',
    'meio_ambiente', 'transporte', 'iluminacao', 'saneamento',
    'acessibilidade', 'cultura_lazer', 'habitacao', 'outros'
  )),
  imagens               TEXT[] DEFAULT '{}',
  localizacao_lat       DOUBLE PRECISION,
  localizacao_lng       DOUBLE PRECISION,
  endereco_texto        TEXT,

  -- Roteamento cívico (preenchido pela IA)
  orgao_recomendado     TEXT,
  esfera_recomendada    TEXT CHECK (esfera_recomendada IN ('municipal', 'estadual', 'federal') OR esfera_recomendada IS NULL),
  passo_a_passo         JSONB DEFAULT '[]',        -- [{passo: 1, titulo: "", descricao: "", url: ""}]
  canais_recomendados   JSONB DEFAULT '[]',        -- [{nome: "", url: "", tipo: "site|telefone|app"}]

  -- Status e moderação
  status                TEXT NOT NULL DEFAULT 'pendente_moderacao'
    CHECK (status IN (
      'pendente_moderacao', 'publicado', 'encaminhado',
      'resolvido', 'arquivado', 'rejeitado'
    )),

  -- Assinaturas (counter cache)
  assinaturas_count     INTEGER NOT NULL DEFAULT 0,

  -- Encaminhamento
  protocolo_numero      TEXT,
  protocolo_orgao       TEXT,
  encaminhado_em        TIMESTAMPTZ,

  -- Resolução
  resolucao_descricao   TEXT,
  resolucao_evidencia_url TEXT,
  resolvido_em          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agora_relatos_regiao_status ON agora_relatos(regiao_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agora_relatos_criador ON agora_relatos(criado_por);
CREATE INDEX IF NOT EXISTS idx_agora_relatos_categoria ON agora_relatos(categoria);
CREATE INDEX IF NOT EXISTS idx_agora_relatos_geo ON agora_relatos(localizacao_lat, localizacao_lng)
  WHERE localizacao_lat IS NOT NULL;

CREATE TRIGGER set_agora_relatos_updated_at
  BEFORE UPDATE ON agora_relatos
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- =============================================================================
-- 4. agora_assinaturas — assinaturas de relatos (IDENTIFICADAS)
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_assinaturas (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  relato_id       TEXT NOT NULL REFERENCES agora_relatos(id),
  user_id         TEXT NOT NULL REFERENCES users(id),  -- IDENTIFICADO (peso legal)
  regiao_id       TEXT REFERENCES agora_regioes(id),
  nome_completo   TEXT NOT NULL,                        -- nome no manifesto
  cpf_mascarado   TEXT NOT NULL,                        -- XXX.XXX.789-XX
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_agora_assinatura_user_relato UNIQUE (relato_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agora_assinaturas_relato ON agora_assinaturas(relato_id);
CREATE INDEX IF NOT EXISTS idx_agora_assinaturas_user ON agora_assinaturas(user_id);

-- Trigger: incrementa assinaturas_count no relato após INSERT
CREATE OR REPLACE FUNCTION agora_increment_assinaturas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE agora_relatos
  SET assinaturas_count = assinaturas_count + 1
  WHERE id = NEW.relato_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agora_increment_assinaturas
  AFTER INSERT ON agora_assinaturas
  FOR EACH ROW EXECUTE FUNCTION agora_increment_assinaturas();

-- =============================================================================
-- 5. agora_moderacao_fila — fila de moderação de relatos
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_moderacao_fila (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  relato_id       TEXT NOT NULL REFERENCES agora_relatos(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('guardiao', 'admin')),
  assignado_a     TEXT REFERENCES users(id),
  decisao         TEXT CHECK (decisao IN ('aprovado', 'rejeitado', 'escalado') OR decisao IS NULL),
  motivo          TEXT,
  escalar_em      TIMESTAMPTZ,                         -- SLA: escala se não decidido
  escalado        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_em     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agora_moderacao_relato ON agora_moderacao_fila(relato_id);
CREATE INDEX IF NOT EXISTS idx_agora_moderacao_assignado ON agora_moderacao_fila(assignado_a, decisao)
  WHERE decisao IS NULL;
CREATE INDEX IF NOT EXISTS idx_agora_moderacao_sla ON agora_moderacao_fila(escalar_em)
  WHERE decisao IS NULL AND escalado = false;

-- =============================================================================
-- 6. agora_informativos — curadoria legislativa
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_informativos (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  criado_por      TEXT NOT NULL REFERENCES users(id),
  regiao_id       TEXT REFERENCES agora_regioes(id),

  titulo          TEXT NOT NULL,
  resumo          TEXT NOT NULL,
  conteudo        TEXT NOT NULL,
  fonte_url       TEXT NOT NULL,
  casa            TEXT CHECK (casa IN ('camara', 'senado', 'assembleia', 'camara_municipal', 'executivo', 'judiciario')),
  tags            TEXT[] DEFAULT '{}',

  status          TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'publicado', 'arquivado')),

  publicado_em    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agora_informativos_status ON agora_informativos(status, publicado_em DESC);
CREATE INDEX IF NOT EXISTS idx_agora_informativos_tags ON agora_informativos USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_agora_informativos_regiao ON agora_informativos(regiao_id);

CREATE TRIGGER set_agora_informativos_updated_at
  BEFORE UPDATE ON agora_informativos
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- =============================================================================
-- 7. agora_votos_enquete — votos em informativos (ANÔNIMOS via HMAC)
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_votos_enquete (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  informativo_id  TEXT NOT NULL REFERENCES agora_informativos(id),
  user_id         TEXT NOT NULL,                        -- será hasheado pelo trigger
  voto            TEXT NOT NULL CHECK (voto IN ('relevante', 'irrelevante', 'neutro')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_agora_voto_user_informativo UNIQUE (informativo_id, user_id)
);

-- =============================================================================
-- 8. agora_enquetes — enquetes comunitárias
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_enquetes (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  criado_por      TEXT NOT NULL REFERENCES users(id),
  regiao_id       TEXT REFERENCES agora_regioes(id),

  pergunta        TEXT NOT NULL,
  descricao       TEXT,
  opcoes          JSONB NOT NULL DEFAULT '[]',         -- [{id: "a", texto: "Sim"}, {id: "b", texto: "Não"}]
  resultado       JSONB DEFAULT '{}',                   -- {a: 42, b: 18} — atualizado pelo backend
  total_votos     INTEGER NOT NULL DEFAULT 0,

  status          TEXT NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'encerrada', 'cancelada')),
  encerra_em      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agora_enquetes_status ON agora_enquetes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agora_enquetes_regiao ON agora_enquetes(regiao_id);

CREATE TRIGGER set_agora_enquetes_updated_at
  BEFORE UPDATE ON agora_enquetes
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- =============================================================================
-- 9. agora_respostas_enquete — respostas a enquetes (ANÔNIMAS via HMAC)
-- =============================================================================
CREATE TABLE IF NOT EXISTS agora_respostas_enquete (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  enquete_id      TEXT NOT NULL REFERENCES agora_enquetes(id),
  user_id         TEXT NOT NULL,                        -- será hasheado pelo trigger
  opcao_id        TEXT NOT NULL,                        -- id da opção escolhida
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_agora_resposta_user_enquete UNIQUE (enquete_id, user_id)
);

-- =============================================================================
-- 10. civic_knowledge_base — dataset CGU local (Fala.BR dados abertos)
-- =============================================================================
-- Fonte: dadosabertos-download.cgu.gov.br/FalaBR/Manifestacoes_Ouvidoria/
-- Encoding CSV: latin-1. ETL: scripts/etl_ouvidoria_cgu.py
-- Cobertura: predominantemente federal (Ministérios, INSS, Receita, Exército).
-- Para infraestrutura municipal, o civicKnowledgeService faz fallback para
-- ouvidoria da prefeitura + instrução Fala.BR.
-- =============================================================================
CREATE TABLE IF NOT EXISTS civic_knowledge_base (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- Localização — o CGU não tem código IBGE em todos os registros
  municipio_ibge    TEXT,                                   -- IBGE quando disponível
  municipio_nome    TEXT NOT NULL,                          -- nome normalizado UPPER
  uf                TEXT NOT NULL CHECK (length(uf) = 2),   -- sigla UF
  -- Órgão
  esfera            TEXT NOT NULL CHECK (esfera IN ('municipal', 'estadual', 'federal')),
  orgao_nome        TEXT NOT NULL,
  orgao_siorg_id    TEXT,                                   -- ID SIORG do órgão (CGU)
  -- Categorização
  tipo_manifesto    TEXT[] DEFAULT '{}',                    -- tipos aceitos: Reclamação, Denúncia, etc.
  assuntos          TEXT[] DEFAULT '{}',                    -- assuntos cobertos pelo órgão
  -- Métricas agregadas
  taxa_resolucao    NUMERIC DEFAULT 0,                     -- 0..100 (percentual)
  tempo_medio_resposta_dias INTEGER DEFAULT 0,
  total_registros   INTEGER DEFAULT 0,                     -- volume do órgão neste município
  -- Canais (preenchido manualmente ou via curadoria)
  canal_principal   TEXT,
  url_canal         TEXT,
  -- Timestamps
  ultima_atualizacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Dedup constraint para upsert do ETL (via functional index abaixo)
);

-- Functional UNIQUE index: orgao_siorg_id pode ser NULL (usa orgao_nome como fallback)
CREATE UNIQUE INDEX IF NOT EXISTS civic_knowledge_base_unique_idx
  ON civic_knowledge_base (COALESCE(orgao_siorg_id, orgao_nome), municipio_nome, esfera);

CREATE INDEX IF NOT EXISTS idx_civic_kb_municipio ON civic_knowledge_base(municipio_nome);
CREATE INDEX IF NOT EXISTS idx_civic_kb_uf ON civic_knowledge_base(uf);
CREATE INDEX IF NOT EXISTS idx_civic_kb_orgao ON civic_knowledge_base(orgao_nome);
CREATE INDEX IF NOT EXISTS idx_civic_kb_assuntos ON civic_knowledge_base USING gin(assuntos);
CREATE INDEX IF NOT EXISTS idx_civic_kb_esfera ON civic_knowledge_base(esfera);

-- =============================================================================
-- 11. HMAC trigger — anonimiza user_id APENAS em votos e respostas de enquete
-- =============================================================================
CREATE OR REPLACE FUNCTION agora_hash_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_salt TEXT;
BEGIN
  v_salt := current_setting('app.agora_salt', true);
  IF v_salt IS NULL OR v_salt = '' THEN
    RAISE EXCEPTION 'app.agora_salt não configurado';
  END IF;

  NEW.user_id := encode(
    hmac(NEW.user_id::bytea, v_salt::bytea, 'sha256'),
    'hex'
  );

  RETURN NEW;
END;
$$;

-- Trigger em votos de informativos (ANÔNIMO)
CREATE TRIGGER trg_agora_hash_voto_user
  BEFORE INSERT ON agora_votos_enquete
  FOR EACH ROW EXECUTE FUNCTION agora_hash_user_id();

-- Trigger em respostas de enquetes (ANÔNIMO)
CREATE TRIGGER trg_agora_hash_resposta_user
  BEFORE INSERT ON agora_respostas_enquete
  FOR EACH ROW EXECUTE FUNCTION agora_hash_user_id();

-- =============================================================================
-- 12. RLS — Row Level Security
-- =============================================================================

-- ── agora_regioes: autenticado lê, admin escreve ──
ALTER TABLE agora_regioes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_regioes_read" ON agora_regioes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "agora_regioes_admin_write" ON agora_regioes
  FOR ALL
  USING (check_global_role(auth.uid()::text, 'admin'))
  WITH CHECK (check_global_role(auth.uid()::text, 'admin'));

-- ── agora_regioes_log: admin lê ──
ALTER TABLE agora_regioes_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_regioes_log_admin_read" ON agora_regioes_log
  FOR SELECT USING (check_global_role(auth.uid()::text, 'admin'));

-- ── agora_relatos: publicados visíveis; INSERT autenticado; UPDATE owner+admin ──
ALTER TABLE agora_relatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_relatos_select_public" ON agora_relatos
  FOR SELECT USING (
    status IN ('publicado', 'encaminhado', 'resolvido')
    OR criado_por = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

CREATE POLICY "agora_relatos_insert" ON agora_relatos
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND criado_por = auth.uid()::text
  );

CREATE POLICY "agora_relatos_update_owner" ON agora_relatos
  FOR UPDATE USING (
    criado_por = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

-- ── agora_assinaturas: usuário vê as próprias (identificadas), INSERT own ──
ALTER TABLE agora_assinaturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_assinaturas_select_own" ON agora_assinaturas
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "agora_assinaturas_insert_own" ON agora_assinaturas
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND user_id = auth.uid()::text
  );

-- ── agora_moderacao_fila: guardião vê assignados (cego ao autor), admin tudo ──
ALTER TABLE agora_moderacao_fila ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_moderacao_select" ON agora_moderacao_fila
  FOR SELECT USING (
    assignado_a = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

CREATE POLICY "agora_moderacao_update" ON agora_moderacao_fila
  FOR UPDATE USING (
    assignado_a = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

-- ── agora_informativos: autenticado lê publicados, admin+trust≥4 cria ──
ALTER TABLE agora_informativos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_informativos_select" ON agora_informativos
  FOR SELECT USING (
    status = 'publicado'
    OR criado_por = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

CREATE POLICY "agora_informativos_insert" ON agora_informativos
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "agora_informativos_update" ON agora_informativos
  FOR UPDATE USING (
    criado_por = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

-- ── agora_votos_enquete: NINGUÉM lê diretamente (só RPCs agregadas) ──
ALTER TABLE agora_votos_enquete ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_votos_no_read" ON agora_votos_enquete
  FOR SELECT USING (false);

CREATE POLICY "agora_votos_insert" ON agora_votos_enquete
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ── agora_enquetes: autenticado lê ──
ALTER TABLE agora_enquetes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_enquetes_select" ON agora_enquetes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "agora_enquetes_insert" ON agora_enquetes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "agora_enquetes_update" ON agora_enquetes
  FOR UPDATE USING (
    criado_por = auth.uid()::text
    OR check_global_role(auth.uid()::text, 'admin')
  );

-- ── agora_respostas_enquete: NINGUÉM lê diretamente ──
ALTER TABLE agora_respostas_enquete ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agora_respostas_no_read" ON agora_respostas_enquete
  FOR SELECT USING (false);

CREATE POLICY "agora_respostas_insert" ON agora_respostas_enquete
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ── civic_knowledge_base: autenticado lê, service role escreve ──
ALTER TABLE civic_knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "civic_kb_read" ON civic_knowledge_base
  FOR SELECT USING (auth.role() = 'authenticated');

-- =============================================================================
-- 13. RPCs SECURITY DEFINER
-- =============================================================================

-- Verifica se usuário já votou em enquete (usa HMAC internamente)
CREATE OR REPLACE FUNCTION agora_user_voted_enquete(p_user_id TEXT, p_enquete_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
  v_exists BOOLEAN;
BEGIN
  v_salt := current_setting('app.agora_salt', true);
  IF v_salt IS NULL OR v_salt = '' THEN
    RETURN false;
  END IF;

  v_hash := encode(hmac(p_user_id::bytea, v_salt::bytea, 'sha256'), 'hex');

  SELECT EXISTS(
    SELECT 1 FROM agora_respostas_enquete
    WHERE enquete_id = p_enquete_id AND user_id = v_hash
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

-- Retorna resultados agregados de enquete (sem expor votos individuais)
CREATE OR REPLACE FUNCTION agora_get_enquete_resultados(p_enquete_id TEXT)
RETURNS TABLE (
  total_votos BIGINT,
  resultados  JSONB
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    count(*)::bigint AS total_votos,
    jsonb_object_agg(r.opcao_id, r.cnt) AS resultados
  FROM (
    SELECT opcao_id, count(*)::bigint AS cnt
    FROM agora_respostas_enquete
    WHERE enquete_id = p_enquete_id
    GROUP BY opcao_id
  ) r;
END;
$$;

-- Verifica se usuário pode criar informativo (admin OU trust_level ≥ 4)
CREATE OR REPLACE FUNCTION agora_pode_criar_informativo(p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_trust_level INTEGER;
BEGIN
  v_is_admin := check_global_role(p_user_id, 'admin');
  IF v_is_admin THEN RETURN true; END IF;

  SELECT trust_level INTO v_trust_level
  FROM trust_passports
  WHERE user_id = p_user_id;

  RETURN coalesce(v_trust_level, 1) >= 4;
END;
$$;

-- Assigna moderador a relato (distribui carga, evita conflito)
CREATE OR REPLACE FUNCTION agora_assignar_moderador(p_relato_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_guardiao_id TEXT;
  v_tipo TEXT;
  v_sla TIMESTAMPTZ;
BEGIN
  v_sla := now() + interval '24 hours';

  -- Tenta encontrar Guardião (trust_level = 5) com menos itens pendentes
  SELECT tp.user_id INTO v_guardiao_id
  FROM trust_passports tp
  WHERE tp.trust_level = 5
    -- Evita conflito: guardião não é o criador do relato
    AND tp.user_id != (SELECT criado_por FROM agora_relatos WHERE id = p_relato_id)
  ORDER BY (
    SELECT count(*) FROM agora_moderacao_fila mf
    WHERE mf.assignado_a = tp.user_id AND mf.decisao IS NULL
  ) ASC
  LIMIT 1;

  IF v_guardiao_id IS NOT NULL THEN
    v_tipo := 'guardiao';
  ELSE
    -- Fallback: admin
    v_tipo := 'admin';
    v_guardiao_id := NULL;  -- admin pick no backend
  END IF;

  INSERT INTO agora_moderacao_fila (relato_id, tipo, assignado_a, escalar_em)
  VALUES (p_relato_id, v_tipo, v_guardiao_id, v_sla);

  RETURN v_tipo;
END;
$$;

-- Verifica se usuário já votou em informativo (usa HMAC)
CREATE OR REPLACE FUNCTION agora_user_voted_informativo(p_user_id TEXT, p_informativo_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
  v_exists BOOLEAN;
BEGIN
  v_salt := current_setting('app.agora_salt', true);
  IF v_salt IS NULL OR v_salt = '' THEN
    RETURN false;
  END IF;

  v_hash := encode(hmac(p_user_id::bytea, v_salt::bytea, 'sha256'), 'hex');

  SELECT EXISTS(
    SELECT 1 FROM agora_votos_enquete
    WHERE informativo_id = p_informativo_id AND user_id = v_hash
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

-- =============================================================================
-- 14. ALTER trust_events CHECK: adicionar domínio 'civic'
-- =============================================================================
-- Drop e recria o CHECK para incluir 'civic'
ALTER TABLE trust_events DROP CONSTRAINT IF EXISTS trust_events_domain_check;
ALTER TABLE trust_events ADD CONSTRAINT trust_events_domain_check
  CHECK (domain IN (
    'account', 'social', 'financial', 'stays',
    'delivery', 'marketplace', 'moderation', 'civic'
  ));

-- =============================================================================
-- 15. Registro em platform_modules e platform_pillars
-- =============================================================================

-- Novo pilar: Cidadania
INSERT INTO platform_pillars (id, label, label_en, description, color_primary, color_surface, icon_name, route, email_from, sort_order)
VALUES (
  'cidadania',
  'Cidadania',
  'Citizenship',
  'Participação cívica, relatos comunitários e acompanhamento legislativo',
  '#0D9488',
  '#F0FDFA',
  'Landmark',
  '/agora',
  'cidadania@eloscloud.com',
  7
) ON CONFLICT (id) DO NOTHING;

-- Módulo: Ágora Digital
INSERT INTO platform_modules (id, name, description, icon, pillar, status, is_toggleable, parent_module_id)
VALUES (
  'agora_digital',
  'Ágora Digital',
  'Participação cívica hiperlocal: relatos, enquetes e informativos legislativos',
  'Landmark',
  'cidadania',
  'beta',
  true,
  NULL
) ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 16. Comentários
-- =============================================================================
COMMENT ON TABLE agora_regioes IS 'Hierarquia de regiões para participação cívica (comunidade→bairro→zona→município)';
COMMENT ON TABLE agora_regioes_log IS 'Audit trail automático de alterações em regiões cívicas';
COMMENT ON TABLE agora_relatos IS 'Relatos de infraestrutura IDENTIFICADOS — criado_por é user_id plaintext para peso legal';
COMMENT ON TABLE agora_assinaturas IS 'Assinaturas de relatos IDENTIFICADAS — user_id plaintext, CPF mascarado no manifesto';
COMMENT ON TABLE agora_moderacao_fila IS 'Fila de moderação: Guardiões L5 (cegos ao autor) + admin override + SLA 24h';
COMMENT ON TABLE agora_informativos IS 'Informativos legislativos curados por Trust Level ≥4 ou admin';
COMMENT ON TABLE agora_votos_enquete IS 'Votos ANÔNIMOS em informativos — user_id hasheado via HMAC (trigger)';
COMMENT ON TABLE agora_enquetes IS 'Enquetes comunitárias com encerramento automático';
COMMENT ON TABLE agora_respostas_enquete IS 'Respostas ANÔNIMAS a enquetes — user_id hasheado via HMAC (trigger)';
COMMENT ON TABLE civic_knowledge_base IS 'Dataset local do Fala.BR (CGU dados abertos) para roteamento cívico por IA';
COMMENT ON FUNCTION agora_hash_user_id() IS 'HMAC SHA-256 com salt configurável — anonimiza user_id APENAS em votos/respostas';
