-- Migration: 20260527000002_support_macros.sql
-- Macros / Respostas Rápidas para agentes de suporte
-- Agentes digitam "/" no campo de nota para acionar o autocomplete

CREATE TABLE IF NOT EXISTS support_macros (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  category    TEXT,                                        -- general, technical, account, financial, caixinha
  created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_support_macros_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER support_macros_updated_at
  BEFORE UPDATE ON support_macros
  FOR EACH ROW EXECUTE FUNCTION update_support_macros_updated_at();

-- RLS
ALTER TABLE support_macros ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado com role de suporte pode LER macros ativas
CREATE POLICY "support_macros_read"
  ON support_macros FOR SELECT
  TO authenticated
  USING (active = true);

-- Apenas admins podem INSERT/UPDATE/DELETE
CREATE POLICY "support_macros_admin_write"
  ON support_macros FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()::text
        AND ur.role_id IN ('admin', 'adm-master')
    )
  );

-- Índices
CREATE INDEX IF NOT EXISTS support_macros_category_idx ON support_macros (category) WHERE active = true;

-- Macros padrão de bootstrap
INSERT INTO support_macros (title, body, category) VALUES
  ('Confirmação de recebimento',
   'Olá! Recebemos seu chamado e ele foi registrado em nosso sistema. Nossa equipe irá analisá-lo e retornará em breve. Agradecemos o contato!',
   'general'),

  ('Aguardando retorno do usuário',
   'Olá! Entramos em contato para solicitar mais informações sobre o seu chamado. Aguardamos o seu retorno para que possamos continuar o atendimento.',
   'general'),

  ('Ticket resolvido — encerramento',
   'Seu chamado foi resolvido com sucesso. Caso tenha mais dúvidas ou precise de suporte adicional, fique à vontade para abrir um novo ticket. Obrigado pelo contato!',
   'general'),

  ('Em análise pela equipe técnica',
   'Seu caso foi escalado para nossa equipe técnica especializada. Você será notificado assim que tivermos uma atualização. O prazo estimado de resposta é de até 24h úteis.',
   'technical'),

  ('Instrução — resetar senha',
   'Para redefinir sua senha, acesse: Perfil → Configurações → Segurança → Alterar Senha. Caso tenha dificuldades, podemos enviar um link de redefinição por e-mail. Deseja que enviemos?',
   'account'),

  ('Instrução — empréstimo pendente',
   'Identificamos que há um empréstimo pendente de aprovação em sua caixinha. Os membros votantes precisam aprovar a solicitação na seção Caixinha → Empréstimos. Caso precise de mais detalhes, estamos à disposição.',
   'caixinha'),

  ('Orientação — saldo de EloCoins',
   'Seu saldo de EloCoins é calculado com base nas atividades completadas na plataforma. Você pode verificar o extrato completo em Carteira → Histórico de EloCoins.',
   'financial')
ON CONFLICT DO NOTHING;
