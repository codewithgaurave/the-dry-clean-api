import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { StorageController } from '../src/storage/storage.controller';
import { StorageService } from '../src/storage/storage.service';
import { ImageValidationService } from '../src/storage/image-validation.service';
import { User } from '../src/database/schemas/user.schema';
import { OrderActorRole } from '../src/orders/order-status.enum';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import sharp from 'sharp';

describe('StorageController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let storageService: StorageService;

  const agentUserId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678903');
  const agentUser = {
    _id: agentUserId,
    phone: '+919876543212',
    name: 'Agent Vikram',
    role: OrderActorRole.AGENT,
    isActive: true,
  };

  let tokenAgent: string;

  beforeAll(async () => {
    const mockUserModel = {
      findById: jest.fn().mockImplementation((id: any) => ({
        exec: jest.fn().mockImplementation(async () => {
          if (id?.toString() === agentUserId.toString()) {
            return agentUser;
          }
          return null;
        }),
      })),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              jwt: {
                secret: 'test-atelier-e2e-storage-secret',
                expiresIn: '15m',
              },
              storage: {
                driver: 'memory', // Use in-memory driver for offline, hermetic e2e tests
                bucket: 'atelier-proofs-private',
                region: 'ap-south-1',
                signedUrlExpirySeconds: 900,
                maxFileSize: 5 * 1024 * 1024,
                minWidth: 800,
                minHeight: 600,
                allowedMimeTypes: ['image/jpeg', 'image/png'],
              },
            }),
          ],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'test-atelier-e2e-storage-secret',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      controllers: [StorageController],
      providers: [
        StorageService,
        ImageValidationService,
        JwtStrategy,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    storageService = moduleFixture.get<StorageService>(StorageService);

    tokenAgent = jwtService.sign({
      sub: agentUserId.toString(),
      phone: agentUser.phone,
      role: agentUser.role,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentication & Access Control', () => {
    it('POST /storage/upload should reject unauthenticated requests with 401', async () => {
      const response = await request(app.getHttpServer()).post('/storage/upload').expect(401);

      expect(response.body).toHaveProperty('statusCode', 401);
    });

    it('GET /storage/signed-url should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer()).get('/storage/signed-url?key=proofs/test.jpg').expect(401);
    });
  });

  describe('Server-Side Image Validation (FR-POD-18 & TASK-034)', () => {
    it('POST /storage/upload should reject when no file is uploaded with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .expect(400);

      expect(response.body.message).toMatch(/file is required/i);
    });

    it('POST /storage/upload should reject non-image file with 400', async () => {
      const textBuffer = Buffer.from('plain text file content');

      const response = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .attach('file', textBuffer, {
          filename: 'document.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(response.body.message).toMatch(/Invalid file type/i);
    });

    it('POST /storage/upload should reject corrupted image with 400', async () => {
      const fakeJpg = Buffer.from('FAKE-JPEG-DATA-123456');

      const response = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .attach('file', fakeJpg, {
          filename: 'corrupted.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(response.body.message).toMatch(/Invalid or corrupted image file/i);
    });

    it('POST /storage/upload should reject low-resolution image (< 800x600) with 400', async () => {
      const lowResBuffer = await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: { r: 200, g: 200, b: 200 },
        },
      })
        .jpeg()
        .toBuffer();

      const response = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .attach('file', lowResBuffer, {
          filename: 'low_res.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(response.body.message).toMatch(/Image resolution is too low/i);
    });

    it('POST /storage/upload should reject oversized image (> 5MB) with 400', async () => {
      const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);

      const response = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .attach('file', oversizedBuffer, {
          filename: 'huge.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(response.body.message).toMatch(/exceeds maximum allowed limit/i);
    });
  });

  describe('Secure Upload & Signed Link Generation (FR-POD-17, FR-POD-18)', () => {
    let uploadedKey: string;

    it('POST /storage/upload should accept valid 800x600 JPEG, strip EXIF, and return signed URL with 15 min expiry', async () => {
      const validJpeg = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 212, g: 175, b: 55 }, // Atelier Gold
        },
      })
        .jpeg()
        .toBuffer();

      const response = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .attach('file', validJpeg, {
          filename: 'garment_proof.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);

      expect(response.body).toHaveProperty('key');
      expect(response.body).toHaveProperty('bucket', 'atelier-proofs-private');
      expect(response.body).toHaveProperty('signedUrl');
      expect(response.body).toHaveProperty('expiresInSeconds', 900); // 15 minutes
      expect(response.body).toHaveProperty('format', 'jpeg');
      expect(response.body).toHaveProperty('width', 800);
      expect(response.body).toHaveProperty('height', 600);
      expect(response.body).toHaveProperty('hasExifStripped', true);

      // Verify signed link contains expected parameters
      expect(response.body.signedUrl).toContain('X-Amz-Expires=900');

      uploadedKey = response.body.key;

      // Verify stored file in storage has EXIF stripped
      const stored = await storageService.getFile(uploadedKey);
      const storedMetadata = await sharp(stored.buffer).metadata();
      expect(storedMetadata.exif).toBeUndefined();
    });

    it('POST /storage/upload should accept valid portrait orientation (600x800)', async () => {
      const portraitJpeg = await sharp({
        create: {
          width: 600,
          height: 800,
          channels: 3,
          background: { r: 26, g: 26, b: 26 },
        },
      })
        .jpeg()
        .toBuffer();

      const response = await request(app.getHttpServer())
        .post('/storage/upload')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .attach('file', portraitJpeg, {
          filename: 'portrait_proof.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);

      expect(response.body.width).toBe(600);
      expect(response.body.height).toBe(800);
      expect(response.body.format).toBe('jpeg');
    });

    it('GET /storage/signed-url should generate a 15-minute signed URL for an existing file', async () => {
      const response = await request(app.getHttpServer())
        .get(`/storage/signed-url?key=${encodeURIComponent(uploadedKey)}`)
        .set('Authorization', `Bearer ${tokenAgent}`)
        .expect(200);

      expect(response.body).toHaveProperty('key', uploadedKey);
      expect(response.body).toHaveProperty('expiresInSeconds', 900);
      expect(response.body).toHaveProperty('signedUrl');
      expect(response.body.signedUrl).toContain('X-Amz-Expires=900');
    });

    it('GET /storage/signed-url should reject empty key with 400', async () => {
      const response = await request(app.getHttpServer())
        .get('/storage/signed-url?key=')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .expect(400);

      expect(response.body.message).toMatch(/Storage key is required/i);
    });

    it('POST /storage/validate should validate image without storing it', async () => {
      const validPng = await sharp({
        create: {
          width: 1200,
          height: 900,
          channels: 4,
          background: { r: 50, g: 50, b: 50, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const response = await request(app.getHttpServer())
        .post('/storage/validate')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .attach('file', validPng, {
          filename: 'test_preview.png',
          contentType: 'image/png',
        })
        .expect(201);

      expect(response.body.valid).toBe(true);
      expect(response.body.format).toBe('png');
      expect(response.body.width).toBe(1200);
      expect(response.body.height).toBe(900);
      expect(response.body.hasExifStripped).toBe(true);
    });
  });
});
