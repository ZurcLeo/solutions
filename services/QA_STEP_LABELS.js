/**
 * Catálogo de labels e emojis amigáveis para os steps do QA.
 * 
 * Estrutura: { [flowId]: { _flow: { emoji, label }, [stepName]: { emoji, label } } }
 */
const QA_STEP_LABELS = {
  health: {
    _flow: { emoji: '🏥', label: 'Saúde da Infraestrutura' },
    check_public_health:       { emoji: '💓', label: 'Checando se o servidor está vivo' },
    validate_dependency_pings: { emoji: '🔌', label: 'Testando dependências externas' },
    verify_monitoring_active:  { emoji: '📡', label: 'Confirmando monitoramento ativo' },
  },
  auth: {
    _flow: { emoji: '🔐', label: 'Autenticação' },
    exchange_custom_token: { emoji: '🎫', label: 'Trocando token de sessão' },
    get_current_user:      { emoji: '👤', label: 'Identificando usuário' },
    refresh_token:         { emoji: '🔄', label: 'Renovando credenciais' },
  },
  invite: {
    _flow: { emoji: '✉️', label: 'Fluxo de Convites' },
    create_invite:         { emoji: '📝', label: 'Gerando novo convite' },
    validate_invite_token: { emoji: '🔍', label: 'Validando token de convite' },
    accept_invite:         { emoji: '🤝', label: 'Aceitando convite' },
  },
  caixinha: {
    _flow: { emoji: '📦', label: 'Gerenciamento de Caixinhas' },
    create_caixinha:       { emoji: '🆕', label: 'Criando nova caixinha' },
    get_caixinha_details:  { emoji: '📋', label: 'Buscando detalhes' },
    invite_member:         { emoji: '👥', label: 'Convidando membro' },
    approve_member:        { emoji: '✅', label: 'Aprovando novo membro' },
  },
  financial: {
    _flow: { emoji: '💰', label: 'Operações Financeiras' },
    simulate_pix_deposit:  { emoji: '💸', label: 'Simulando depósito PIX' },
    verify_ledger_balance: { emoji: '📊', label: 'Conferindo saldo no ledger' },
    create_and_buy_raffle: { emoji: '🎰', label: 'Criando e comprando rifa' },
  },
  loan: {
    _flow: { emoji: '🎟️', label: 'Empréstimos' },
    request_loan:          { emoji: '🙋', label: 'Solicitando empréstimo' },
    approve_loan:          { emoji: '✍️', label: 'Aprovando solicitação' },
    pay_loan_installment:  { emoji: '💳', label: 'Pagando parcela' },
  },
  webhook: {
    _flow: { emoji: '🪝', label: 'Integrações (Webhooks)' },
    receive_pix_event:     { emoji: '📥', label: 'Recebendo evento PIX' },
    process_payment_sync:  { emoji: '🔄', label: 'Sincronizando pagamento' },
  },
  social: {
    _flow: { emoji: '💬', label: 'Interações Sociais' },
    send_message:          { emoji: '✉️', label: 'Enviando mensagem' },
    list_conversations:    { emoji: '📱', label: 'Listando conversas' },
  },
  notification: {
    _flow: { emoji: '🔔', label: 'Sistema de Notificações' },
    trigger_notif:         { emoji: '🚀', label: 'Disparando notificação' },
    verify_delivery:       { emoji: '📦', label: 'Verificando entrega' },
  }
};

module.exports = QA_STEP_LABELS;
