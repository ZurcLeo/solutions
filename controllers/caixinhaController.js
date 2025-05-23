// src/controllers/caixinhaController.js
const { logger } = require('../logger');
const Membro = require('../models/Membro')
const CaixinhaService = require('../services/caixinhaService');
const ContribuicaoService = require('../services/contribuicaoService');
const MembrosService = require('../services/membrosService');
const TransactionService = require('../services/transactionService');

/**
 * Busca todas as caixinhas para o usuário atual
 */

const getCaixinhas = async (req, res) => {

  const userId = req.user.uid;
    // Log the start of the request
    logger.info('Iniciando busca de caixinhas', {
      controller: 'CaixinhaController',
      method: 'getCaixinhas',
      userId
    });
  
    try {
      if (!req.user) {
        logger.warn('Tentativa de acesso sem autenticação', {
          controller: 'CaixinhaController',
          method: 'getCaixinhas'
        });
        return res.status(401).json({
          message: 'Usuário não autenticado'
        });
      }
  
      const caixinhas = await CaixinhaService.getAllCaixinhas(userId);
      logger.info('Caixinhas recuperadas com sucesso', {
        controller: 'CaixinhaController',
        method: 'getCaixinhas',
        userId,
        count: caixinhas.length
      });
  
      return res.status(200).json({
        success: true,
        data: caixinhas
      });
    } catch (error) {
      logger.error('Erro ao buscar caixinhas', {
        controller: 'CaixinhaController',
        method: 'getCaixinhas',
        error: error.message,
        stack: error.stack,
        userId: req.user?.ucaixinhaId
      });
  
      return res.status(500).json({
        success: false,
        message: 'Erro ao buscar caixinhas',
        error: error.message
      });
    }
  }
  
  /**
   * Gerencia empréstimos da caixinha
   */
 const gerenciarEmprestimos = async (req, res) => {
    const { caixinhaId } = req.params;
    const { acao, emprestimoId, dados } = req.body;

    try {
      logger.info('Gerenciando empréstimos', {
        controller: 'CaixinhaController',
        method: 'gerenciarEmprestimos',
        caixinhaId,
        acao,
        emprestimoId,
        userId: req.user.ucaixinhaId
      });

      let resultado;

      switch (acao) {
        case 'solicitar':
          resultado = await TransactionService.solicitarEmprestimo(
            caixinhaId,
            {
              ...dados,
              membroId: req.user.uid
            }
          );
          break;

        case 'aprovar':
          resultado = await TransactionService.processarEmprestimo(
            caixinhaId,
            emprestimoId,
            true
          );
          break;

        case 'rejeitar':
          resultado = await TransactionService.processarEmprestimo(
            caixinhaId,
            emprestimoId,
            false
          );
          break;

        case 'pagar':
          resultado = await TransactionService.registrarPagamentoEmprestimo(
            caixinhaId,
            emprestimoId,
            dados.valor
          );
          break;

        default:
          throw new Error('Ação inválcaixinhaIda');
      }

      res.status(200).json(resultado);
    } catch (error) {
      logger.error('Erro ao gerenciar empréstimos', {
        controller: 'CaixinhaController',
        method: 'gerenciarEmprestimos',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        message: 'Erro ao gerenciar empréstimos',
        error: error.message
      });
    }
  }

  /**
   * Gera relatórios da caixinha
   */
 const gerarRelatorio = async (req, res) => {
    const { caixinhaId } = req.params;
    const { tipo, filtros } = req.query;

    try {
      logger.info('Gerando relatório', {
        controller: 'CaixinhaController',
        method: 'gerarRelatorio',
        caixinhaId,
        tipo,
        filtros,
        userId: req.user.ucaixinhaId
      });

      let relatorio;

      switch (tipo) {
        case 'geral':
          relatorio = await CaixinhaService.getRelatorio(caixinhaId, filtros);
          break;

        case 'contribuicoes':
          relatorio = await ContribuicaoService.gerarRelatorioContribuicoes(caixinhaId, filtros);
          break;

        case 'participacao':
          relatorio = await MembrosService.gerarRelatorioParticipacao(caixinhaId, filtros);
          break;

        case 'transacoes':
          relatorio = await TransactionService.gerarExtrato(caixinhaId, filtros);
          break;

        default:
          throw new Error('Tipo de relatório inválcaixinhaIdo');
      }

      res.status(200).json(relatorio);
    } catch (error) {
      logger.error('Erro ao gerar relatório', {
        controller: 'CaixinhaController',
        method: 'gerarRelatorio',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        message: 'Erro ao gerar relatório',
        error: error.message
      });
    }
  }

  /**
   * Verifica as configurações da caixinha
   */
 const verificarConfiguracoes = async (req, res) => {
    const { caixinhaId } = req.params;

    try {
      logger.info('Verificando configurações', {
        controller: 'CaixinhaController',
        method: 'verificarConfiguracoes',
        caixinhaId,
        userId: req.user.ucaixinhaId
      });

      const configuracoes = await CaixinhaService.getConfiguracoes(caixinhaId);
      
      res.status(200).json(configuracoes);
    } catch (error) {
      logger.error('Erro ao verificar configurações', {
        controller: 'CaixinhaController',
        method: 'verificarConfiguracoes',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        message: 'Erro ao verificar configurações',
        error: error.message
      });
    }
  }

  /**
   * Busca uma caixinha específica por ID
   */
  const getCaixinhaById = async (req, res) => {
    const { caixinhaId } = req.params;
  
    if (!caixinhaId || typeof caixinhaId !== 'string' || !caixinhaId.trim()) {
      logger.warn('ID da caixinha ausente ou inválcaixinhaIdo', { controller: 'CaixinhaController', method: 'getCaixinhaById' });
      return res.status(400).json({ message: 'ID da caixinha é obrigatório.' });
    }

    try {
      const caixinha = await CaixinhaService.getCaixinhaById(caixinhaId);
      if (!caixinha) {
        return res.status(404).json({ message: 'Caixinha não encontrada' });
      }
  
      res.status(200).json(caixinha);
    } catch (error) {
      logger.error('Erro ao buscar caixinha', { controller: 'CaixinhaController', method: 'getCaixinhaById', caixinhaId: caixinhaId, error: error.message });
      res.status(500).json({ message: 'Erro ao buscar caixinha', error: error.message });
    }
  };
  

  /**
   * Cria uma nova caixinha
   */
 const createCaixinha = async (req, res) => {
    try {
      logger.info('Criando nova caixinha', {
        controller: 'CaixinhaController',
        method: 'createCaixinha',
        userId: req.user.uid,
        data: req.body
      });

      const caixinha = await CaixinhaService.createCaixinha({
        ...req.body,
        adminId: req.user.uid
      });

      res.status(201).json(caixinha);
    } catch (error) {
      logger.error('Erro ao criar caixinha', {
        controller: 'CaixinhaController',
        method: 'createCaixinha',
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        message: 'Erro ao criar caixinha',
        error: error.message
      });
    }
  }

  /**
   * Atualiza uma caixinha existente
   */
 const updateCaixinha = async (req, res) => {
    const { caixinhaId } = req.params;

    try {
      logger.info('Atualizando caixinha', {
        controller: 'CaixinhaController',
        method: 'updateCaixinha',
        caixinhaId: caixinhaId,
        userId: req.user.ucaixinhaId,
        data: req.body
      });

      const caixinha = await CaixinhaService.updateCaixinha(caixinhaId, req.body);
      
      res.status(200).json(caixinha);
    } catch (error) {
      logger.error('Erro ao atualizar caixinha', {
        controller: 'CaixinhaController',
        method: 'updateCaixinha',
        caixinhaId: caixinhaId,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        message: 'Erro ao atualizar caixinha',
        error: error.message
      });
    }
  }

  /**
   * Remove uma caixinha
   */
 const deleteCaixinha = async (req, res) => {
    const { caixinhaId } = req.params;

    try {
      logger.info('Removendo caixinha', {
        controller: 'CaixinhaController',
        method: 'deleteCaixinha',
        caixinhaId: caixinhaId,
        userId: req.user.ucaixinhaId
      });

      await CaixinhaService.deleteCaixinha(caixinhaId);
      
      res.status(200).json({ message: 'Caixinha removcaixinhaIda com sucesso' });
    } catch (error) {
      logger.error('Erro ao remover caixinha', {
        controller: 'CaixinhaController',
        method: 'deleteCaixinha',
        caixinhaId: caixinhaId,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        message: 'Erro ao remover caixinha',
        error: error.message
      });
    }
  }

  /**
   * Registra uma nova contribuição
   */
 const addContribuicao = async (req, res) => {
    const { caixinhaId } = req.params;

    try {
      logger.info('Registrando nova contribuição', {
        controller: 'CaixinhaController',
        method: 'addContribuicao',
        caixinhaId,
        userId: req.user.ucaixinhaId,
        data: req.body
      });

      const contribuicao = await ContribuicaoService.registrarContribuicao(
        caixinhaId,
        {
          ...req.body,
          membroId: req.user.ucaixinhaId
        }
      );

      res.status(201).json(contribuicao);
    } catch (error) {
      logger.error('Erro ao registrar contribuição', {
        controller: 'CaixinhaController',
        method: 'addContribuicao',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        message: 'Erro ao registrar contribuição',
        error: error.message
      });
    }
  }

