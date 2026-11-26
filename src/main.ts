import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Global Prefix for API Versioning (TECH_STACK.md §8.1)
  app.setGlobalPrefix('v1', {
    exclude: ['health', 'api/docs', 'api/docs-json'],
  });

  // Enable CORS
  app.enableCors({
    origin: process.env.CORS_ORIGINS || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global Validation Pipe with Whitelist & Transform enabled (TASK-007 Scope)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Standardized Error Filter (application/problem+json)
  app.useGlobalFilters(new HttpExceptionFilter());

  // OpenAPI 3 Swagger Configuration at /api/docs (TASK-007 Scope)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('The Dry X Clean — Premium Garment Care API')
    .setDescription(
      'Enterprise REST API powering the Customer Mobile App, Agent Interface, and Admin Operations Portal.\n\n' +
        'Business: The Dry X Clean (Shop No. G-246, 40 Foota Road, Molarband Ext. New Delhi-110044 | M.: 9718312383)\n\n' +
        'Source of Truth: PRD.md §10, TECH_STACK.md §4.1 & §8.1.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT Bearer token',
        in: 'header',
      },
      'JWT',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'The Dry X Clean API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
  SwaggerModule.setup('v1/api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 Atelier Backend API running on: http://localhost:${port}/v1`);
  logger.log(`📖 OpenAPI Swagger Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
