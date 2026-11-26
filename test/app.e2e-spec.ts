import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';
import { DatabaseService } from './../src/database/database.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DatabaseService,
          useValue: {
            checkHealth: jest.fn().mockResolvedValue({
              status: 'ok',
              mongo: 'connected',
              latencyMs: 2,
            }),
            startSession: jest.fn(),
            withTransaction: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.setGlobalPrefix('v1', {
      exclude: ['health', 'api/docs', 'api/docs-json'],
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    app.useGlobalFilters(new HttpExceptionFilter());

    const swaggerConfig = new DocumentBuilder()
      .setTitle('The Dry X Clean — Premium Garment Care API')
      .setDescription('Enterprise REST API')
      .setVersion('1.0')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/health (GET) returns status: ok and mongo: connected', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.mongo).toBe('connected');
        expect(res.body).toHaveProperty('uptime');
        expect(res.body).toHaveProperty('timestamp');
      });
  });

  it('/v1 (GET) returns operational service metadata', () => {
    return request(app.getHttpServer())
      .get('/v1')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('operational');
        expect(res.body.name).toBe('The Dry X Clean Backend API');
        expect(res.body.documentation).toBe('/api/docs');
      });
  });

  it('/api/docs (GET) serves the OpenAPI Swagger UI', () => {
    return request(app.getHttpServer())
      .get('/api/docs/')
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain('swagger-ui');
      });
  });

  it('/api/docs-json (GET) serves valid OpenAPI specification', () => {
    return request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200)
      .expect((res) => {
        expect(res.body.openapi).toMatch(/^3\./);
        expect(res.body.info.title).toBe('The Dry X Clean — Premium Garment Care API');
      });
  });
});
