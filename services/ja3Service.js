/**
 * @fileoverview Serviço para cálculo do hash JA3 a partir de dados de fingerprint TLS.
 * @module services/ja3Service
 * @requires crypto
 * @requires ../logger
 */
const { createHash } = require('crypto');
const { logger } = require('../logger');

/**
 * Calcula o hash JA3 a partir dos dados de fingerprint TLS coletados do cliente.
 * @async
 * @function calculateJA3Hash
 * @param {Object} fingerPrintData - Objeto contendo os dados de fingerprint TLS do cliente.
 * @param {number} fingerPrintData.version - A versão TLS.
 * @param {number[]} fingerPrintData.cipherSuites - Um array de IDs de cipher suites.
 * @param {number[]} fingerPrintData.extensions - Um array de IDs de extensões TLS.
 * @param {number[]} fingerPrintData.ellipticCurves - Um array de IDs de curvas elípticas.
 * @param {number[]} fingerPrintData.ellipticCurvePointFormats - Um array de IDs de formatos de ponto de curva elíptica.
 * @param {string} [fingerPrintData.userId] - O ID do usuário associado aos dados (para logging).
 * @returns {Promise<Object>} Um objeto contendo o hash JA3 calculado (`ja3Hash`).
 * @throws {Error} Se os dados de fingerprint forem inválidos ou incompletos, ou se ocorrer um erro durante o cálculo.
 * @description Constrói a string JA3 conforme o formato padrão e calcula seu hash MD5 para identificar o cliente de forma única.
 */
exports.calculateJA3Hash = async (fingerPrintData) => {
    try {
        const { version, cipherSuites, extensions, ellipticCurves, ellipticCurvePointFormats } = fingerPrintData;
        
        // Validação dos dados de entrada
        if (!version || !Array.isArray(cipherSuites) || cipherSuites.length === 0) {
            throw new Error('Dados de fingerprint inválidos ou incompletos');
        }
        
        // Construir a string JA3 conforme o formato padrão
        const ja3String = `${version},${cipherSuites.join('-')},${extensions.join('-')},${ellipticCurves.join('-')},${ellipticCurvePointFormats.join('-')}`;
        
        // Calcular o hash MD5
        const ja3Hash = createHash('md5').update(ja3String).digest('hex');
        
        logger.info('JA3 hash calculado com sucesso', { 
            userId: fingerPrintData.userId,
            ja3Hash: ja3Hash
        });
        
        return { ja3Hash };
    } catch (error) {
        logger.error('Erro ao calcular JA3 hash', { 
            error: error.message, 
            userId: fingerPrintData.userId 
        });
        throw new Error(`Falha ao calcular JA3 hash: ${error.message}`);
    }
};