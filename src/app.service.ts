import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Injectable()
export class AppService {
  constructor(private readonly databaseService: DatabaseService) {}

  getServiceStatus() {
    return {
      name: 'The Dry X Clean Backend API',
      version: '1.0.0',
      status: 'operational',
      environment: process.env.NODE_ENV || 'development',
      documentation: '/api/docs',
      timestamp: new Date().toISOString(),
    };
  }

  async getHealth() {
    const dbHealth = await this.databaseService.checkHealth();

    return {
      status: dbHealth.status,
      mongo: dbHealth.mongo,
      latencyMs: dbHealth.latencyMs,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      ...(dbHealth.details ? { details: dbHealth.details } : {}),
    };
  }
}
