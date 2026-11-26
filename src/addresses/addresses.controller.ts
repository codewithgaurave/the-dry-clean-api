import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';

/**
 * Address Book Controller.
 * Source of truth: PRD.md §6.6, §10; TODO.md TASK-015.
 */
@ApiTags('Addresses')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  @ApiOperation({
    summary: 'List user saved addresses',
    description: 'Retrieves all addresses saved by the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'List of user addresses.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getAddresses(@CurrentUser() user: UserDocument) {
    return this.addressesService.listUserAddresses(user._id.toString());
  }

  @Post()
  @ApiOperation({
    summary: 'Add a new address',
    description: 'Creates a new address in the user address book.',
  })
  @ApiResponse({ status: 201, description: 'Address created successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createAddress(@CurrentUser() user: UserDocument, @Body() dto: CreateAddressDto) {
    return this.addressesService.createAddress(user._id.toString(), dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an existing address',
    description: 'Updates address details with ownership validation.',
  })
  @ApiParam({ name: 'id', description: 'Address ObjectId' })
  @ApiResponse({ status: 200, description: 'Address updated successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid address ID.' })
  @ApiResponse({ status: 404, description: 'Address not found or unauthorized.' })
  async updateAddress(
    @CurrentUser() user: UserDocument,
    @Param('id') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressesService.updateAddress(user._id.toString(), addressId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete an address',
    description: 'Removes an address from the user address book.',
  })
  @ApiParam({ name: 'id', description: 'Address ObjectId' })
  @ApiResponse({ status: 200, description: 'Address deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Address not found or unauthorized.' })
  async deleteAddress(@CurrentUser() user: UserDocument, @Param('id') addressId: string) {
    return this.addressesService.deleteAddress(user._id.toString(), addressId);
  }
}
