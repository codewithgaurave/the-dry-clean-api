import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ProfileService, UserProfileResponse } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';

/**
 * Customer Profile Controller.
 * Source of truth: PRD.md §6.10, §10; TODO.md TASK-015.
 */
@ApiTags('Profile')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Retrieves profile information for the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'User profile details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getProfile(@CurrentUser() user: UserDocument): Promise<UserProfileResponse> {
    return this.profileService.getProfile(user._id.toString());
  }

  @Patch()
  @ApiOperation({
    summary: 'Update current user profile',
    description: 'Updates personal information (name, email, avatar).',
  })
  @ApiResponse({ status: 200, description: 'Profile updated successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateProfile(
    @CurrentUser() user: UserDocument,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponse> {
    return this.profileService.updateProfile(user._id.toString(), dto);
  }
}
