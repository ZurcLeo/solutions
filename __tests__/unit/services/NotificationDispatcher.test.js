const emailService = require('../../../services/emailService');
const notificationService = require('../../../services/notificationService');
const userService = require('../../../services/userService');

// ── Mocks ────────────────────────────────────────────────────────────────────

// Supabase mock — dispatch cria job via insert().select().single()
const mockSingle = jest.fn().mockResolvedValue({ data: { id: 'job_123' }, error: null });
const mockSelect = jest.fn(() => ({ single: mockSingle }));
const mockInsert = jest.fn(() => ({ select: mockSelect }));
const mockEq    = jest.fn().mockReturnThis();
const mockIn    = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockResolvedValue({ data: [], error: null });
const mockFrom  = jest.fn(() => ({
  insert: mockInsert,
  select: jest.fn().mockReturnThis(),
  eq: mockEq,
  limit: mockLimit,
  update: jest.fn(() => ({ in: mockIn, eq: mockEq, select: mockSelect })),
}));

jest.mock('../../../config/supabase', () => ({
  getSupabaseClient: jest.fn(() => ({ from: mockFrom })),
}));

jest.mock('../../../services/emailService', () => ({
  sendEmail: jest.fn(),
}));

jest.mock('../../../services/notificationService', () => ({
  createNotification: jest.fn(),
}));

jest.mock('../../../services/userService', () => ({
  getUserById: jest.fn(),
}));

jest.mock('../../../services/userPreferencesService', () => ({
  canSend: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../services/pushService', () => ({
  sendToUser: jest.fn().mockResolvedValue({ success: true, sent: 0 }),
}));

jest.mock('../../../services/webhookOutboundService', () => ({
  getActiveSubscription: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// Require AFTER mocks
const NotificationDispatcher = require('../../../services/NotificationDispatcher');

describe('NotificationDispatcher', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    // Reset default Supabase insert response
    mockSingle.mockResolvedValue({ data: { id: 'job_123' }, error: null });
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
        data: { amount: 100, dueDate: '2026-01-01' },
      });

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job_123');
      expect(NotificationDispatcher.processJob).toHaveBeenCalledWith(
        'job_123',
        expect.objectContaining({ id: 'job_123', userId: 'user_1' })
      );

      // Verify Supabase insert was called on notification_jobs
      expect(mockFrom).toHaveBeenCalledWith('notification_jobs');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user_1',
          type: 'loan_approved',
          importance: 'high',
          status: 'pending',
        })
      );
    });
  });

  describe('processJob', () => {
    const makeJobPayload = (overrides = {}) => ({
      id: 'job_123',
      userId: 'user_1',
      type: 'loan_approved',
      channels: ['in_app', 'email'],
      content: {
        in_app: { title: 'Empréstimo aprovado', message: 'Seu empréstimo foi aprovado.' },
        email: { subject: 'Empréstimo aprovado', templateType: 'loan_approved', data: {} },
      },
      metadata: {},
      ...overrides,
    });

    it('should process a job successfully for both channels', async () => {
      userService.getUserById.mockResolvedValue({ id: 'user_1', email: 'test@test.com' });
      notificationService.createNotification.mockResolvedValue({ success: true });
      emailService.sendEmail.mockResolvedValue({ success: true, messageId: 'msg_1' });

      // Passa cachedJob diretamente (Supabase-primary arch)
      await NotificationDispatcher.processJob('job_123', makeJobPayload());

      expect(notificationService.createNotification).toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalled();
    });

    it('should handle failures in one channel and mark for retry', async () => {
      userService.getUserById.mockResolvedValue({ id: 'user_1', email: 'test@test.com' });
      notificationService.createNotification.mockResolvedValue({ success: true });
      emailService.sendEmail.mockResolvedValue({ success: false, error: 'SMTP down' });

      await NotificationDispatcher.processJob('job_123', makeJobPayload());

      // The job should still attempt both
      expect(notificationService.createNotification).toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalled();
    });
  });
});
