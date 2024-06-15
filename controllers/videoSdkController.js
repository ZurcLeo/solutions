// controllers/videoSdkController.js
const axios = require('axios');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API_KEY = process.env.VIDEO_SDK_API_KEY;
const SECRET = process.env.VIDEO_SDK_SECRET_KEY;

if (!API_KEY || !SECRET) {
    console.error('Uma ou mais variáveis de ambiente não estão configuradas corretamente.');
    process.exit(1); 
}

const generateVideoSdkToken = (userId, roomId = null, participantId = null) => {
    const options = { 
        expiresIn: '120m', 
        algorithm: 'HS256' 
       };
       const payload = {
        apikey: API_KEY,
        permissions: [`allow_join`], // `ask_join` || `allow_mod` 
        version: 2,
        roomId: `2kyv-gzay-64pg`,
        participantId: `lxvdplwt`, 
        roles: ['crawler', 'rtc'], 
       };
       
       const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhcGlrZXkiOiI0ZTgzZWUyNi0zZTc0LTQ1ZTItOGJjZS1mY2VmZDIxMTc2YjciLCJwZXJtaXNzaW9ucyI6WyJhbGxvd19qb2luIl0sImlhdCI6MTcxODQ3MDc4NCwiZXhwIjoxNzE5MDc1NTg0fQ.bY6AaCi-4uUn8HRmBgSapCxY_Mg0ltraNcoex-Cuu48'
       console.log(token);
};

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
        const { roomId, participantId } = req.body;
        const videoSdkToken = generateVideoSdkToken(userId, roomId, participantId);
        const response = await axios.post('https://api.videosdk.live/v2/rooms', {}, {
            headers: {
                Authorization: `Bearer ${videoSdkToken}`,
            },
        });
        console.log("Video SDK API response:", response.data);
        const newRoomId = response.data.roomId;
        await admin.firestore().collection('sessions').doc(newRoomId).set({
            userId,
            roomId: newRoomId,
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            active: true,
        });
        res.status(200).json({ message: 'Session started', roomId: newRoomId });
    } catch (error) {
        console.error('Error starting session:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to start session', details: error.response ? error.response.data : error.message });
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
