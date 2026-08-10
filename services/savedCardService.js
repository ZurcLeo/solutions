// services/savedCardService.js — PAY-CARD-001
// Gerencia cartões salvos via tokenização Asaas

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../logger');
const asaasService = require('./asaasService');

const MAX_CARDS = 5;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

/**
 * Lista cartões salvos do usuário (default primeiro, depois por data).
 */
async function listCards(userId) {
  const { data, error } = await sb()
    .from('user_saved_cards')
    .select('id, gateway, brand, last_four, holder_name, nickname, is_default, exp_month, exp_year, created_at')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Erro ao listar cartões: ${error.message}`);
  return data || [];
}

/**
 * Salva um cartão tokenizado. Automaticamente seta como default se for o primeiro.
 */
async function saveCard(userId, { gatewayCustomerId, gatewayToken, brand, lastFour, holderName, nickname, expMonth, expYear }) {
  // Verificar limite
  const existing = await listCards(userId);
  if (existing.length >= MAX_CARDS) {
    throw new Error(`Limite de ${MAX_CARDS} cartões atingido. Remova um cartão antes de adicionar outro.`);
  }

  const isFirst = existing.length === 0;

  const { data, error } = await sb()
    .from('user_saved_cards')
    .insert({
      user_id: userId,
      gateway_customer_id: gatewayCustomerId,
      gateway_token: gatewayToken,
      brand: brand.toUpperCase(),
      last_four: lastFour,
      holder_name: holderName,
      nickname: nickname || null,
      is_default: isFirst,
      exp_month: expMonth || null,
      exp_year: expYear || null,
    })
    .select('id, brand, last_four, holder_name, nickname, is_default, exp_month, exp_year, created_at')
    .single();

  if (error) throw new Error(`Erro ao salvar cartão: ${error.message}`);

  logger.info('Cartão salvo com sucesso', { userId, cardId: data.id, brand: data.brand, isDefault: data.is_default });
  return data;
}

/**
 * Remove um cartão. Se era default e restam cartões, promove o mais antigo.
 */
async function deleteCard(userId, cardId) {
  // Verificar ownership
  const { data: card, error: fetchErr } = await sb()
    .from('user_saved_cards')
    .select('id, is_default')
    .eq('id', cardId)
    .eq('user_id', userId)
    .single();

  if (fetchErr || !card) throw new Error('Cartão não encontrado');

  const { error: delErr } = await sb()
    .from('user_saved_cards')
    .delete()
    .eq('id', cardId)
    .eq('user_id', userId);

  if (delErr) throw new Error(`Erro ao remover cartão: ${delErr.message}`);

  // Se era default, promover o mais antigo
  if (card.is_default) {
    const { data: remaining } = await sb()
      .from('user_saved_cards')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);

    if (remaining?.length) {
      await sb()
        .from('user_saved_cards')
        .update({ is_default: true })
        .eq('id', remaining[0].id)
        .eq('user_id', userId);
    }
  }

  logger.info('Cartão removido', { userId, cardId });
  return { deleted: true };
}

/**
 * Define um cartão como padrão (remove default dos outros).
 * O UNIQUE partial index (usc_one_default_per_user) protege contra race conditions —
 * se duas requests concorrentes competirem, uma falhará e pode retried.
 * Ordem: primeiro desmarca outros, depois marca o novo (minimiza janela).
 */
async function setDefault(userId, cardId) {
  // Verificar que cartão existe e pertence ao user
  const { data: card, error: fetchErr } = await sb()
    .from('user_saved_cards')
    .select('id')
    .eq('id', cardId)
    .eq('user_id', userId)
    .single();

  if (fetchErr || !card) throw new Error('Cartão não encontrado');

  // 1) Desmarcar default de OUTROS cartões (exclui o target para evitar conflito)
  await sb()
    .from('user_saved_cards')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true)
    .neq('id', cardId);

  // 2) Marcar o target como default
  const { data, error } = await sb()
    .from('user_saved_cards')
    .update({ is_default: true })
    .eq('id', cardId)
    .eq('user_id', userId)
    .select('id, brand, last_four, holder_name, nickname, is_default')
    .single();

  if (error) throw new Error(`Erro ao definir padrão: ${error.message}`);

  logger.info('Cartão definido como padrão', { userId, cardId });
  return data;
}

/**
 * Retorna o cartão padrão do usuário (ou null).
 */
async function getDefault(userId) {
  const { data, error } = await sb()
    .from('user_saved_cards')
    .select('id, gateway, gateway_customer_id, gateway_token, brand, last_four, holder_name, nickname, is_default, exp_month, exp_year')
    .eq('user_id', userId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar cartão padrão: ${error.message}`);
  return data || null;
}

/**
 * Busca um cartão salvo pelo ID (incluindo gateway_token para cobrança).
 */
async function getCardById(userId, cardId) {
  const { data, error } = await sb()
    .from('user_saved_cards')
    .select('id, gateway, gateway_customer_id, gateway_token, brand, last_four, holder_name')
    .eq('id', cardId)
    .eq('user_id', userId)
    .single();

  if (error || !data) throw new Error('Cartão não encontrado');
  return data;
}

/**
 * Tokeniza cartão na Asaas e salva localmente.
 * Orquestra o fluxo completo: tokenize → save.
 */
async function tokenizeAndSave(userId, { cardData, holderInfo, remoteIp, nickname }) {
  // Criar/reutilizar customer Asaas
  const customer = await asaasService.createCustomer({
    name: holderInfo.name,
    email: holderInfo.email,
    cpfCnpj: holderInfo.cpfCnpj || undefined,
    externalReference: userId,
  });

  const customerId = customer.customerId || customer.id;

  // Tokenizar no Asaas
  const tokenResult = await asaasService.tokenizeCreditCard({
    customerId,
    creditCard: {
      holderName: cardData.holderName,
      number: cardData.number,
      expiryMonth: cardData.expiryMonth,
      expiryYear: cardData.expiryYear,
      ccv: cardData.ccv,
    },
    creditCardHolderInfo: {
      name: holderInfo.name,
      email: holderInfo.email,
      phone: holderInfo.phone || undefined,
      postalCode: holderInfo.postalCode || '00000000',
    },
    remoteIp,
  });

  // Salvar localmente
  return saveCard(userId, {
    gatewayCustomerId: customerId,
    gatewayToken: tokenResult.creditCardToken,
    brand: tokenResult.creditCardBrand,
    lastFour: tokenResult.creditCardNumber,
    holderName: cardData.holderName,
    nickname,
    expMonth: cardData.expiryMonth,
    expYear: cardData.expiryYear,
  });
}

module.exports = {
  listCards,
  saveCard,
  deleteCard,
  setDefault,
  getDefault,
  getCardById,
  tokenizeAndSave,
};
