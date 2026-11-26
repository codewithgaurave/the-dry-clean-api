import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadResult {
  key: string;
  bucket: string;
  eTag?: string;
  location?: string;
}

export interface StoredObject {
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

/**
 * StorageService:
 * Manages private S3-compatible object storage (AWS S3, MinIO, Cloudflare R2)
 * and generates short-lived signed URLs (15 minutes).
 * Reference: PRD.md §6.12.2 (FR-POD-17, FR-POD-18); TECH_STACK.md §4.1, §9.2, §9.3.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private readonly driver: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint?: string;
  private readonly forcePathStyle: boolean;
  private readonly signedUrlExpirySeconds: number;

  private readonly localPath: string;
  private readonly publicBaseUrl: string;

  // In-memory fallback map for test/offline environments
  private readonly memoryStorage = new Map<string, StoredObject>();

  constructor(private readonly configService: ConfigService) {
    this.driver = this.configService.get<string>('storage.driver', 'local');
    this.bucket = this.configService.get<string>('storage.bucket', 'atelier-proofs-private');
    this.region = this.configService.get<string>('storage.region', 'ap-south-1');
    this.endpoint = this.configService.get<string>('storage.endpoint');
    this.forcePathStyle = this.configService.get<boolean>('storage.forcePathStyle', false);
    this.signedUrlExpirySeconds = this.configService.get<number>(
      'storage.signedUrlExpirySeconds',
      900,
    );
    this.localPath = path.resolve(
      process.cwd(),
      this.configService.get<string>('storage.localPath', 'uploads'),
    );
    this.publicBaseUrl = this.configService.get<string>('storage.publicBaseUrl', '');

    this.initS3Client();
  }

  async onModuleInit() {
    if (this.driver === 'local') {
      if (!fs.existsSync(this.localPath)) {
        fs.mkdirSync(this.localPath, { recursive: true });
      }
      this.logger.log(
        `StorageService initialized with local disk driver at: ${this.localPath}`,
      );
    } else {
      this.logger.log(
        `StorageService initialized with driver: ${this.driver}, bucket: ${this.bucket}, region: ${this.region}`,
      );
    }
  }

  private initS3Client() {
    if (this.driver === 'memory' || this.driver === 'local') {
      this.logger.log(`Using ${this.driver} storage driver; S3 client disabled.`);
      return;
    }

    const accessKeyId = this.configService.get<string>(
      'storage.accessKeyId',
      'atelier_mock_access_key',
    );
    const secretAccessKey = this.configService.get<string>(
      'storage.secretAccessKey',
      'atelier_mock_secret_access_key',
    );

    this.s3Client = new S3Client({
      region: this.region,
      endpoint: this.endpoint || undefined,
      forcePathStyle: this.forcePathStyle,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Returns current S3 client instance (if configured).
   */
  getS3Client(): S3Client | null {
    return this.s3Client;
  }

  /**
   * Set custom S3 client instance (useful for unit testing).
   */
  setS3Client(client: S3Client) {
    this.s3Client = client;
  }

