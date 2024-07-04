const ActiveConnection = require('../models/ActiveConnection');
const InactiveConnection = require('../models/InactiveConnection');
const RequestedConnection = require('../models/RequestedConnection');
const connectionService = require('../services/connectionService')

exports.getActiveConnectionById = async (req, res) => {
  try {
    const connection = await ActiveConnection.getById(req.params.id);
    res.status(200).json(connection);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.getConnectionsByUserId = async (req, res) => {
  const { userId } = req.params;

  try {
    const { friends, bestFriends } = await connectionService.getConnectionsByUserId(userId);
    res.status(200).json({ friends, bestFriends });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createActiveConnection = async (req, res) => {
  try {
    const connection = await ActiveConnection.create(req.body);
    res.status(201).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateActiveConnection = async (req, res) => {
  try {
    const connection = await ActiveConnection.update(req.params.id, req.body);
    res.status(200).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteActiveConnection = async (req, res) => {
  try {
    await ActiveConnection.delete(req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getInactiveConnectionById = async (req, res) => {
  try {
    const connection = await InactiveConnection.getById(req.params.id);
    res.status(200).json(connection);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.createInactiveConnection = async (req, res) => {
  try {
    const connection = await InactiveConnection.create(req.body);
    res.status(201).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateInactiveConnection = async (req, res) => {
  try {
    const connection = await InactiveConnection.update(req.params.id, req.body);
    res.status(200).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteInactiveConnection = async (req, res) => {
  try {
    await InactiveConnection.delete(req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRequestedConnectionById = async (req, res) => {
  try {
    const connection = await RequestedConnection.getById(req.params.id);
    res.status(200).json(connection);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.createRequestedConnection = async (req, res) => {
  try {
    const connection = await RequestedConnection.create(req.body);
    res.status(201).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateRequestedConnection = async (req, res) => {
  try {
    const connection = await RequestedConnection.update(req.params.id, req.body);
    res.status(200).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteRequestedConnection = async (req, res) => {
  try {
    await RequestedConnection.delete(req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
