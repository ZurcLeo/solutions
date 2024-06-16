const axios = require('axios');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API_KEY = process.env.VIDEO_SDK_API_KEY;
let SECRET = process.env.VIDEO_SDK_SECRET_KEY;
const ENDPOINT = process.env.VIDEO_SDK_API_ENDPOINT;

// Decodifica a chave secreta Base64, se necessário
try {
    SECRET = Buffer.from(SECRET, 'base64').toString('utf8');
} catch (error) {
    console.error('Erro ao decodificar a chave secreta:', error.message);
}

if (!API_KEY || !SECRET || !ENDPOINT) {
    console.error('Uma ou mais variáveis de ambiente não estão configuradas corretamente.');
    process.exit(1);
}

const generateVideoSdkToken = () => {
    const options = { expiresIn: "120m", algorithm: "RS256" };
   
    const payload = {
        apikey: API_KEY,
        permissions: ["allow_mod"],
        version: 2,
        roles: ['crawler']
    };

    return jwt.sign(payload, SECRET, options);
};

exports.getToken = (req, res) => {
    const token = generateVideoSdkToken();
    res.json({ token });
};

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

exports.validateMeeting = async (req, res) => {
    const token = req.body.token;
    const meetingId = req.params.meetingId;

    const url = `${ENDPOINT}/v2/rooms/validate/${meetingId}`;

    const options = {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
    };

    try {
        const response = await axios(url, options);
        res.json(response.data);
    } catch (error) {
        console.error("error", error);
        res.status(500).json({ error: error.message });
    }
};

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
