import User from "../models/User";

const profile = async (req, res, next) => {
    const { userId } = req;
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    try {
      // Tentar obter perfil do usuário
      const user = await User.getById(userId);
      
      // Adicionar dados do usuário à requisição
      req.user = user;
      req.isProfileComplete = true;
      next();
    } catch (error) {
      // Se o erro for específico para usuário não encontrado
      if (error.message === 'Usuário não encontrado.') {
        // Criar um usuário básico apenas com dados de autenticação
        req.isProfileComplete = false;
        req.user = null;
        
        // Permitir que a requisição continue
        next();
      } else {
        // Outros erros de banco de dados
        return res.status(500).json({ error: 'Erro ao buscar perfil do usuário' });
      }
    }
  };

  module.exports = profile;