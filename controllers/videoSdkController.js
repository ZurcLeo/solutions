// controllers/videoSdkController.js
const axios = require('axios');
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
    const { userId, meetingId } = req.body;
    try {
        await db.collection('sessions').doc(meetingId).set({
            userId,
            meetingId,
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            active: true,
        });
        res.status(200).json({ message: 'Session started' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start session', details: error });
    }
};

exports.endSession = async (req, res) => {
    const { meetingId } = req.body;
    try {
        await db.collection('sessions').doc(meetingId).update({
            endTime: admin.firestore.FieldValue.serverTimestamp(),
            active: false,
        });
        res.status(200).json({ message: 'Session ended' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to end session', details: error });
    }
};