/**
 * Obtém convites enviados pelo usuário
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getMembers = async (req, res) => {
  try {
    const {caixinhaId} = req.params; // Obtido do middleware de autenticação
    
    const membros = await Membro.getAllByCaixinhaId(caixinhaId);
    
    res.status(200).json(membros);
  } catch (error) {
    console.error('Erro ao buscar membros:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao buscar membros.'
    });
  }
};

  /**
 * Gerencia membros da caixinha
 */
const gerenciarMembros = async (req, res) => {
    const { caixinhaId } = req.params; // ID da caixinha
    const { acao, membroId, dados } = req.body; // Detalhes da ação, membro e dados adicionais
  
    try {
      // Log inicial
      logger.info('Gerenciando membros da caixinha', {
        controller: 'CaixinhaController',
        method: 'gerenciarMembros',
        caixinhaId,
        acao,
        membroId,
        userId: req.user?.ucaixinhaId // Verificação segura do UID do usuário
      });
  
      let resultado;
  
      // Verificação da ação solicitada
      switch (acao) {
        case 'adicionar': // Adicionar membro
          resultado = await MembrosService.adicionarMembro(caixinhaId, {
            ...dados,
            userId: membroId // Define o membro a ser adicionado
          });
          break;
  
        case 'atualizar': // Atualizar status do membro
          resultado = await MembrosService.atualizarStatusMembro(
            caixinhaId,
            membroId,
            dados?.novoStatus, // Novo status forneccaixinhaIdo
            dados?.motivo // Motivo da alteração
          );
          break;
  
        case 'remover': // Remover membro
          resultado = await MembrosService.removerMembro(
            caixinhaId,
            membroId,
            dados?.motivo // Motivo da remoção, se forneccaixinhaIdo
          );
          break;
  
        case 'transferir': // Transferir administração
          resultado = await MembrosService.transferirAdministracao(
            caixinhaId,
            membroId,
            dados?.motivo // Motivo da transferência, se forneccaixinhaIdo
          );
          break;
  
        default: // Ação inválcaixinhaIda
          throw new Error('Ação inválcaixinhaIda'); // Lança erro para ações não reconheccaixinhaIdas
      }
  
      // Log de sucesso e resposta para o cliente
      logger.info('Membros gerenciados com sucesso', {
        controller: 'CaixinhaController',
        method: 'gerenciarMembros',
        caixinhaId,
        acao,
        membroId,
        resultado
      });
  
      res.status(200).json({
        success: true,
        message: 'Ação executada com sucesso',
        data: resultado
      });
    } catch (error) {
      // Log de erro
      logger.error('Erro ao gerenciar membros', {
        controller: 'CaixinhaController',
        method: 'gerenciarMembros',
        caixinhaId,
        acao,
        membroId,
        error: error.message,
        stack: error.stack
      });
  
      // Resposta de erro para o cliente
      res.status(500).json({
        success: false,
        message: 'Erro ao gerenciar membros',
        error: error.message
      });
    }
  }

  module.exports = {
    getCaixinhas,
    gerenciarEmprestimos,
    gerarRelatorio,
    verificarConfiguracoes,
    getCaixinhaById,
    createCaixinha,
    updateCaixinha,
    deleteCaixinha,
    addContribuicao,
    getMembers,
    gerenciarMembros
  }