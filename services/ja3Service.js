const { createHash } = require('crypto');
const { logger } = require('../logger');

/**
 * Calcula o hash JA3 a partir dos dados de fingerprint
 * @param {Object} fingerPrintData - Dados coletados do cliente
 * @returns {Object} Objeto contendo o hash JA3 calculado
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