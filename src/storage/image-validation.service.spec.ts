import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { ImageValidationService } from './image-validation.service';

describe('ImageValidationService', () => {
  let service: ImageValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageValidationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: any) => {
              if (key === 'storage.maxFileSize') return 5 * 1024 * 1024;
              if (key === 'storage.minWidth') return 800;
              if (key === 'storage.minHeight') return 600;
              if (key === 'storage.allowedMimeTypes') return ['image/jpeg', 'image/png'];
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ImageValidationService>(ImageValidationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateAndSanitize', () => {
    it('should validate and sanitize a valid 800x600 JPEG image', async () => {
      // Create an 800x600 JPEG with sharp
      const jpegBuffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 212, g: 175, b: 55 }, // Atelier gold
        },
      })
        .jpeg()
        .toBuffer();

      const result = await service.validateAndSanitize({
        buffer: jpegBuffer,
        mimetype: 'image/jpeg',
        size: jpegBuffer.length,
        originalname: 'proof.jpg',
      });

      expect(result).toBeDefined();
      expect(result.format).toBe('jpeg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.hasExifStripped).toBe(true);
      expect(result.buffer).toBeInstanceOf(Buffer);

      // Verify stripped EXIF
      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.exif).toBeUndefined();
    });

    it('should validate a valid 800x600 PNG image', async () => {
      const pngBuffer = await sharp({
        create: {
          width: 1000,
          height: 800,
          channels: 4,
          background: { r: 26, g: 26, b: 26, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.validateAndSanitize({
        buffer: pngBuffer,
        mimetype: 'image/png',
        size: pngBuffer.length,
        originalname: 'garment.png',
      });

      expect(result.format).toBe('png');
      expect(result.mimeType).toBe('image/png');
      expect(result.width).toBe(1000);
      expect(result.height).toBe(800);
      expect(result.hasExifStripped).toBe(true);
    });

    it('should accept valid portrait orientation (600x800)', async () => {
      const portraitBuffer = await sharp({
        create: {
          width: 600,
          height: 800,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await service.validateAndSanitize({
        buffer: portraitBuffer,
        mimetype: 'image/jpeg',
        size: portraitBuffer.length,
      });

      expect(result.width).toBe(600);
      expect(result.height).toBe(800);
      expect(result.format).toBe('jpeg');
    });

    it('should throw BadRequestException if file is missing or empty', async () => {
      await expect(service.validateAndSanitize()).rejects.toThrow(BadRequestException);
      await expect(service.validateAndSanitize({ buffer: Buffer.alloc(0) })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if file size exceeds 5MB', async () => {
      const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024); // 5MB + 1KB
      await expect(
        service.validateAndSanitize({
          buffer: largeBuffer,
          mimetype: 'image/jpeg',
          size: largeBuffer.length,
        }),
      ).rejects.toThrow(/exceeds maximum allowed limit/);
    });

    it('should throw BadRequestException if declared mimetype is not JPEG or PNG', async () => {
      const textBuffer = Buffer.from('hello world not an image');
      await expect(
        service.validateAndSanitize({
          buffer: textBuffer,
          mimetype: 'application/pdf',
          size: textBuffer.length,
        }),
      ).rejects.toThrow(/Invalid file type/);
    });

    it('should throw BadRequestException if file is corrupt or not an image', async () => {
      const corruptedBuffer = Buffer.from('this is definitely not a real jpeg file');
      await expect(
        service.validateAndSanitize({
          buffer: corruptedBuffer,
          mimetype: 'image/jpeg',
          size: corruptedBuffer.length,
        }),
      ).rejects.toThrow(/Invalid or corrupted image file/);
    });

    it('should throw BadRequestException if resolution is too low (< 800x600 in landscape and < 600x800 in portrait)', async () => {
      const lowResBuffer = await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: { r: 100, g: 100, b: 100 },
        },
      })
        .jpeg()
        .toBuffer();

      await expect(
        service.validateAndSanitize({
          buffer: lowResBuffer,
          mimetype: 'image/jpeg',
          size: lowResBuffer.length,
        }),
      ).rejects.toThrow(/Image resolution is too low/);
    });

    it('should throw BadRequestException if format is unsupported (e.g. webp)', async () => {
      const webpBuffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 0, g: 255, b: 0 },
        },
      })
        .webp()
        .toBuffer();

      await expect(
        service.validateAndSanitize({
          buffer: webpBuffer,
          // Undeclared mime or bypassing client mime
          size: webpBuffer.length,
        }),
      ).rejects.toThrow(/Unsupported image format/);
    });
  });
});
