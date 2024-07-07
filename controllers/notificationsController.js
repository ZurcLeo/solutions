// notificationsController.js
const notificationService = require('../services/notificationService');

exports.getUserNotifications = async (req, res) => {
    try {
      const notifications = await notificationService.getUserNotifications(req.params.userId);
      res.status(200).json(notifications);
    } catch (error) {
      console.error('Error getting user notifications:', error);
      res.status(500).json({ message: 'Error getting user notifications', error: error.message });
    }
  };

  exports.markAsRead = async (req, res) => {
    const { notificationId, type } = req.body;
    const { userId } = req.params; // Obter userId dos parâmetros da URL
  
    console.log(`markAsRead called with userId: ${userId}, notificationId: ${notificationId}, type: ${type}`);
  
    if (!userId || !notificationId || !type) {
      console.error('Missing required fields', { userId, notificationId, type });
      return res.status(400).json({ message: 'Missing required fields' });
    }
  
    try {
      await notificationService.markAsRead(userId, notificationId, type);
      res.status(200).json({ message: 'Notification marked as read' });
    } catch (error) {
      console.error('Error marking notification as read', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  };

exports.createNotification = async (req, res) => {
    try {
      const { userId, type, conteudo } = req.body;
  
      if (!type || !conteudo || (type === 'private' && !userId)) {
        return res.status(400).json({ message: 'Invalid request parameters' });
      }
  
      await notificationService.createNotification({ userId, type, conteudo });
      res.status(201).json({ message: 'Notification created successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  };