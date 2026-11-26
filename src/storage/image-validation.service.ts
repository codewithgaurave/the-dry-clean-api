import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp, { Metadata } from 'sharp';

export interface ValidatedImage {
  buffer: Buffer;
  format: 'jpeg' | 'png';
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  originalSize: number;
  sanitizedSize: number;
  hasExifStripped: boolean;
}

export interface ImageInputFile {
  buffer: Buffer;
  mimetype?: string;
  size?: number;
  originalname?: string;
}

/**
 * ImageValidationService:
 * Server-side image validation and sanitization using sharp.
 * Enforces MIME type, file size, minimum resolution (800x600), and strips EXIF metadata.
 * Reference: PRD.md §6.12.2 (FR-POD-17, FR-POD-18); TECH_STACK.md §4.1, §9.2, §9.3.
 */
@Injectable()
export class ImageValidationService {
  private readonly logger = new Logger(ImageValidationService.name);
  private readonly maxFileSizeBytes: number;
  private readonly minWidth: number;
  private readonly minHeight: number;
  private readonly allowedMimeTypes: string[];

  constructor(private readonly configService: ConfigService) {
    this.maxFileSizeBytes = this.configService.get<number>('storage.maxFileSize', 5 * 1024 * 1024);
    this.minWidth = this.configService.get<number>('storage.minWidth', 800);
    this.minHeight = this.configService.get<number>('storage.minHeight', 600);
    this.allowedMimeTypes = this.configService.get<string[]>('storage.allowedMimeTypes', [
      'image/jpeg',
      'image/png',
    ]);
  }

  /**
   * Validates and sanitizes an uploaded image file.
   * Throws BadRequestException (400) if validation fails.
   */
  async validateAndSanitize(file?: ImageInputFile): Promise<ValidatedImage> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('A valid image file is required.');
    }

    const actualSize = file.size || file.buffer.length;

    // 1. File size check (5MB limit)
    if (actualSize > this.maxFileSizeBytes) {
      const maxMb = (this.maxFileSizeBytes / (1024 * 1024)).toFixed(1);
      const actualMb = (actualSize / (1024 * 1024)).toFixed(2);
      throw new BadRequestException(
        `File size exceeds maximum allowed limit of ${maxMb}MB (received ${actualMb}MB).`,
      );
    }

    // 2. MIME type whitelist check (declared)
    if (file.mimetype) {
      const normalizedMime = file.mimetype.toLowerCase();
      const isAllowedMime =
        this.allowedMimeTypes.includes(normalizedMime) || normalizedMime === 'image/jpg';
      if (!isAllowedMime) {
        throw new BadRequestException(
          `Invalid file type '${file.mimetype}'. Only JPEG and PNG images are permitted.`,
        );
      }
    }

    // 3. Image parsing and magic byte verification via sharp
    let metadata: Metadata;
    try {
      metadata = await sharp(file.buffer).metadata();
    } catch (err: any) {
      this.logger.warn(`Corrupt image decoding failed: ${err.message}`);
      throw new BadRequestException(
        'Invalid or corrupted image file. Unable to decode image format.',
      );
    }

    // 4. Verify decoded format
    const detectedFormat = metadata.format?.toLowerCase();
    if (detectedFormat !== 'jpeg' && detectedFormat !== 'png') {
      throw new BadRequestException(
        `Unsupported image format '${detectedFormat}'. Only JPEG and PNG images are supported.`,
      );
    }

    // 5. Minimum resolution check (800x600 in landscape or 600x800 in portrait)
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) {
      throw new BadRequestException('Unable to determine image resolution from file metadata.');
    }

    const isLandscapeValid = width >= this.minWidth && height >= this.minHeight;
    const isPortraitValid = width >= this.minHeight && height >= this.minWidth;

    if (!isLandscapeValid && !isPortraitValid) {
      throw new BadRequestException(
        `Image resolution is too low (${width}x${height}). Minimum resolution is ${this.minWidth}x${this.minHeight} (or ${this.minHeight}x${this.minWidth} for portrait).`,
      );
    }

    // 6. Strip EXIF data & re-encode
    // sharp by default strips all EXIF metadata unless .withMetadata() is invoked.
    // .rotate() auto-orients using EXIF orientation before stripping it.
    let sharpInstance = sharp(file.buffer).rotate();

    if (detectedFormat === 'jpeg') {
      sharpInstance = sharpInstance.jpeg({
        quality: 85,
        mozjpeg: true,
      });
    } else {
      sharpInstance = sharpInstance.png({
        compressionLevel: 8,
      });
    }

    const sanitizedBuffer = await sharpInstance.toBuffer();

    // Verify EXIF is completely stripped
    const sanitizedMetadata = await sharp(sanitizedBuffer).metadata();
    const hasExifStripped = !sanitizedMetadata.exif;

    return {
      buffer: sanitizedBuffer,
      format: detectedFormat,
      mimeType: detectedFormat === 'png' ? 'image/png' : 'image/jpeg',
      width: sanitizedMetadata.width || width,
      height: sanitizedMetadata.height || height,
      originalSize: actualSize,
      sanitizedSize: sanitizedBuffer.length,
      hasExifStripped,
    };
  }
}
