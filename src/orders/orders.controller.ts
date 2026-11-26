import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { OrdersService, PaginatedOrdersResult } from './orders.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { ReportIssueDto } from './dto/report-issue.dto';
import { OrderProofResponseDto } from './dto/order-proof-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';

/**
 * Customer Orders Controller.
 * Provides authenticated customers with access to their active/past orders,
 * order detail snapshots, and chronological status tracking events.
 * Enforces strict customer tenancy.
 * Source of truth: PRD.md §6.8 (FR-ORD-1, FR-ORD-2), §6.9 (FR-TRK-1), §10; TODO.md TASK-030.
 */
@ApiTags('Orders')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List customer orders',
    description:
      'Retrieves paginated orders strictly belonging to the authenticated customer. Supports filtering by "active" vs "past".',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated customer orders retrieved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token.',
  })
  async listOrders(
    @CurrentUser() user: UserDocument,
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedOrdersResult> {
    return this.ordersService.listCustomerOrders(user._id, query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get order details by ID or canonical tracking number',
    description:
      'Retrieves complete order record (items, pricing, address snapshot, status). Accepts either ObjectId or canonical orderId.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order details retrieved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found or does not belong to the authenticated customer.',
  })
  async getOrderById(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.ordersService.getCustomerOrderById(user._id, id);
  }

  @Get(':id/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get chronological order tracking events',
    description:
      'Retrieves full timeline history of status transitions for the order. Strictly scoped to the authenticated customer.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Chronological order events retrieved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found or does not belong to the authenticated customer.',
  })
  async getOrderEvents(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.ordersService.getCustomerOrderEvents(user._id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an eligible customer order',
    description:
      'Cancels an active order if prior to pickup (CONFIRMED or PICKUP_SCHEDULED). Returns 400 Bad Request if already picked up or in cleaning.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order cancelled successfully.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Order is not eligible for cancellation.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found or not authorized.',
  })
  async cancelOrder(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.ordersService.cancelCustomerOrder(user._id, id, dto);
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reschedule pickup for an active customer order',
    description:
      'Updates pickup window if order has not yet been collected. Returns 400 Bad Request if already picked up or in cleaning.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order pickup window rescheduled successfully.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Order is not eligible for pickup rescheduling.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found or not authorized.',
  })
  async rescheduleOrder(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: RescheduleOrderDto,
  ) {
    return this.ordersService.rescheduleCustomerOrder(user._id, id, dto);
  }

  @Get(':id/proofs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get signed delivery and pickup proof photos for customer order',
    description:
      'Retrieves signed short-lived S3 download URLs and handover metadata for photo evidence. Strictly scoped to customer-owned orders.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order proof records with signed S3 URLs retrieved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found or not authorized for the customer.',
  })
  async getOrderProofs(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<OrderProofResponseDto[]> {
    return this.ordersService.getCustomerOrderProofs(user._id, id);
  }

  @Post(':id/report-issue')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Report an issue or dispute delivery for an order',
    description:
      'Creates an immutable SupportTicket linked to the customer order and proof. Flags proof for admin review.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Support ticket created successfully and flagged for concierge review.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input or proof ID mismatch.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found or not authorized for the customer.',
  })
  async reportOrderIssue(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: ReportIssueDto,
  ) {
    return this.ordersService.reportCustomerOrderIssue(user._id, id, dto);
  }
}
