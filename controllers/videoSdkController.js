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

const generateVideoSdkToken = (roomId = null, participantId = null) => {
    const payload = {
        apikey: API_KEY,
        permissions: ["allow_join", "allow_mod"],
        version: 2,
        roles: ["rtc"],
        roomId,
        participantId
    };

    const options = { expiresIn: "120m", algorithm: "HS256" };
    return jwt.sign(payload, SECRET, options);
};

exports.getToken = (req, res) => {
    const { roomId, peerId } = req.body;
    const token = generateVideoSdkToken(roomId, peerId);
    res.json({ token });
};

exports.createMeeting = (req, res) => {
    const { token, region } = req.body;
    const url = `${process.env.VIDEOSDK_API_ENDPOINT}/rooms`;
    const options = {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: { region },
    };

    axios(url, options)
        .then((response) => res.json(response.data))
        .catch((error) => {
            console.error("error", error);
            res.status(500).json({ error: "Failed to create meeting" });
        });
};

exports.validateMeeting = (req, res) => {
    const token = req.body.token;
    const meetingId = req.params.meetingId;

    const url = `${process.env.VIDEOSDK_API_ENDPOINT}/rooms/validate/${meetingId}`;
    const options = {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    };

    axios(url, options)
        .then((response) => res.json(response.data))
        .catch((error) => {
            console.error("error", error);
            res.status(500).json({ error: "Failed to validate meeting" });
        });
};

exports.startSession = async (req, res) => {
    const userId = req.user.uid;
    const { roomId, participantId } = req.body;

    const token = generateVideoSdkToken(roomId, participantId);

    const url = `${process.env.VIDEOSDK_API_ENDPOINT}/rooms`;
    const options = {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    };

    try {
        const response = await axios(url, options);
        const result = response.data;

        const newRoomId = result.roomId;

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
