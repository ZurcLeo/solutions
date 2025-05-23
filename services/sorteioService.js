// src/services/sorteioService.js
const axios = require('axios');
const crypto = require('crypto');
const { logger } = require('../logger');
const Rifa = require('../models/Rifa');

/**
 * Serviço para gerenciamento de sorteios
 */

/**
 * Obtém o resultado de um concurso da loteria
 * @param {string} concursoId - ID do concurso
 * @returns {Promise<number>} - Número sorteado
 */
const obterResultadoLoteria = async (concursoId) => {
  try {
    logger.info('Obtendo resultado da loteria', {
      service: 'sorteioService',
      method: 'obterResultadoLoteria',
      concursoId
    });

    // Usar a API oficial da loteria (exemplo)
    const response = await axios.get(`https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil/${concursoId}`);
    
    if (!response.data || !response.data.dezenas || response.data.dezenas.length === 0) {
      throw new Error('Não foi possível obter o resultado da loteria');
    }
    
    // Pegar o primeiro número como resultado (poderia ser qualquer um ou uma combinação)
    const numeroSorteado = parseInt(response.data.dezenas[0]);
    
    logger.info('Resultado da loteria obtido com sucesso', {
      service: 'sorteioService',
      method: 'obterResultadoLoteria',
      concursoId,
      numeroSorteado
    });
    
    return numeroSorteado;
  } catch (error) {
    logger.error('Erro ao obter resultado da loteria', {
      service: 'sorteioService',
      method: 'obterResultadoLoteria',
      concursoId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Obtém um número aleatório do Random.org
 * @param {number} min - Valor mínimo
 * @param {number} max - Valor máximo
 * @param {number} quantidade - Quantidade de números
 * @returns {Promise<number>} - Número sorteado
 */
const obterNumeroAleatorioRandomOrg = async (min, max, quantidade = 1) => {
  try {
    logger.info('Obtendo número aleatório do Random.org', {
      service: 'sorteioService',
      method: 'obterNumeroAleatorioRandomOrg',
      min,
      max,
      quantidade
    });

    // Usar a API do Random.org
    const response = await axios.get(`https://www.random.org/integers/?num=${quantidade}&min=${min}&max=${max}&col=1&base=10&format=plain&rnd=new`);
    
    if (!response.data) {
      throw new Error('Não foi possível obter número aleatório do Random.org');
    }
    
    // Parsear o resultado (normalmente é retornado como texto)
    const numeroSorteado = parseInt(response.data.trim());
    
    logger.info('Número aleatório obtido com sucesso do Random.org', {
      service: 'sorteioService',
      method: 'obterNumeroAleatorioRandomOrg',
      numeroSorteado
    });
    
    return numeroSorteado;
  } catch (error) {
    logger.error('Erro ao obter número aleatório do Random.org', {
      service: 'sorteioService',
      method: 'obterNumeroAleatorioRandomOrg',
      error: error.message,
      stack: error.stack
    });
    
    // Fallback para geração local em caso de falha
    logger.info('Utilizando fallback local para geração de número aleatório', {
      service: 'sorteioService',
      method: 'obterNumeroAleatorioRandomOrg'
    });
    
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
};

/**
 * Obtém um número aleatório do NIST Beacon
 * @param {number} max - Valor máximo
 * @returns {Promise<number>} - Número sorteado
 */
const obterNumeroAleatorioNIST = async (max) => {
  try {
    logger.info('Obtendo número aleatório do NIST Beacon', {
      service: 'sorteioService',
      method: 'obterNumeroAleatorioNIST',
      max
    });

    // Usar a API do NIST Beacon
    const response = await axios.get('https://beacon.nist.gov/beacon/2.0/pulse/last');
    
    if (!response.data || !response.data.pulse || !response.data.pulse.outputValue) {
      throw new Error('Não foi possível obter número aleatório do NIST Beacon');
    }
    
    // Converter o valor hexadecimal para decimal e limitar ao intervalo desejado
    const hexValue = response.data.pulse.outputValue;
    const decimalValue = parseInt(hexValue.substring(0, 8), 16);
    const numeroSorteado = (decimalValue % max) + 1;
    
    logger.info('Número aleatório obtido com sucesso do NIST Beacon', {
      service: 'sorteioService',
      method: 'obterNumeroAleatorioNIST',
      numeroSorteado
    });
    
    return numeroSorteado;
  } catch (error) {
    logger.error('Erro ao obter número aleatório do NIST Beacon', {
      service: 'sorteioService',
      method: 'obterNumeroAleatorioNIST',
      error: error.message,
      stack: error.stack
    });
    
    // Fallback para geração local em caso de falha
    logger.info('Utilizando fallback local para geração de número aleatório', {
      service: 'sorteioService',
      method: 'obterNumeroAleatorioNIST'
    });
    
    return Math.floor(Math.random() * max) + 1;
  }
};

/**
 * Verifica a integridade de um sorteio
 * @param {string} rifaId - ID da rifa
 * @param {Object} resultado - Resultado do sorteio
 * @returns {Promise<Object>} - Resultado da verificação
 */
const verificarIntegridade = async (rifaId, resultado) => {
  try {
    logger.info('Verificando integridade do sorteio', {
      service: 'sorteioService',
      method: 'verificarIntegridade',
      rifaId
    });

    // Obter a rifa
    const rifa = await Rifa.getById(rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }

    // Verificar se o hash corresponde
    const dadosVerificacao = {
      rifaId,
      numeroSorteado: resultado.numeroSorteado,
      metodo: rifa.sorteioMetodo,
      referencia: rifa.sorteioReferencia,
      timestamp: resultado.dataSorteio
    };

    const hashCalculado = gerarHashVerificacao(dadosVerificacao);
    const hashArmazenado = resultado.verificacaoHash;
    
    const integridadeOk = hashCalculado === hashArmazenado;
    
    // Verificar a fonte externa, se aplicável
    let fonteExternaOk = false;
    
    if (rifa.sorteioMetodo === 'LOTERIA' && rifa.sorteioReferencia) {
      try {
        const numeroLoteria = await obterResultadoLoteria(rifa.sorteioReferencia);
        fonteExternaOk = numeroLoteria === resultado.numeroSorteado;
      } catch (err) {
        logger.warn('Não foi possível verificar o resultado da loteria', {
          service: 'sorteioService',
          method: 'verificarIntegridade',
          error: err.message
        });
        fonteExternaOk = 'Indisponível';
      }
    } else {
      fonteExternaOk = 'Não aplicável';
    }
    
    const verificacaoResultado = {
      rifaId,
      dataVerificacao: new Date().toISOString(),
      integridadeOk,
      fonteExternaOk,
      metodoSorteio: rifa.sorteioMetodo,
      hashArmazenado,
      hashCalculado
    };
    
    logger.info('Integridade do sorteio verificada', {
      service: 'sorteioService',
      method: 'verificarIntegridade',
      rifaId,
      resultado: verificacaoResultado
    });
    
    return verificacaoResultado;
  } catch (error) {
    logger.error('Erro ao verificar integridade do sorteio', {
      service: 'sorteioService',
      method: 'verificarIntegridade',
      rifaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Gera um hash para verificação
 * @param {Object} dados - Dados para gerar o hash
 * @returns {string} - Hash gerado
 */
const gerarHashVerificacao = (dados) => {
  const dadosString = JSON.stringify(dados);
  return crypto.createHash('sha256').update(dadosString).digest('hex');
};

/**
 * Gera um comprovante do sorteio
 * @param {string} rifaId - ID da rifa
 * @param {Object} resultado - Resultado do sorteio
 * @returns {Promise<string>} - URL do comprovante
 */
const gerarComprovante = async (rifaId, resultado) => {
  try {
    logger.info('Gerando comprovante do sorteio', {
      service: 'sorteioService',
      method: 'gerarComprovante',
      rifaId
    });

    // Obter a rifa
    const rifa = await Rifa.getById(rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }

    // Na versão final, aqui seria gerado um PDF ou outro formato de comprovante
    // Para simplificar neste exemplo, vamos apenas gerar um URL simulado
    
    const comprovanteData = {
      rifaId,
      nome: rifa.nome,
      numeroSorteado: resultado.numeroSorteado,
      bilheteVencedor: resultado.bilheteVencedor,
      dataSorteio: resultado.dataSorteio,
      metodo: rifa.sorteioMetodo,
      referencia: rifa.sorteioReferencia,
      hash: resultado.verificacaoHash,
      timestampComprovante: new Date().toISOString()
    };
    
    // Gerar um ID único para o comprovante
    const comprovanteId = crypto.randomBytes(16).toString('hex');
    
    // Em uma implementação real, aqui o comprovante seria armazenado em um bucket S3 ou similar
    // e retornaria a URL para acesso
    const comprovanteUrl = `/api/comprovantes/${comprovanteId}`;
    
    logger.info('Comprovante do sorteio gerado com sucesso', {
      service: 'sorteioService',
      method: 'gerarComprovante',
      rifaId,
      comprovanteId,
      comprovanteUrl
    });
    
    return comprovanteUrl;
  } catch (error) {
    logger.error('Erro ao gerar comprovante do sorteio', {
      service: 'sorteioService',
      method: 'gerarComprovante',
      rifaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

module.exports = {
  obterResultadoLoteria,
  obterNumeroAleatorioRandomOrg,
  obterNumeroAleatorioNIST,
  verificarIntegridade,
  gerarComprovante,
  gerarHashVerificacao
};