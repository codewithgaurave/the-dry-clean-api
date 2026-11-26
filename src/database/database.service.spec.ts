import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let mockConnection: any;
  let mockSession: any;

  beforeEach(async () => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
      inTransaction: jest.fn().mockReturnValue(true),
    };

    mockConnection = {
      readyState: 1,
      db: {
        admin: () => ({
          ping: jest.fn().mockResolvedValue({ ok: 1 }),
        }),
      },
      startSession: jest.fn().mockResolvedValue(mockSession),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
  });

  describe('checkHealth', () => {
    it('should return connected status with latency when ping succeeds', async () => {
      const health = await service.checkHealth();
      expect(health.status).toBe('ok');
      expect(health.mongo).toBe('connected');
      expect(typeof health.latencyMs).toBe('number');
    });

    it('should return disconnected when readyState is not 1', async () => {
      mockConnection.readyState = 0; // disconnected
      const health = await service.checkHealth();
      expect(health.status).toBe('error');
      expect(health.mongo).toBe('disconnected');
    });

    it('should return error when admin ping fails', async () => {
      mockConnection.db = {
        admin: () => ({
          ping: jest.fn().mockRejectedValue(new Error('Connection timed out')),
        }),
      };

      const health = await service.checkHealth();
      expect(health.status).toBe('error');
      expect(health.mongo).toBe('disconnected');
      expect(health.details).toContain('Connection timed out');
    });
  });

  describe('withTransaction', () => {
    it('should commit multi-document transaction and return result', async () => {
      const result = await service.withTransaction(async (session) => {
        expect(session).toBe(mockSession);
        return { modifiedCount: 2, orderId: 'TC123' };
      });

      expect(mockSession.startTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(result).toEqual({ modifiedCount: 2, orderId: 'TC123' });
    });

    it('should abort transaction when operation fails', async () => {
      await expect(
        service.withTransaction(async () => {
          throw new Error('Database write error');
        }),
      ).rejects.toThrow('Database write error');

      expect(mockSession.startTransaction).toHaveBeenCalled();
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });
  });
});
