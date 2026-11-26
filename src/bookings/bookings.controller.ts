import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * Bookings Controller.
 * Manages idempotent booking submissions, price/coupon/slot re-verifications,
 * and order generation.
 * Source of truth: PRD.md §6.4 (FR-BK-7, FR-BK-8, FR-BK-9), §10; TECH_STACK.md §7.2, §8.3; TODO.md TASK-024.
 */
@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Idempotently create booking and downstream order',
    description:
      'Re-verifies prices, slot cutoff and capacity, and coupon eligibility before creating ' +
      'Order record in PAYMENT_PENDING or CONFIRMED status, initial OrderStatusEvent, ' +
      'DeliveryTask for pickup, and an IdempotencyRecord with request hash and response snapshot.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Unique client-generated token or UUID (required for safe retries)',
    required: true,
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Booking created successfully or idempotent response replayed.',
    type: BookingResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Missing Idempotency-Key header, invalid slot/address/items, slot cutoff passed, or slot capacity reached.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Idempotency-Key has already been used with a different request payload.',
  })
  async createBooking(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: CreateBookingDto,
    @CurrentUser() user?: any,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.createBooking(dto, idempotencyKey, user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get booking details by ID',
    description: 'Retrieves booking record by its MongoDB ObjectId.',
  })
  @ApiParam({ name: 'id', description: 'MongoDB ObjectId of the booking' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Booking record retrieved.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Booking not found.' })
  async getBookingById(@Param('id') id: string) {
    const booking = await this.bookingsService.getBookingById(id);
    if (!booking) {
      throw new NotFoundException(`Booking not found with ID: ${id}`);
    }
    return booking;
  }

  @Get('orders/:orderId')
  @ApiOperation({
    summary: 'Get order details by order tracking ID',
    description: 'Retrieves order record by canonical orderId (e.g. TC402736).',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Unique order tracking ID (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Order record retrieved.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Order not found.' })
  async getOrderByOrderId(@Param('orderId') orderId: string) {
    const order = await this.bookingsService.getOrderByOrderId(orderId);
    if (!order) {
      throw new NotFoundException(`Order not found with order tracking ID: ${orderId}`);
    }
    return order;
  }
}
