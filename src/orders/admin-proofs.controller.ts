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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { ReviewProofDto } from './dto/review-proof.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';
import { OrderActorRole } from './order-status.enum';

/**
 * Admin Proof Review Controller.
 * Enables administrative operations to review courier delivery and pickup photographic evidence,
 * verify compliance, or flag suspicious proofs with automated ticket creation.
 * Source of truth: PRD.md §6.12.3 (FR-POD-19, FR-POD-20); TECH_STACK.md §9.5; TODO.md TASK-043.
 */
@ApiTags('Admin Proof Review Queue')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/proofs')
export class AdminProofsController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('review')
  @HttpCode(HttpStatus.OK)
  @Roles(OrderActorRole.ADMIN, OrderActorRole.OPERATIONS, OrderActorRole.SUPPORT)
  @ApiOperation({
    summary: 'Retrieve photographic proof review queue with signed image links',
    description:
      'Fetches proofs pending review or filtered by status (PENDING, VERIFIED, FLAGGED, ALL) with presigned S3 URLs.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by review status: PENDING, VERIFIED, FLAGGED, or ALL',
    example: 'PENDING',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Proof review queue retrieved successfully.',
  })
  async getReviewQueue(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.getAdminProofsReviewQueue(
      status || 'PENDING',
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @Roles(OrderActorRole.ADMIN, OrderActorRole.OPERATIONS)
  @ApiOperation({
    summary: 'Approve or Flag photographic delivery proof',
    description:
      'Marks proof as VERIFIED or FLAGGED with audit logging. Flagging automatically opens an operations dispute ticket.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId or taskId of the proof',
    example: 'TSK_D_402738',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Proof reviewed successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Proof record not found.',
  })
  async reviewProof(
    @Param('id') id: string,
    @Body() dto: ReviewProofDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.ordersService.reviewAdminProof(id, dto, user);
  }
}
