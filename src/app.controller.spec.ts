import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';

describe('AppController', () => {
  let appController: AppController;
  let mockDatabaseService: any;

  beforeEach(async () => {
    mockDatabaseService = {
      checkHealth: jest.fn().mockResolvedValue({
        status: 'ok',
        mongo: 'connected',
        latencyMs: 3,
      }),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('getStatus', () => {
    it('should return service metadata', () => {
      const status = appController.getStatus();
      expect(status.name).toBe('The Dry X Clean Backend API');
      expect(status.status).toBe('operational');
      expect(status.documentation).toBe('/api/docs');
    });
  });

  describe('getHealth', () => {
    it('should return health status ok with mongo connected', async () => {
      const health = await appController.getHealth();
      expect(health.status).toBe('ok');
      expect(health.mongo).toBe('connected');
      expect(typeof health.uptime).toBe('number');
    });
  });
});
