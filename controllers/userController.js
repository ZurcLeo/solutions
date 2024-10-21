//controllers/userController.js
const { db, storage } = require('../firebaseAdmin');
const { logger } = require('../logger');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');

const addUser = async (req, res) => {
  logger.info('Requisição para adicionar usuário', {
    service: 'userController',
    function: 'addUser',
    body: req.body
  });

  try {
    const user = await User.create(req.body);
    logger.info('Usuário adicionado com sucesso', {
      service: 'userController',
      function: 'addUser',
      user
    });
    res.status(201).json(user);
  } catch (error) {
    logger.error('Erro ao adicionar usuário', {
      service: 'userController',
      function: 'addUser',
      error: error.message
    });
    res.status(500).json({ message: error.message });
  }
};

const getUsers = async (req, res) => {
  logger.info('Requisição para obter usuários', {
    service: 'userController',
    function: 'getUsers'
  });

  try {
    const usersCollection = await db.collection('usuario').get();
    const users = usersCollection.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    logger.info('Usuários obtidos com sucesso', {
      service: 'userController',
      function: 'getUsers',
      users
    });
    res.status(200).json(users);
  } catch (error) {
    logger.error('Erro ao buscar usuários', {
      service: 'userController',
      function: 'getUsers',
      error: error.message
    });
    res.status(500).json({ message: 'Erro ao buscar usuários', error: error.message });
  }
};

const getUserById = async (req, res) => {
  const userId = req.params.id;
  logger.info('Requisição para obter usuário por ID', {
    service: 'userController',
    function: 'getUserById',
    userId
  });

  try {
    const user = await User.getById(userId);
    logger.info('Dados do usuário encontrados', {
      service: 'userController',
      function: 'getUserById',
      user
    });
    return { status: 201, json: { success: true, message: 'Dados do usuário encontrado:', user } };
  } catch (error) {
    logger.error('Erro ao obter usuário por ID', {
      service: 'userController',
      function: 'getUserById',
      userId,
      error: error.message
    });
    return { status: 500, json: { message: 'Internal server error', error: error.message } };
  }
};

const updateUser = async (req, res) => {
  const userId = req.params.userId;
  const updateData = req.body;

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: "Nenhum dado fornecido para atualizar" });
  }

  logger.info('Requisição para atualizar usuário', {
    service: 'userController',
    function: 'updateUser',
    userId,
    body: req.body
  });

  try {
    const user = await User.update(userId, req.body);
    logger.info('Usuário atualizado com sucesso', {
      service: 'userController',
      function: 'updateUser',
      user
    });
    res.status(200).json(user);
  } catch (error) {
    logger.error('Erro ao atualizar usuário', {
      service: 'userController',
      function: 'updateUser',
      userId,
      error: error.message
    });
    res.status(500).json({ message: error.message });
  }
};

// const upload = multer({
//   storage: multer.memoryStorage(),
//   fileFilter: (req, file, cb) => {
//     const filetypes = /jpeg|jpg|png/;
//     const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
//     const mimetype = filetypes.test(file.mimetype);

//     if (mimetype && extname) {
//       return cb(null, true);
//     } else {
//       cb(new Error('Only images are allowed'));
//     }
//   }
// });

const uploadProfilePicture = async (req, res) => {
  const userId = req.user.uid;
  const file = req.file;

  logger.info('file: ', file);

  if (!file) {
    return res.status(400).json({ message: 'Nenhum arquivo foi enviado.' });
  }

  try {
    // Caminho do arquivo no bucket do Firebase
    const fileName = `fotoDePerfil/${userId}/profile_picture_${Date.now()}.png`;
    const fileRef = storage.file(fileName);

    // Salva o arquivo no bucket do Firebase
    await fileRef.save(file.buffer, {
      contentType: file.mimetype,
      public: true,
    });

    // URL pública do arquivo
    const publicUrl = `https://storage.googleapis.com/${storage.name}/${fileName}`;

    // Atualize o usuário com a URL da foto de perfil
    await User.update(userId, { fotoDoPerfil: publicUrl });

    res.status(200).json({ publicUrl });
  } catch (error) {
    logger.error('Erro ao fazer upload da foto de perfil:', {
      service: 'userController',
      function: 'uploadProfilePicture',
      error: error.message,
    });
    res.status(500).json({ message: error.message });
  }
};

const deleteUser = async (req, res) => {
  const { userId } = req.params;  // Assuming userId is passed as a path parameter
  logger.info('Requisição para deletar usuário', {
    service: 'userController',
    function: 'deleteUser',
    userId
  });

  try {
    await User.delete(userId);
    logger.info('Usuário deletado com sucesso', {
      service: 'userController',
      function: 'deleteUser',
      userId
    });
    res.status(204).end();
  } catch (error) {
    logger.error('Erro ao deletar usuário', {
      service: 'userController',
      function: 'deleteUser',
      userId,
      error: error.message
    });
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  addUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  uploadProfilePicture
};