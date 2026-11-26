import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { StorageService } from './storage.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

describe('StorageService', () => {
  let service: StorageService;
  let mockS3Send: jest.Mock;

  const mockConfigService = (driver = 's3') => ({
    get: jest.fn((key: string, defaultValue: any) => {
      const configMap: Record<string, any> = {
        'storage.driver': driver,
        'storage.bucket': 'atelier-proofs-test',
        'storage.region': 'ap-south-1',
        'storage.endpoint': undefined,
        'storage.forcePathStyle': false,
        'storage.accessKeyId': 'test-access-key',
        'storage.secretAccessKey': 'test-secret-key',
        'storage.signedUrlExpirySeconds': 900,
      };
      return configMap[key] ?? defaultValue;
    }),
  });

  beforeEach(async () => {
    mockS3Send = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: mockConfigService('s3'),
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);

    // Mock S3 client send method
    const mockS3Client = {
      send: mockS3Send,
    } as unknown as S3Client;
    service.setS3Client(mockS3Client);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.getBucketName()).toBe('atelier-proofs-test');
  });

  describe('uploadFile', () => {
    it('should upload a buffer to S3 with private configuration and AES256 encryption', async () => {
      mockS3Send.mockResolvedValueOnce({ ETag: '"test-etag-123"' });

      const buffer = Buffer.from('test image payload');
      const result = await service.uploadFile('proofs/order-1/1.jpg', buffer, 'image/jpeg', {
        uploadedBy: 'agent-1',
      });

      expect(result.key).toBe('proofs/order-1/1.jpg');
      expect(result.bucket).toBe('atelier-proofs-test');
      expect(result.eTag).toBe('"test-etag-123"');

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const command = mockS3Send.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Bucket).toBe('atelier-proofs-test');
      expect(command.input.Key).toBe('proofs/order-1/1.jpg');
      expect(command.input.ContentType).toBe('image/jpeg');
      expect(command.input.ServerSideEncryption).toBe('AES256');
      expect(command.input.Metadata).toEqual({ uploadedBy: 'agent-1' });
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('should generate a signed download URL expiring in 15 minutes (900 seconds)', async () => {
      const mockPresignedUrl =
        'https://atelier-proofs-test.s3.ap-south-1.amazonaws.com/proofs/1.jpg?X-Amz-Signature=test';
      (getSignedUrl as jest.Mock).mockResolvedValueOnce(mockPresignedUrl);

      const url = await service.getSignedDownloadUrl('proofs/1.jpg', 900);

      expect(url).toBe(mockPresignedUrl);
      expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.any(GetObjectCommand), {
        expiresIn: 900,
      });
    });
  });

  describe('enforcePrivateBucketPolicy', () => {
    it('should configure PutPublicAccessBlock and PutBucketPolicy to block all public access', async () => {
      mockS3Send.mockResolvedValue({});

      await service.enforcePrivateBucketPolicy('atelier-proofs-test');

      expect(mockS3Send).toHaveBeenCalledTimes(2);

      // Verify PutPublicAccessBlock
      const blockCommand = mockS3Send.mock.calls[0][0];
      expect(blockCommand).toBeInstanceOf(PutPublicAccessBlockCommand);
      expect(blockCommand.input.Bucket).toBe('atelier-proofs-test');
      expect(blockCommand.input.PublicAccessBlockConfiguration.BlockPublicAcls).toBe(true);
      expect(blockCommand.input.PublicAccessBlockConfiguration.BlockPublicPolicy).toBe(true);
      expect(blockCommand.input.PublicAccessBlockConfiguration.IgnorePublicAcls).toBe(true);
      expect(blockCommand.input.PublicAccessBlockConfiguration.RestrictPublicBuckets).toBe(true);

      // Verify PutBucketPolicy
      const policyCommand = mockS3Send.mock.calls[1][0];
      expect(policyCommand).toBeInstanceOf(PutBucketPolicyCommand);
      expect(policyCommand.input.Bucket).toBe('atelier-proofs-test');
      const parsedPolicy = JSON.parse(policyCommand.input.Policy);
      expect(parsedPolicy.Statement[0].Effect).toBe('Deny');
      expect(parsedPolicy.Statement[0].Condition.Bool['aws:SecureTransport']).toBe('false');
    });
  });

  describe('deleteFile', () => {
    it('should delete file from S3 bucket', async () => {
      mockS3Send.mockResolvedValueOnce({});

      await service.deleteFile('proofs/1.jpg');

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const command = mockS3Send.mock.calls[0][0];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input.Key).toBe('proofs/1.jpg');
    });
  });

  describe('Memory storage driver mode', () => {
    let memoryService: StorageService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: mockConfigService('memory'),
          },
        ],
      }).compile();

      memoryService = module.get<StorageService>(StorageService);
    });

    it('should store and retrieve files in memory', async () => {
      const buf = Buffer.from('in-memory file');
      await memoryService.uploadFile('mem/test.png', buf, 'image/png');

      const retrieved = await memoryService.getFile('mem/test.png');
      expect(retrieved.buffer).toEqual(buf);
      expect(retrieved.contentType).toBe('image/png');

      const signedUrl = await memoryService.getSignedDownloadUrl('mem/test.png');
      expect(signedUrl).toContain('mem/test.png');
      expect(signedUrl).toContain('X-Amz-Expires=900');

      await memoryService.deleteFile('mem/test.png');
      await expect(memoryService.getFile('mem/test.png')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Local disk storage driver mode', () => {
    let localService: StorageService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                if (key === 'storage.driver') return 'local';
                if (key === 'storage.localPath') return 'test_uploads';
                if (key === 'storage.publicBaseUrl') return 'http://localhost:3000';
                return defaultValue;
              }),
            },
          },
        ],
      }).compile();

      localService = module.get<StorageService>(StorageService);
      await localService.onModuleInit();
    });

    afterEach(async () => {
      await localService.deleteFile('proofs/sample.jpg');
    });

    it('should store, retrieve and serve files from local disk', async () => {
      const buf = Buffer.from('test local image content');
      const uploadRes = await localService.uploadFile('proofs/sample.jpg', buf, 'image/jpeg');

      expect(uploadRes.key).toBe('proofs/sample.jpg');
      expect(uploadRes.bucket).toBe('local-server');
      expect(uploadRes.location).toContain('/v1/storage/file?key=proofs%2Fsample.jpg');

      const retrieved = await localService.getFile('proofs/sample.jpg');
      expect(retrieved.buffer.toString()).toBe('test local image content');
      expect(retrieved.contentType).toBe('image/jpeg');

      const downloadUrl = await localService.getSignedDownloadUrl('proofs/sample.jpg');
      expect(downloadUrl).toBe('http://localhost:3000/v1/storage/file?key=proofs%2Fsample.jpg');
    });
  });
});
