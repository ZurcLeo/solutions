// notificationsController.js
const notificationService = require('../services/notificationService');

exports.getUserNotifications = async (req, res) => {
    const { userId } = req.params;
    try {
        const notifications = await notificationService.getUserNotifications(userId);
        res.status(200).json(notifications);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.markAsRead = async (req, res) => {
    const { userId } = req.params;
    const { notificationId, type } = req.body;
    try {
        await notificationService.markAsRead(userId, notificationId, type);
        res.status(200).json({ message: 'Notificação marcada como lida' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};