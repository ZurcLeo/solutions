// controllers/videoSdkController.js
const axios = require('axios');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API_KEY = process.env.VIDEO_SDK_API_KEY;
const SECRET = process.env.VIDEO_SDK_SECRET_KEY;

if (!API_KEY || !SECRET) {
    console.error('Uma ou mais variáveis de ambiente não estão configuradas corretamente.');
    process.exit(1); // Encerra a aplicação se as variáveis não estiverem configuradas
}

const generateToken = (userId) => {
    const payload = {
        apikey: API_KEY,
        permissions: ['allow_join'], 
        version: 2,
    };
    const options = {
        expiresIn: '120m',
        algorithm: 'HS256',
    };
    const token = jwt.sign(payload, SECRET, options);
    return token;
};

function generateVideoSdkToken(userId, roomId = null, participantId = null) {
    const options = { 
      expiresIn: '120m', 
      algorithm: 'HS256' 
    };
  
    const payload = {
      apikey: API_KEY,
      permissions: ['allow_join'], 
      version: 2, 
      roomId: roomId, 
      participantId: participantId, 
      roles: ['rtc'], 
    };
  
    const token = jwt.sign(payload, SECRET, options);
    return token;
  }

exports.getTurnCredentials = async (req, res) => {
    try {
        const token = generateToken();
        const response = await axios.post('https://api.videosdk.live/v2/rooms', {}, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        res.status(200).json({ iceServers: response.data.iceServers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get TURN credentials', details: error });
    }
};

exports.startSession = async (req, res) => {
    const userId = req.user.uid;
    console.log("Received startSession request with userId:", userId);
    try {
        // Extrai roomId e participantId do corpo da requisição se fornecidos
        const { roomId, participantId } = req.body;

        // Gera o token VideoSDK usando a função correta
        const videoSdkToken = generateVideoSdkToken(userId, roomId, participantId);

        // Chama a API VideoSDK para criar uma sala usando o token gerado
        const response = await axios.post('https://api.videosdk.live/v2/rooms', {}, {
            headers: {
                Authorization: `Bearer ${videoSdkToken}`,
            },
        });
        console.log("Video SDK API response:", response.data);

        const newRoomId = response.data.roomId;

        // Salva a sessão no Firestore
        await admin.firestore().collection('sessions').doc(newRoomId).set({
            userId,
            roomId: newRoomId,
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            active: true,
        });
        res.status(200).json({ message: 'Session started', roomId: newRoomId });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ error: 'Failed to start session', details: error.message });
    }
};

exports.endSession = async (req, res) => {
    const { roomId } = req.body;
    console.log("Received endSession request with roomId:", roomId);
    try {
        await admin.firestore().collection('sessions').doc(roomId).update({
            endTime: admin.firestore.FieldValue.serverTimestamp(),
            active: false,
        });
        res.status(200).json({ message: 'Session ended' });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ error: 'Failed to end session', details: error.message });
    }
};

exports.createMeeting = async (req, res) => {
    try {
        const token = generateToken();
        const response = await axios.post('https://api.videosdk.live/v2/rooms', {}, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const roomId = response.data.roomId;
        res.status(200).json({ roomId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create meeting', details: error.message });
    }
};
