import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import {
  OrdersService,
  AdminPaginatedOrdersResult,
  AdminOrderDetailResult,
} from './orders.service';
import { AdminListOrdersQueryDto } from './dto/admin-list-orders-query.dto';
import { AdminUpdateOrderStatusDto } from './dto/admin-update-order-status.dto';
import { AdminAssignOrderDto } from './dto/admin-assign-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';
import { OrderActorRole } from './order-status.enum';

/**
 * Admin & Operations Orders Controller.
 * Provides management workstation endpoints for order monitoring, facility lifecycle processing,
 * and courier agent assignment. Enforces strict role-based access control.
 * Source of truth: PRD.md §8.4, §12; TECH_STACK.md §6.3; TODO.md TASK-042.
 */
@ApiTags('Admin Orders & Facility Processing')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Roles(
    OrderActorRole.ADMIN,
    OrderActorRole.OPERATIONS,
    OrderActorRole.FACILITY_STAFF,
    OrderActorRole.QC_OPERATOR,
    OrderActorRole.SUPPORT,
  )
  @ApiOperation({
    summary: 'List orders for administrative and operations monitoring',
    description:
      'Retrieves paginated orders with customer information. Supports status, search term, and date filtering.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated admin orders retrieved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not possess sufficient staff privileges.',
  })
  async listOrders(@Query() query: AdminListOrdersQueryDto): Promise<AdminPaginatedOrdersResult> {
    return this.ordersService.listAdminOrders(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(
    OrderActorRole.ADMIN,
    OrderActorRole.OPERATIONS,
    OrderActorRole.FACILITY_STAFF,
    OrderActorRole.QC_OPERATOR,
    OrderActorRole.SUPPORT,
  )
  @ApiOperation({
    summary: 'Get complete order details for workstation inspection',
    description:
      'Retrieves complete order record along with customer info, fulfillment delivery tasks, and chronological status audit events.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order workstation detail retrieved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found.',
  })
  async getOrderById(@Param('id') id: string): Promise<AdminOrderDetailResult> {
    return this.ordersService.getAdminOrderById(id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @Roles(
    OrderActorRole.ADMIN,
    OrderActorRole.OPERATIONS,
    OrderActorRole.FACILITY_STAFF,
    OrderActorRole.QC_OPERATOR,
  )
  @ApiOperation({
    summary: 'Transition order through facility and operational lifecycle',
    description:
      'Moves order to target status (e.g. RECEIVED_AT_FACILITY -> ASSESSMENT -> CLEANING_IN_PROGRESS -> QUALITY_CHECK -> READY_FOR_DELIVERY). Enforces role permissions and writes audit event.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order status successfully transitioned.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid status transition per state machine business rules.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Current user role not authorized for this specific transition.',
  })
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: AdminUpdateOrderStatusDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.ordersService.updateOrderStatusByAdmin(id, dto.status, user, dto.note);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @Roles(OrderActorRole.ADMIN, OrderActorRole.OPERATIONS)
  @ApiOperation({
    summary: 'Assign courier/valet agent to order pickup or delivery task',
    description:
      'Assigns a designated agent to the order task and emits outbox dispatch event. Restricted to Operations and Admin.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or canonical orderId (e.g. TC402736)',
    example: 'TC402736',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Agent successfully assigned to task.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order or agent not found.',
  })
  async assignOrder(
    @Param('id') id: string,
    @Body() dto: AdminAssignOrderDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.ordersService.assignOrderTaskByAdmin(id, dto, user);
  }
}