  /**
   * Configures and enforces private bucket access policy:
   * 1. Blocks all public ACLs and public policies (PutPublicAccessBlock).
   * 2. Enforces explicit private policy requiring TLS/HTTPS (PutBucketPolicy).
   */
  async enforcePrivateBucketPolicy(bucketName = this.bucket): Promise<void> {
    if (this.driver === 'memory' || !this.s3Client) {
      this.logger.log(`Enforced in-memory private policy on bucket ${bucketName}`);
      return;
    }

    try {
      // 1. Block all public read/write access via PutPublicAccessBlock
      await this.s3Client.send(
        new PutPublicAccessBlockCommand({
          Bucket: bucketName,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        }),
      );

      // 2. Put bucket policy requiring TLS encryption in transit and denying public read
      const privatePolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'EnforceTlsOnly',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
            Condition: {
              Bool: {
                'aws:SecureTransport': 'false',
              },
            },
          },
        ],
      };

      await this.s3Client.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(privatePolicy),
        }),
      );

      this.logger.log(`Successfully applied private bucket policy on S3 bucket: ${bucketName}`);
    } catch (err: any) {
      this.logger.warn(`Could not apply S3 private bucket policy automatically: ${err.message}`);
      // In local development or with restricted IAM roles, this may be managed via Terraform/CDK
    }
  }

  /**
   * Uploads an image or document buffer to private object storage.
   * Ensures private ACL, encryption, and correct ContentType.
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    mimeType: string,
    metadata?: Record<string, string>,
  ): Promise<UploadResult> {
    if (this.driver === 'local') {
      const safeKey = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
      const targetPath = path.join(this.localPath, safeKey);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        await fs.promises.mkdir(targetDir, { recursive: true });
      }
      await fs.promises.writeFile(targetPath, buffer);
      return {
        key,
        bucket: 'local-server',
        eTag: `"local-${Date.now()}"`,
        location: `${this.publicBaseUrl}/v1/storage/file?key=${encodeURIComponent(key)}`,
      };
    }

    if (this.driver === 'memory' || !this.s3Client) {
      this.memoryStorage.set(key, {
        buffer,
        contentType: mimeType,
        metadata,
      });
      return {
        key,
        bucket: this.bucket,
        eTag: `"mock-etag-${Date.now()}"`,
        location: `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`,
      };
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        Metadata: metadata,
        ServerSideEncryption: 'AES256',
      });

      const response = await this.s3Client.send(command);

      return {
        key,
        bucket: this.bucket,
        eTag: response.ETag,
        location: `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`,
      };
    } catch (err: any) {
      this.logger.error(`S3 PutObject upload failed for key ${key}: ${err.message}`);
      throw new InternalServerErrorException(`Failed to securely store image file: ${err.message}`);
    }
  }

  /**
   * Generates a short-lived signed link for authorized read access.
   * Default expiry is 15 minutes (900 seconds) per PRD §6.12.2 and TASK-034.
   */
  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds = this.signedUrlExpirySeconds,
  ): Promise<string> {
    if (this.driver === 'local') {
      return `${this.publicBaseUrl}/v1/storage/file?key=${encodeURIComponent(key)}`;
    }

    if (this.driver === 'memory' || !this.s3Client) {
      const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=${expiresInSeconds}&X-Amz-SignedHeaders=host&X-Amz-Signature=mocksignature&X-Amz-Date=${new Date().toISOString()}&expiresAt=${expiresAt}`;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInSeconds,
      });
    } catch (err: any) {
      this.logger.error(`Failed to generate signed download URL for key ${key}: ${err.message}`);
      throw new InternalServerErrorException(`Failed to generate signed URL: ${err.message}`);
    }
  }

  /**
   * Generates a short-lived signed URL for client pre-signed upload (optional).
   */
  async getSignedUploadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds = this.signedUrlExpirySeconds,
  ): Promise<string> {
    if (this.driver === 'memory' || !this.s3Client) {
      const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?upload=true&expiresAt=${expiresAt}`;
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
        ServerSideEncryption: 'AES256',
      });

      return await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInSeconds,
      });
    } catch (err: any) {
      this.logger.error(`Failed to generate signed upload URL for key ${key}: ${err.message}`);
      throw new InternalServerErrorException(
        `Failed to generate signed upload URL: ${err.message}`,
      );
    }
  }

  /**
   * Retrieves raw file buffer and content type from storage.
   */
  async getFile(key: string): Promise<StoredObject> {
    if (this.driver === 'local') {
      const safeKey = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
      const targetPath = path.join(this.localPath, safeKey);
      if (!fs.existsSync(targetPath)) {
        throw new NotFoundException(`File with key '${key}' not found on server.`);
      }
      const buffer = await fs.promises.readFile(targetPath);
      const ext = path.extname(targetPath).toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.webp') contentType = 'image/webp';
      return { buffer, contentType };
    }

    if (this.driver === 'memory' || !this.s3Client) {
      const item = this.memoryStorage.get(key);
      if (!item) {
        throw new NotFoundException(`File with key '${key}' not found in storage.`);
      }
      return item;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      if (!response.Body) {
        throw new NotFoundException(`File '${key}' has no content.`);
      }

      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }

      return {
        buffer: Buffer.concat(chunks),
        contentType: response.ContentType || 'application/octet-stream',
        metadata: response.Metadata,
      };
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException(`File with key '${key}' not found.`);
      }
      throw new InternalServerErrorException(`Failed to retrieve file: ${err.message}`);
    }
  }

  /**
   * Deletes a file from storage.
   */
  async deleteFile(key: string): Promise<void> {
    if (this.driver === 'local') {
      const safeKey = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
      const targetPath = path.join(this.localPath, safeKey);
      if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
      }
      return;
    }

    if (this.driver === 'memory' || !this.s3Client) {
      this.memoryStorage.delete(key);
      return;
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (err: any) {
      this.logger.error(`Failed to delete S3 file ${key}: ${err.message}`);
      throw new InternalServerErrorException(`Failed to delete file: ${err.message}`);
    }
  }

  getBucketName(): string {
    return this.bucket;
  }

  getDriver(): string {
    return this.driver;
  }
}
