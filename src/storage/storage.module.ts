import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import { ImageValidationService } from './image-validation.service';
import { StorageController } from './storage.controller';

@Module({
  imports: [ConfigModule],
  controllers: [StorageController],
  providers: [StorageService, ImageValidationService],
  exports: [StorageService, ImageValidationService],
})
export class StorageModule {}
