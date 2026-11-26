import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Address, AddressDocument } from '../database/schemas/address.schema';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/**
 * Address Book Management Service.
 * Enforces strict user ownership and automatic default address designation.
 * Source of truth: PRD.md §6.6, §10; TODO.md TASK-015.
 */
@Injectable()
export class AddressesService {
  private readonly logger = new Logger(AddressesService.name);

  constructor(
    @InjectModel(Address.name)
    private readonly addressModel: Model<AddressDocument>,
  ) {}

  /**
   * List all saved addresses belonging strictly to the authenticated user.
   * Default address appears first, followed by newest additions.
   */
  async listUserAddresses(userId: string): Promise<AddressDocument[]> {
    return this.addressModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ isDefault: -1, createdAt: -1 })
      .exec();
  }

  /**
   * Create a new address for the authenticated user.
   * Automatically sets isDefault: true if this is the user's first address.
   */
  async createAddress(userId: string, dto: CreateAddressDto): Promise<AddressDocument> {
    const userObjectId = new Types.ObjectId(userId);
    const existingCount = await this.addressModel.countDocuments({
      userId: userObjectId,
    });

    const isFirstAddress = existingCount === 0;
    const shouldBeDefault = isFirstAddress || dto.isDefault === true;

    // If this address is designated as default, reset all other addresses for this user
    if (shouldBeDefault && !isFirstAddress) {
      await this.addressModel.updateMany(
        { userId: userObjectId, isDefault: true },
        { $set: { isDefault: false } },
      );
    }

    const newAddress = await this.addressModel.create({
      ...dto,
      userId: userObjectId,
      label: dto.label || 'Home',
      isDefault: shouldBeDefault,
    });

    this.logger.log(
      `Created address ${newAddress._id} for user ${userId} (Default: ${shouldBeDefault})`,
    );

    return newAddress;
  }

  /**
   * Update an existing address belonging to the user.
   * Enforces user ownership and atomic default address rotation.
   */
  async updateAddress(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<AddressDocument> {
    if (!Types.ObjectId.isValid(addressId)) {
      throw new BadRequestException('Invalid address ID format.');
    }

    const userObjectId = new Types.ObjectId(userId);
    const address = await this.addressModel.findOne({
      _id: new Types.ObjectId(addressId),
      userId: userObjectId,
    });

    if (!address) {
      throw new NotFoundException(
        'Address not found or does not belong to the authenticated user.',
      );
    }

    // If updating to default, unset other addresses
    if (dto.isDefault === true && !address.isDefault) {
      await this.addressModel.updateMany(
        { userId: userObjectId, _id: { $ne: address._id }, isDefault: true },
        { $set: { isDefault: false } },
      );
    }

    // Apply updates
    Object.assign(address, dto);
    await address.save();

    return address;
  }

  /**
   * Delete an address belonging to the user.
   * If the deleted address was the default, automatically promotes the most recent remaining address.
   */
  async deleteAddress(
    userId: string,
    addressId: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!Types.ObjectId.isValid(addressId)) {
      throw new BadRequestException('Invalid address ID format.');
    }

    const userObjectId = new Types.ObjectId(userId);
    const address = await this.addressModel.findOne({
      _id: new Types.ObjectId(addressId),
      userId: userObjectId,
    });

    if (!address) {
      throw new NotFoundException(
        'Address not found or does not belong to the authenticated user.',
      );
    }

    const wasDefault = address.isDefault;
    await address.deleteOne();

    // If deleted address was default, promote another address to default
    if (wasDefault) {
      const remainingAddress = await this.addressModel
        .findOne({ userId: userObjectId })
        .sort({ updatedAt: -1 });

      if (remainingAddress) {
        remainingAddress.isDefault = true;
        await remainingAddress.save();
        this.logger.log(`Promoted address ${remainingAddress._id} to default for user ${userId}`);
      }
    }

    return {
      success: true,
      message: 'Address removed successfully.',
    };
  }
}
