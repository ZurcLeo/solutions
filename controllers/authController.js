const { getFacebookUserData, getFacebookFriends } = require('../services/facebookService');
const admin = require('firebase-admin');

exports.facebookLogin = async (req, res) => {
    const { accessToken } = req.body;

    try {
        const userData = await getFacebookUserData(accessToken);

        // Você pode salvar o usuário no seu banco de dados aqui
        res.status(200).json(userData);
    } catch (error) {
        console.error('Erro ao autenticar com Facebook:', error);
        res.status(500).json({ message: 'Erro ao autenticar com Facebook' });
    }
};

exports.getFacebookFriends = async (req, res) => {
    const { accessToken } = req.query;

    try {
        const friendsData = await getFacebookFriends(accessToken);
        res.status(200).json(friendsData);
    } catch (error) {
        console.error('Erro ao obter amigos do Facebook:', error);
        res.status(500).json({ message: 'Erro ao obter amigos do Facebook' });
    }
};
