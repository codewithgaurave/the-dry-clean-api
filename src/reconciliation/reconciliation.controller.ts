import {
  Controller,
  Get,
  Post,
  Patch,
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
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';
import { OrderActorRole } from '../orders/order-status.enum';
import { SecurityAnomalyStatus } from '../database/schemas/security-audit.schema';

export class ResolveAnomalyDto {
  resolutionNote: string;
}

/**
 * ReconciliationController:
 * REST endpoints for operations & security teams to trigger proof reconciliation cycles
 * and review/resolve detected invariant breaches.
 * Source of truth: TECH_STACK.md §9.5; PRD.md §6.12.2; TODO.md TASK-046.
 */
@ApiTags('Admin Reconciliation & Security Audits')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('run')
  @Roles(OrderActorRole.ADMIN, OrderActorRole.OPERATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger manual proof reconciliation cycle',
    description:
      'Immediately audits active and delivered orders for proof invariants. Returns audit report.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reconciliation cycle completed successfully.',
  })
  async triggerReconciliation() {
    return this.reconciliationService.reconcileProofInvariants();
  }

  @Get('anomalies')
  @Roles(OrderActorRole.ADMIN, OrderActorRole.OPERATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List detected security audit anomalies',
    description: 'Retrieves security anomalies detected by the reconciliation worker.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: Object.values(SecurityAnomalyStatus),
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Anomalies retrieved successfully.',
  })
  async listAnomalies(@Query('status') status?: SecurityAnomalyStatus) {
    return this.reconciliationService.getAnomalies(status);
  }

  @Patch('anomalies/:id/resolve')
  @Roles(OrderActorRole.ADMIN, OrderActorRole.OPERATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a detected security anomaly',
    description: 'Marks a security audit anomaly as RESOLVED with staff resolution note.',
  })
  @ApiParam({ name: 'id', description: 'SecurityAudit MongoDB ObjectId' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Anomaly resolved successfully.',
  })
  async resolveAnomaly(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: ResolveAnomalyDto,
  ) {
    return this.reconciliationService.resolveAnomaly(id, user._id.toString(), dto.resolutionNote);
  }
}
