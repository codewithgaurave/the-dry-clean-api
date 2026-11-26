import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxWorkerService } from './outbox-worker.service';
import { OutboxMessage, OutboxStatus } from '../database/schemas/outbox-message.schema';

describe('Outbox Engine Unit Tests', () => {
  let publisher: OutboxPublisherService;
  let worker: OutboxWorkerService;
  let mockOutboxModel: any;

  beforeEach(async () => {
    mockOutboxModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      toObject: () => ({ ...dto }),
    }));

    mockOutboxModel.create = jest.fn().mockImplementation((docs) => {
      return Promise.resolve(docs.map((d: any) => ({ ...d, _id: 'msg_123' })));
    });

    mockOutboxModel.findOneAndUpdate = jest.fn();
    mockOutboxModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxPublisherService,
        OutboxWorkerService,
        {
          provide: getModelToken(OutboxMessage.name),
          useValue: mockOutboxModel,
        },
      ],
    }).compile();

    publisher = module.get<OutboxPublisherService>(OutboxPublisherService);
    worker = module.get<OutboxWorkerService>(OutboxWorkerService);
  });

  describe('OutboxPublisherService', () => {
    it('enqueues outbox message with PENDING status', async () => {
      const mockSession = {} as any;
      const result = await publisher.publish(
        'ORDER_STATUS_CHANGED',
        { orderId: 'TC100', status: 'CONFIRMED' },
        mockSession,
      );

      expect(mockOutboxModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            eventType: 'ORDER_STATUS_CHANGED',
            status: OutboxStatus.PENDING,
            retryCount: 0,
          }),
        ],
        { session: mockSession },
      );
      expect(result._id).toBe('msg_123');
    });
  });

  describe('OutboxWorkerService', () => {
    it('picks up pending outbox record, dispatches to handler, and marks it PROCESSED', async () => {
      const pendingMessage = {
        _id: 'msg_123',
        eventType: 'ORDER_STATUS_CHANGED',
        payload: { orderId: 'TC100', status: 'CONFIRMED' },
        status: OutboxStatus.PROCESSING,
        retryCount: 0,
        maxRetries: 5,
      };

      // First call returns pending message, second call returns null (end of batch)
      mockOutboxModel.findOneAndUpdate
        .mockResolvedValueOnce(pendingMessage)
        .mockResolvedValueOnce(null);

      let dispatchedPayload: any = null;
      worker.registerHandler('ORDER_STATUS_CHANGED', async (payload) => {
        dispatchedPayload = payload;
      });

      const processedCount = await worker.processNextBatch(10);

      expect(processedCount).toBe(1);
      expect(dispatchedPayload).toEqual({ orderId: 'TC100', status: 'CONFIRMED' });
      expect(mockOutboxModel.updateOne).toHaveBeenCalledWith(
        { _id: 'msg_123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: OutboxStatus.PROCESSED,
          }),
        }),
      );
    });

    it('increments retry count and leaves PENDING on transient handler failure', async () => {
      const failingMessage = {
        _id: 'msg_fail_1',
        eventType: 'PAYMENT_CONFIRMED',
        payload: { paymentId: 'PAY_1' },
        status: OutboxStatus.PROCESSING,
        retryCount: 1,
        maxRetries: 5,
      };

      mockOutboxModel.findOneAndUpdate
        .mockResolvedValueOnce(failingMessage)
        .mockResolvedValueOnce(null);

      worker.registerHandler('PAYMENT_CONFIRMED', async () => {
        throw new Error('Push notification gateway connection timeout');
      });

      const processedCount = await worker.processNextBatch(10);

      expect(processedCount).toBe(1);
      expect(mockOutboxModel.updateOne).toHaveBeenCalledWith(
        { _id: 'msg_fail_1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: OutboxStatus.PENDING, // Ready for retry
            retryCount: 2,
            lastError: 'Push notification gateway connection timeout',
          }),
        }),
      );
    });

    it('marks message as FAILED when retry count reaches maxRetries', async () => {
      const exhaustedMessage = {
        _id: 'msg_exhausted',
        eventType: 'PAYMENT_CONFIRMED',
        payload: { paymentId: 'PAY_1' },
        status: OutboxStatus.PROCESSING,
        retryCount: 4,
        maxRetries: 5,
      };

      mockOutboxModel.findOneAndUpdate
        .mockResolvedValueOnce(exhaustedMessage)
        .mockResolvedValueOnce(null);

      worker.registerHandler('PAYMENT_CONFIRMED', async () => {
        throw new Error('Permanent downstream delivery failure');
      });

      await worker.processNextBatch(10);

      expect(mockOutboxModel.updateOne).toHaveBeenCalledWith(
        { _id: 'msg_exhausted' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: OutboxStatus.FAILED,
            retryCount: 5,
            lastError: 'Permanent downstream delivery failure',
          }),
        }),
      );
    });
  });
});
