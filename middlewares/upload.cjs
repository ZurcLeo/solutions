const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const crypto = require('crypto');
const { logger } = require('../logger');

// Configuração centralizada do armazenamento do multer
const storage = multer.memoryStorage();

// Função para garantir que o diretório exista
const ensureDirectoryExistence = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info('Diretório criado', {
      service: 'uploadMiddleware',
      function: 'ensureDirectoryExistence',
      directory: dir,
    });
  }
};

// Função para validação de imagem
const validateImage = async (buffer) => {
  if (!buffer || buffer.length === 0) {
    const error = new Error('Buffer inválido ou vazio');
    logger.error('Erro ao validar imagem', {
      service: 'uploadMiddleware',
      function: 'validateImage',
      error: error.message,
    });
    throw error;
  }
  const imageType = (await import('image-type')).default;
  const type = imageType(buffer);
  if (!type || !['jpg', 'png', 'gif', 'jpeg'].includes(type.ext)) {
    const error = new Error('Tipo de imagem inválido');
    logger.error('Erro ao validar imagem', {
      service: 'uploadMiddleware',
      function: 'validateImage',
      error: error.message,
    });
    throw error;
  }
  return true;
};

// Função para compressão de imagem
const compressImage = async (buffer) => {
  return sharp(buffer)
    .resize({ width: 800, height: 800, fit: 'inside' })
    .jpeg({ quality: 80 })
    .toBuffer();
};

// Função para gerar miniaturas
const generateThumbnail = async (buffer) => {
  return sharp(buffer)
    .resize(200, 200, { fit: 'cover' })
    .toBuffer();
};

// Função para verificar duplicatas (exemplo simplificado)
const checkDuplicate = async (buffer) => {
  const hash = crypto.createHash('md5').update(buffer).digest('hex');
  logger.info('Verificando duplicatas', {
    service: 'uploadMiddleware',
    function: 'checkDuplicate',
    hash,
  });

  // Implementar lógica real de verificação de duplicatas, se necessário
  // Por exemplo, verificar se o hash já existe em algum banco de dados

  return false; // Atualmente, sempre retornando false como placeholder
};

// Filtro de arquivo para validação e verificação de duplicatas
const fileFilter = async (req, file, cb) => {
  logger.info('req no upload.cjs: ', req);

  try {
    // Verifica se o arquivo está presente
    if (!file) {
      const error = new Error('Arquivo não encontrado');
      logger.error('Erro no filtro de arquivo', {
        service: 'uploadMiddleware',
        function: 'fileFilter',
        error: error.message,
      });
      return cb(error);
    }

    // Verifica se o buffer do arquivo está presente
    if (!file.buffer || file.buffer.length === 0) {
      const error = new Error('Buffer vazio');
      logger.error('Erro no filtro de arquivo', {
        service: 'uploadMiddleware',
        function: 'fileFilter',
        error: error.message,
      });
      return cb(error);
    }

    // Valida a imagem
    await validateImage(file.buffer);

    // Verifica duplicatas
    if (await checkDuplicate(file.buffer)) {
      const error = new Error('Imagem duplicada');
      logger.error('Erro no filtro de arquivo', {
        service: 'uploadMiddleware',
        function: 'fileFilter',
        error: error.message,
      });
      return cb(error);
    }

    logger.info('Arquivo aceito', {
      service: 'uploadMiddleware',
      function: 'fileFilter',
      fileName: file.originalname,
    });
    cb(null, true);
  } catch (error) {
    logger.error('Erro ao validar imagem', {
      service: 'uploadMiddleware',
      function: 'fileFilter',
      error: error.message,
    });
    cb(error);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB por exemplo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens são permitidas!'));
    }
  },
});

// // Middleware de upload usando multer
// const upload = multer({
//   storage,
//   limits: {
//     fileSize: 1024 * 1024 * 5, // Limite de 5MB para o tamanho do arquivo
//   },
//   fileFilter,
// });

// Tratamento de erros aprimorado
const errorHandler = (error, req, res, next) => {
  logger.error('Erro no upload', { service: 'uploadMiddleware', error: error.message });
  res.status(400).json({ error: 'Falha no upload da imagem', details: error.message });
};

module.exports = {
  upload,
  errorHandler,
};