-- Migration: 20260531000001_caixinha_assentos_concursos.sql
-- Adiciona campos de assentos e habilitação de concursos à tabela caixinhas.
--
-- assentos: capacidade máxima de membros definida na criação (nullable — caixinhas
--           existentes não têm esse valor e seguem o comportamento legado sem limite).
-- concursos_habilitados: toggle de feature de concursos internos (desabilitado por padrão).

ALTER TABLE caixinhas
  ADD COLUMN IF NOT EXISTS assentos                integer       CHECK (assentos IS NULL OR assentos >= 2),
  ADD COLUMN IF NOT EXISTS concursos_habilitados   boolean       NOT NULL DEFAULT false;

COMMENT ON COLUMN caixinhas.assentos
  IS 'Capacidade máxima de membros definida pelo criador. NULL = sem limite (legado).';

COMMENT ON COLUMN caixinhas.concursos_habilitados
  IS 'Habilita feature de concursos internos (desafios/metas entre membros). Pode ser alterado por votação do grupo.';
