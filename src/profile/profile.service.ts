import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../database/schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface UserProfileResponse {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  avatar?: string;
  role: string;
  createdAt?: Date;
}

/**
 * Customer Profile Management Service.
 * Source of truth: PRD.md §6.10, §10; TODO.md TASK-015.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Retrieve current authenticated user profile.
   */
  async getProfile(userId: string): Promise<UserProfileResponse> {
    const user = await this.userModel.findById(new Types.ObjectId(userId)).exec();
    if (!user || !user.isActive) {
      throw new NotFoundException('User profile not found.');
    }

    return this.serializeUser(user);
  }

  /**
   * Update authenticated user personal details (name, email, avatar).
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfileResponse> {
    const user = await this.userModel.findById(new Types.ObjectId(userId)).exec();
    if (!user || !user.isActive) {
      throw new NotFoundException('User profile not found.');
    }

    if (dto.name !== undefined) {
      user.name = dto.name.trim();
    }
    if (dto.email !== undefined) {
      user.email = dto.email.trim().toLowerCase();
    }
    if (dto.avatar !== undefined) {
      user.avatar = dto.avatar.trim();
    }

    await user.save();
    this.logger.log(`Updated profile for user: ${userId}`);

    return this.serializeUser(user);
  }

  private serializeUser(user: UserDocument): UserProfileResponse {
    return {
      id: user._id.toString(),
      phone: user.phone,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
