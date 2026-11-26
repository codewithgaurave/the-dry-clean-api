import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { NotificationsService, PaginatedNotificationsResult } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';

/**
 * NotificationsController:
 * REST API for customer in-app notifications and push token registration.
 * Source of truth: PRD.md §6.9 (FR-NTF-1, FR-NTF-2), §6.12.3; TECH_STACK.md §4.1; TODO.md TASK-044.
 */
@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get customer in-app notifications',
    description:
      'Retrieves chronological notification feed for authenticated user with unread badge counter.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notifications retrieved successfully.',
  })
  async listNotifications(
    @CurrentUser() user: UserDocument,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResult> {
    return this.notificationsService.getUserNotifications(user._id, query);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark single notification as read',
    description: 'Updates notification state to READ. Enforces customer tenancy.',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification MongoDB ObjectId',
    example: '6724dc528c12a819c4705678',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification marked as read.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification not found or unauthorized.',
  })
  async markAsRead(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.notificationsService.markAsRead(user._id, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark all notifications as read',
    description: 'Clears unread counter for authenticated customer.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All notifications marked as read.',
  })
  async markAllAsRead(@CurrentUser() user: UserDocument) {
    return this.notificationsService.markAllAsRead(user._id);
  }

  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register FCM device token for push notifications',
    description:
      'Registers or refreshes Firebase Cloud Messaging device token to receive real-time push alerts.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'FCM device token registered successfully.',
  })
  async registerDeviceToken(
    @CurrentUser() user: UserDocument,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notificationsService.registerDeviceToken(user._id, dto);
  }
}
