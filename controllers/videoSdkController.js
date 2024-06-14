// controllers/videoSdkController.js
const axios = require('axios');
const admin = require('firebase-admin');
const { VIDEO_SDK_API_KEY, VIDEO_SDK_SECRET_KEY } = process.env;

exports.getTurnCredentials = async (req, res) => {
    try {
        const response = await axios.post('https://api.videosdk.live/v1/meetings', {}, {
            headers: {
                authorization: `${VIDEO_SDK_API_KEY}:${VIDEO_SDK_SECRET_KEY}`,
            }
        });
        res.status(200).json({ iceServers: response.data.iceServers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get TURN credentials', details: error });
    }
};

exports.startSession = async (req, res) => {
    const userId = req.user.uid;
    try {
        const response = await axios.post('https://api.videosdk.live/v1/meetings', {}, {
            headers: {
                authorization: `Bearer ${VIDEO_SDK_API_KEY}`,
            }
        });

        const meetingId = response.data.meetingId;

        await admin.firestore().collection('sessions').doc(meetingId).set({
            userId,
            meetingId,
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            active: true,
        });
        res.status(200).json({ message: 'Session started', meetingId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start session', details: error });
    }
};

exports.endSession = async (req, res) => {
    const { meetingId } = req.body;
    try {
        await admin.firestore().collection('sessions').doc(meetingId).update({
            endTime: admin.firestore.FieldValue.serverTimestamp(),
            active: false,
        });
        res.status(200).json({ message: 'Session ended' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to end session', details: error });
    }
};

exports.createMeeting = async (req, res) => {
    try {
        const response = await axios.post('https://api.videosdk.live/v1/meetings', {}, {
            headers: {
                authorization: `Bearer ${VIDEO_SDK_API_KEY}`,
            }
        });

        const meetingId = response.data.meetingId;
        res.status(200).json({ meetingId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create meeting', details: error.message });
    }
};
