import { Controller, Get, Query, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SlotsService } from './slots.service';
import { GetSlotsQueryDto } from './dto/get-slots-query.dto';
import { PickupSlotResponseDto } from './dto/pickup-slot-response.dto';

/**
 * Pickup Slots & Availability Controller.
 * Provides public endpoint for querying time windows, capacity limits, and cutoff rules.
 * Source of truth: PRD.md §6.4 (FR-BK-4), §10; TECH_STACK.md §7.2; TODO.md TASK-021.
 */
@ApiTags('Pickup Slots')
@Controller(['pickup-slots', 'slots'])
export class SlotsController {
  constructor(private readonly slotsService: SlotsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get available pickup slots for a scheduled date',
    description:
      'Returns Morning, Afternoon, and Evening windows with dynamic booked count, remaining capacity, and 2-hour cutoff window enforcement.',
  })
  @ApiQuery({
    name: 'date',
    required: true,
    description: 'Target pickup date in YYYY-MM-DD format (must be today or in the future)',
    example: '2026-11-05',
  })
  @ApiQuery({
    name: 'serviceArea',
    required: false,
    description: 'Target service area or pincode (e.g. 110044)',
    example: 'ALL',
  })
  @ApiQuery({
    name: 'pincode',
    required: false,
    description: 'Optional pincode alias for service area',
    example: '110044',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of pickup slots with capacity and availability states.',
    type: [PickupSlotResponseDto],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid date parameter, bad date format, or date in the past.',
  })
  async getPickupSlots(@Query() query: GetSlotsQueryDto): Promise<PickupSlotResponseDto[]> {
    const serviceArea = query.serviceArea || query.pincode || 'ALL';
    return this.slotsService.getAvailableSlots(query.date, serviceArea);
  }
}
