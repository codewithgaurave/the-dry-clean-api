import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { ImageValidationService, ValidatedImage } from './image-validation.service';
import { UserDocument } from '../database/schemas/user.schema';

describe('StorageController', () => {
  let controller: StorageController;
  let mockStorageService: Partial<StorageService>;
  let mockImageValidationService: Partial<ImageValidationService>;

  const mockUser = {
    id: 'user-agent-123',
    _id: 'user-agent-123',
    phone: '+919876543210',
    role: 'AGENT',
  } as unknown as UserDocument;

  beforeEach(async () => {
    mockStorageService = {
      uploadFile: jest.fn().mockResolvedValue({
        key: 'proofs/user-agent-123/mock-key.jpg',
        bucket: 'atelier-proofs-private',
      }),
      getSignedDownloadUrl: jest
        .fn()
        .mockResolvedValue(
          'https://atelier-proofs-private.s3.ap-south-1.amazonaws.com/proofs/user-agent-123/mock-key.jpg?expires=900',
        ),
      getBucketName: jest.fn().mockReturnValue('atelier-proofs-private'),
    };

    mockImageValidationService = {
      validateAndSanitize: jest.fn().mockResolvedValue({
        buffer: Buffer.from('sanitized-buffer'),
        format: 'jpeg',
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        originalSize: 1024,
        sanitizedSize: 800,
        hasExifStripped: true,
      } as ValidatedImage),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: ImageValidationService,
          useValue: mockImageValidationService,
        },
      ],
    }).compile();

    controller = module.get<StorageController>(StorageController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('uploadFile', () => {
    it('should throw BadRequestException if no file is provided', async () => {
      await expect(controller.uploadFile(undefined as any, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should validate, upload, and return signed URL with 15 min expiry', async () => {
      const mockMulterFile = {
        buffer: Buffer.from('test-image'),
        mimetype: 'image/jpeg',
        size: 1024,
        originalname: 'photo.jpg',
      } as Express.Multer.File;

      const result = await controller.uploadFile(mockMulterFile, mockUser);

      expect(mockImageValidationService.validateAndSanitize).toHaveBeenCalledWith(mockMulterFile);
      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^proofs\/user-agent-123\/\d+-[a-f0-9-]+\.jpeg$/),
        expect.any(Buffer),
        'image/jpeg',
        expect.objectContaining({ uploadedBy: 'user-agent-123' }),
      );
      expect(mockStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^proofs\/user-agent-123\/\d+-[a-f0-9-]+\.jpeg$/),
        900,
      );

      expect(result.bucket).toBe('atelier-proofs-private');
      expect(result.expiresInSeconds).toBe(900);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.format).toBe('jpeg');
      expect(result.hasExifStripped).toBe(true);
      expect(result.signedUrl).toContain('expires=900');
    });
  });

  describe('getSignedUrl', () => {
    it('should throw BadRequestException if key is missing or empty', async () => {
      await expect(controller.getSignedUrl('')).rejects.toThrow(BadRequestException);
      await expect(controller.getSignedUrl('   ')).rejects.toThrow(BadRequestException);
    });

    it('should return signed URL for provided key', async () => {
      const result = await controller.getSignedUrl('proofs/task-1/photo.jpg');

      expect(mockStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        'proofs/task-1/photo.jpg',
        900,
      );
      expect(result.key).toBe('proofs/task-1/photo.jpg');
      expect(result.expiresInSeconds).toBe(900);
      expect(result.signedUrl).toBeDefined();
    });
  });

  describe('validateOnly', () => {
    it('should validate file without uploading', async () => {
      const mockMulterFile = {
        buffer: Buffer.from('test-image'),
        mimetype: 'image/jpeg',
        size: 1024,
      } as Express.Multer.File;

      const result = await controller.validateOnly(mockMulterFile);

      expect(result.valid).toBe(true);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(mockStorageService.uploadFile).not.toHaveBeenCalled();
    });
  });
});
