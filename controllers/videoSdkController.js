/**
 * @fileoverview Controller de videoconferência - integração com VideoSDK para chamadas de vídeo
 * @module controllers/videoSdkController
 */

const axios = require('axios');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API_KEY = process.env.VIDEO_SDK_API_KEY;
const SECRET = process.env.VIDEO_SDK_SECRET_KEY;
const ENDPOINT = process.env.VIDEO_SDK_API_ENDPOINT;

if (!API_KEY || !SECRET || !ENDPOINT) {
    console.error('Uma ou mais variáveis de ambiente não estão configuradas corretamente.');
    process.exit(1);
}

/**
 * Gera token JWT para autenticação no VideoSDK
 * @function generateVideoSdkToken
 * @returns {string} Token JWT válido por 120 minutos
 */
const generateVideoSdkToken = () => {
    const options = { 
        expiresIn: "120m", 
        algorithm: "HS256" 
    };
    const payload = {
        apikey: API_KEY,
        permissions: ["allow_join"]
    };
    
    const token = jwt.sign(payload, SECRET, options);
    
    return token;
};

/**
 * Retorna token de autenticação para o VideoSDK
 * @function getToken
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} res - Objeto de resposta Express
 * @returns {Object} Token de autenticação
 */
exports.getToken = (req, res) => {
    const token = generateVideoSdkToken();
    res.json({ token });
};

/**
 * Cria uma nova sala de videoconferência
 * @async
 * @function createMeeting
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados da reunião
 * @param {string} req.body.token - Token de autenticação
 * @param {string} req.body.region - Região do servidor
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados da sala criada
 */
exports.createMeeting = async (req, res) => {
    const { token, region } = req.body;
    const url = `${ENDPOINT}/v2/rooms`;
    const options = {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: JSON.stringify({ region })
    };

    try {
        const response = await axios(url, options);
        res.json(response.data);
    } catch (error) {
        console.error("API Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Valida se uma sala de videoconferência existe e está ativa
 * @async
 * @function validateMeeting
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.meetingId - ID da reunião
 * @param {Object} req.body - Dados da validação
 * @param {string} req.body.token - Token de autenticação
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Status da validação
 */
exports.validateMeeting = async (req, res) => {
    const token = req.body.token;
    const meetingId = req.params.meetingId;

    const url = `${ENDPOINT}/v2/rooms/validate/${meetingId}`;

    const options = {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    };

    try {
        const response = await axios(url, options);
        res.json(response.data);
    } catch (error) {
        console.error("error", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Inicia uma sessão de videoconferência e salva no Firestore
 * @async
 * @function startSession
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.user - Dados do usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} req.body - Dados da sessão
 * @param {string} req.body.roomId - ID da sala
 * @param {string} req.body.participantId - ID do participante
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados da sessão iniciada
 */
exports.startSession = async (req, res) => {
    const userId = req.user.uid;
    const { roomId, participantId } = req.body;

    const token = generateVideoSdkToken();
    const url = `${ENDPOINT}/v2/rooms`;
    const fetchOptions = {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: JSON.stringify({})
    };

    try {
        const response = await axios(url, fetchOptions);
        const result = response.data;

        if (response.status !== 200) {
            throw new Error(result.error || 'Failed to start session');
        }

        const newRoomId = result.roomId;

        await admin.firestore().collection('sessions').doc(newRoomId).set({
            userId,
            roomId: newRoomId,
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            active: true
        });

        res.status(200).json({ message: 'Session started', roomId: newRoomId });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ error: 'Failed to start session', details: error.message });
    }
};

/**
 * Finaliza uma sessão de videoconferência
 * @async
 * @function endSession
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados da sessão
 * @param {string} req.body.roomId - ID da sala a ser finalizada
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Confirmação do encerramento
 */
exports.endSession = async (req, res) => {
    const { roomId } = req.body;

    try {
        await admin.firestore().collection('sessions').doc(roomId).update({
            endTime: admin.firestore.FieldValue.serverTimestamp(),
            active: false
        });

        res.status(200).json({ message: 'Session ended' });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ error: 'Failed to end session', details: error.message });
    }
};