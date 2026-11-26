import { Controller, Get, Param, Query, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ServicesService, FormattedServiceResponse } from './services.service';

/**
 * Service Catalogue & Pricing Controller.
 * Public endpoints for browsing dry cleaning and garment care services and rates.
 * Source of truth: PRD.md §6.3, §10; DESIGN.md §6.3; TODO.md TASK-017.
 */
@ApiTags('Services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  @ApiOperation({
    summary: 'List available garment care services',
    description:
      'Retrieves the full active service catalogue with package options, per-item/per-kg pricing rates, and add-ons.',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description:
      'Filter services by category (DRY_CLEAN, PREMIUM_LAUNDRY, WASH_FOLD, STEAM_IRONING)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of formatted services with packages and pricing.',
  })
  async getServices(@Query('category') category?: string): Promise<FormattedServiceResponse[]> {
    return this.servicesService.listServices(category);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get service details by ID',
    description: 'Retrieves service description, package choices, and all item price tiers.',
  })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the service' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Detailed service item specification with pricing tiers.',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Service not found.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid service ID format.' })
  async getServiceById(@Param('id') id: string): Promise<FormattedServiceResponse> {
    return this.servicesService.getServiceById(id);
  }
}
