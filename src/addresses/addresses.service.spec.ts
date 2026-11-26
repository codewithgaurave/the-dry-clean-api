import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { Address } from '../database/schemas/address.schema';

describe('AddressesService', () => {
  let service: AddressesService;
  let addressModel: any;

  const mockUserId = new Types.ObjectId().toString();
  const mockAddressId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();

  const mockAddress = {
    _id: new Types.ObjectId(mockAddressId),
    userId: new Types.ObjectId(mockUserId),
    label: 'Home',
    street: 'Shop No. G-246, 40 Foota Road',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110044',
    isDefault: true,
    save: jest.fn().mockResolvedValue(true),
    deleteOne: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    addressModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        {
          provide: getModelToken(Address.name),
          useValue: addressModel,
        },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  describe('listUserAddresses', () => {
    it('should query strictly for the authenticated user addresses', async () => {
      const mockResult = [mockAddress];
      addressModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockResult),
        }),
      });

      const addresses = await service.listUserAddresses(mockUserId);

      expect(addressModel.find).toHaveBeenCalledWith({
        userId: new Types.ObjectId(mockUserId),
      });
      expect(addresses).toEqual(mockResult);
    });
  });

  describe('createAddress', () => {
    it('should automatically set isDefault: true for first created address', async () => {
      addressModel.countDocuments.mockResolvedValue(0);
      addressModel.create.mockResolvedValue({
        ...mockAddress,
        isDefault: true,
      });

      const result = await service.createAddress(mockUserId, {
        street: '40 Foota Road',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110044',
        isDefault: false, // User didn't specify default, but it's their first
      });

      expect(addressModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isDefault: true,
        }),
      );
      expect(result.isDefault).toBe(true);
    });

    it('should reset previous default addresses when new default is added', async () => {
      addressModel.countDocuments.mockResolvedValue(2);
      addressModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      addressModel.create.mockResolvedValue({
        ...mockAddress,
        label: 'Office',
        isDefault: true,
      });

      await service.createAddress(mockUserId, {
        label: 'Office',
        street: 'Connaught Place',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001',
        isDefault: true,
      });

      expect(addressModel.updateMany).toHaveBeenCalledWith(
        { userId: new Types.ObjectId(mockUserId), isDefault: true },
        { $set: { isDefault: false } },
      );
    });
  });

  describe('updateAddress', () => {
    it('should throw BadRequestException if addressId is invalid ObjectId', async () => {
      await expect(
        service.updateAddress(mockUserId, 'invalid-id', { street: 'New St' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if address belongs to another user (IDOR protection)', async () => {
      addressModel.findOne.mockResolvedValue(null);

      await expect(
        service.updateAddress(otherUserId, mockAddressId, { street: 'New St' }),
      ).rejects.toThrow(NotFoundException);

      expect(addressModel.findOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(mockAddressId),
        userId: new Types.ObjectId(otherUserId),
      });
    });

    it('should update address and handle isDefault promotion atomically', async () => {
      const existingAddress = {
        ...mockAddress,
        isDefault: false,
        save: jest.fn().mockResolvedValue(true),
      };

      addressModel.findOne.mockResolvedValue(existingAddress);
      addressModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

      const updated = await service.updateAddress(mockUserId, mockAddressId, {
        isDefault: true,
        street: 'Updated Street',
      });

      expect(addressModel.updateMany).toHaveBeenCalledWith(
        {
          userId: new Types.ObjectId(mockUserId),
          _id: { $ne: existingAddress._id },
          isDefault: true,
        },
        { $set: { isDefault: false } },
      );
      expect(existingAddress.save).toHaveBeenCalled();
      expect(updated.street).toBe('Updated Street');
    });
  });

  describe('deleteAddress', () => {
    it('should delete address and promote remaining address to default if deleted was default', async () => {
      const addressToDelete = {
        ...mockAddress,
        isDefault: true,
        deleteOne: jest.fn().mockResolvedValue(true),
      };

      const remainingAddress = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(mockUserId),
        isDefault: false,
        save: jest.fn().mockResolvedValue(true),
      };

      addressModel.findOne
        .mockResolvedValueOnce(addressToDelete) // first call: find address to delete
        .mockReturnValueOnce({
          sort: jest.fn().mockResolvedValue(remainingAddress), // second call: find remaining
        });

      const res = await service.deleteAddress(mockUserId, mockAddressId);

      expect(addressToDelete.deleteOne).toHaveBeenCalled();
      expect(remainingAddress.isDefault).toBe(true);
      expect(remainingAddress.save).toHaveBeenCalled();
      expect(res.success).toBe(true);
    });

    it('should throw NotFoundException if address does not exist or belongs to another user', async () => {
      addressModel.findOne.mockResolvedValue(null);

      await expect(service.deleteAddress(mockUserId, mockAddressId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
