import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from './storage.service';
import { ImageValidationService } from './image-validation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';
import * as crypto from 'crypto';

export interface UploadResponse {
  key: string;
  bucket: string;
  signedUrl: string;
  expiresInSeconds: number;
  format: 'jpeg' | 'png';
  mimeType: string;
  width: number;
  height: number;
  size: number;
  hasExifStripped: boolean;
}

export interface ValidationResponse {
  valid: boolean;
  format: 'jpeg' | 'png';
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  sanitizedSize: number;
  hasExifStripped: boolean;
}

/**
 * StorageController:
 * Secure file upload and signed URL management.
 * Enforces server-side image validation (MIME, 800x600 minimum resolution, 5MB limit, EXIF stripping)
 * and generates short-lived (15-minute) signed links.
 * Reference: PRD.md §6.12.2 (FR-POD-17, FR-POD-18); TECH_STACK.md §4.1, §9.2, §9.3.
 */
@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly imageValidationService: ImageValidationService,
  ) {}

  /**
   * Securely uploads and sanitizes an image to private S3 storage.
   * Rejects invalid, non-image, corrupt, low-resolution, or oversized files with 400 Bad Request.
   */
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UserDocument,
  ): Promise<UploadResponse> {
    if (!file) {
      throw new BadRequestException('A file is required for upload.');
    }

    // Server-side validation with sharp (throws 400 on error)
    const sanitized = await this.imageValidationService.validateAndSanitize(file);

    // Generate secure storage key
    const uniqueId = crypto.randomUUID();
    const timestamp = Date.now();
    const userId = user?.id || user?._id || 'anon';
    const key = `proofs/${userId}/${timestamp}-${uniqueId}.${sanitized.format}`;

    // Upload to private S3 bucket
    await this.storageService.uploadFile(key, sanitized.buffer, sanitized.mimeType, {
      uploadedBy: userId.toString(),
      originalName: file.originalname || 'unknown',
    });

    // Generate 15-minute signed URL
    const expiresInSeconds = 900; // 15 minutes
    const signedUrl = await this.storageService.getSignedDownloadUrl(key, expiresInSeconds);

    return {
      key,
      bucket: this.storageService.getBucketName(),
      signedUrl,
      expiresInSeconds,
      format: sanitized.format,
      mimeType: sanitized.mimeType,
      width: sanitized.width,
      height: sanitized.height,
      size: sanitized.sanitizedSize,
      hasExifStripped: sanitized.hasExifStripped,
    };
  }

  /**
   * Serves files stored locally on the server directly.
   */
  @Get('file')
  async serveFile(@Query('key') key: string, @Res() res: Response) {
    if (!key || key.trim() === '') {
      throw new BadRequestException('Storage key is required.');
    }
    const file = await this.storageService.getFile(key);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(file.buffer);
  }

  /**
   * Generates a short-lived (15 min) signed download URL for an existing storage key.
   */
  @Get('signed-url')
  @UseGuards(JwtAuthGuard)
  async getSignedUrl(
    @Query('key') key: string,
  ): Promise<{ key: string; signedUrl: string; expiresInSeconds: number }> {
    if (!key || key.trim() === '') {
      throw new BadRequestException('Storage key is required.');
    }

    const expiresInSeconds = 900;
    const signedUrl = await this.storageService.getSignedDownloadUrl(key, expiresInSeconds);

    return {
      key,
      signedUrl,
      expiresInSeconds,
    };
  }

  /**
   * Validates an image without storing it (useful for pre-upload validation).
   */
  @Post('validate')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async validateOnly(@UploadedFile() file: Express.Multer.File): Promise<ValidationResponse> {
    if (!file) {
      throw new BadRequestException('A file is required for validation.');
    }

    const sanitized = await this.imageValidationService.validateAndSanitize(file);

    return {
      valid: true,
      format: sanitized.format,
      mimeType: sanitized.mimeType,
      width: sanitized.width,
      height: sanitized.height,
      originalSize: sanitized.originalSize,
      sanitizedSize: sanitized.sanitizedSize,
      hasExifStripped: sanitized.hasExifStripped,
    };
  }
}
