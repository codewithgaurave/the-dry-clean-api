import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API Service Metadata & Status' })
  @ApiResponse({ status: 200, description: 'Service metadata' })
  getStatus() {
    return this.appService.getServiceStatus();
  }

  @Get('health/live')
  @ApiOperation({ summary: 'Liveness Probe' })
  @ApiResponse({ status: 200, description: 'Process alive' })
  getLiveness() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get(['health', 'health/ready'])
  @ApiOperation({ summary: 'Database & System Health Check' })
  @ApiResponse({
    status: 200,
    description: 'System & MongoDB health status',
    schema: {
      example: {
        status: 'ok',
        mongo: 'connected',
        latencyMs: 3,
        uptime: 124.5,
        timestamp: '2026-10-31T05:50:00.000Z',
      },
    },
  })
  async getHealth() {
    return this.appService.getHealth();
  }
}
