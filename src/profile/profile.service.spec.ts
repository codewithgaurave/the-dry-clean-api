import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { User } from '../database/schemas/user.schema';
import { OrderActorRole } from '../orders/order-status.enum';

describe('ProfileService', () => {
  let service: ProfileService;
  let userModel: any;

  const mockUserId = new Types.ObjectId().toString();
  const mockUser = {
    _id: new Types.ObjectId(mockUserId),
    phone: '+919718312383',
    name: 'Aditya Sharma',
    email: 'aditya@example.com',
    role: OrderActorRole.CUSTOMER,
    isActive: true,
    createdAt: new Date(),
    save: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    userModel = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: getModelToken(User.name),
          useValue: userModel,
        },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  describe('getProfile', () => {
    it('should return serialized user profile', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser),
      });

      const profile = await service.getProfile(mockUserId);

      expect(profile.id).toBe(mockUserId);
      expect(profile.phone).toBe('+919718312383');
      expect(profile.name).toBe('Aditya Sharma');
      expect(profile.email).toBe('aditya@example.com');
      expect(profile.role).toBe(OrderActorRole.CUSTOMER);
    });

    it('should throw NotFoundException if user is deactivated or not found', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getProfile(mockUserId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('should update profile name and email, then save', async () => {
      const userToUpdate = {
        ...mockUser,
        name: 'Old Name',
        email: 'old@example.com',
        save: jest.fn().mockResolvedValue(true),
      };

      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(userToUpdate),
      });

      const updated = await service.updateProfile(mockUserId, {
        name: 'New Name',
        email: 'new@example.com',
      });

      expect(userToUpdate.name).toBe('New Name');
      expect(userToUpdate.email).toBe('new@example.com');
      expect(userToUpdate.save).toHaveBeenCalled();
      expect(updated.name).toBe('New Name');
    });
  });
});
