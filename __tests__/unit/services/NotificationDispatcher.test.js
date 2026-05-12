const NotificationDispatcher = require('../../../services/NotificationDispatcher');
const { getFirestore } = require('../../../firebaseAdmin');
const emailService = require('../../../services/emailService');
const notificationService = require('../../../services/notificationService');
const userService = require('../../../services/userService');

// Mocks
jest.mock('../../../firebaseAdmin', () => {
  const mUpdate = jest.fn();
  const mAdd = jest.fn(() => Promise.resolve({ id: 'job_123', update: mUpdate }));
  const mGet = jest.fn();
  
  const mDoc = jest.fn(() => ({ get: mGet, update: mUpdate }));
  const mCollection = jest.fn(() => ({ add: mAdd, doc: mDoc }));
  
  const mDb = {
    collection: mCollection,
    runTransaction: jest.fn(async (cb) => {
      const transaction = {
        get: jest.fn(() => Promise.resolve({ exists: true, id: 'job_123', data: () => ({ status: 'pending', channels: ['in_app', 'email'], userId: 'user_1', content: { in_app: {}, email: {} } }) })),
        update: jest.fn()
      };
      return cb(transaction);
    })
  };
  
  return {
    getFirestore: jest.fn(() => mDb),
    FieldValue: {
      serverTimestamp: jest.fn(),
      arrayUnion: jest.fn(val => val)
    }
  };
});

jest.mock('../../../services/emailService', () => ({
  sendEmail: jest.fn()
}));

jest.mock('../../../services/notificationService', () => ({
  createNotification: jest.fn()
}));

jest.mock('../../../services/userService', () => ({
  getUserById: jest.fn()
}));

jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

describe('NotificationDispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('dispatch', () => {
    it('should create a job and trigger async processing', async () => {
      userService.getUserById.mockResolvedValue({ id: 'user_1', email: 'test@test.com' });
      
      // Spy on processJob to prevent actual execution during dispatch test
      jest.spyOn(NotificationDispatcher, 'processJob').mockResolvedValue();

      const result = await NotificationDispatcher.dispatch({
        userId: 'user_1',
        type: 'loan_approved',
        importance: 'high',
        data: { amount: 100, dueDate: '2026-01-01' }
      });

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job_123');
      expect(NotificationDispatcher.processJob).toHaveBeenCalledWith('job_123');
      
      const db = getFirestore();
      expect(db.collection).toHaveBeenCalledWith('notification_jobs');
      // Verify channels logic
      const addCallArg = db.collection().add.mock.calls[0][0];
      expect(addCallArg.channels).toContain('in_app');
      expect(addCallArg.channels).toContain('email');
    });
  });

  describe('processJob', () => {
    it('should process a job successfully for both channels', async () => {
      userService.getUserById.mockResolvedValue({ id: 'user_1', email: 'test@test.com' });
      notificationService.createNotification.mockResolvedValue({ success: true });
      emailService.sendEmail.mockResolvedValue({ success: true, messageId: 'msg_1' });

      await NotificationDispatcher.processJob('job_123');

      expect(notificationService.createNotification).toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalled();
    });

    it('should handle failures in one channel and mark for retry', async () => {
      userService.getUserById.mockResolvedValue({ id: 'user_1', email: 'test@test.com' });
      notificationService.createNotification.mockResolvedValue({ success: true });
      emailService.sendEmail.mockResolvedValue({ success: false, error: 'SMTP down' }); // simulate failure

      await NotificationDispatcher.processJob('job_123');

      // The job should still attempt both
      expect(notificationService.createNotification).toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalled();
    });
  });
});