import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OrderActorRole } from '../orders/order-status.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';
import { AgentTasksService } from './agent-tasks.service';
import { SubmitProofDto, ProofSubmissionResponse } from './dto/submit-proof.dto';
import { RecordFailedAttemptDto, FailedAttemptResponse } from './dto/record-failed-attempt.dto';

/**
 * AgentTasksController:
 * REST API for Agent Task Execution and Proof Verification.
 * Source of truth: PRD.md §6.12.1, §6.12.2; TECH_STACK.md §9.4; TODO.md TASK-035.
 */
@ApiTags('Agent Tasks & Proofs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(OrderActorRole.AGENT, OrderActorRole.ADMIN)
@Controller('agent/tasks')
export class AgentTasksController {
  constructor(private readonly agentTasksService: AgentTasksService) {}

  /**
   * Submits mandatory photographic proof for a pickup or delivery task.
   * Atomically validates photos, updates delivery task, transitions order state,
   * creates immutable OrderProof, and records OrderStatusEvent.
   */
  @Post(':id/proof')
  @ApiOperation({
    summary: 'Submit Proof of Pickup or Delivery (POP/POD)',
    description:
      'Mandatory proof submission requiring at least 1 photo. Transitions order to PICKED_UP or DELIVERED only upon verification.',
  })
  @ApiParam({
    name: 'id',
    description: 'DeliveryTask taskId (e.g. TSK_P_402736) or MongoDB ObjectId',
    example: 'TSK_P_402736',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Proof photo files and optional doorstep metadata',
    type: SubmitProofDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Proof verified and order transitioned successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Zero photos provided, invalid order state, or task already completed.',
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated agent is not assigned to this task.',
  })
  @ApiResponse({
    status: 404,
    description: 'Delivery task or associated order not found.',
  })
  @UseInterceptors(FilesInterceptor('photos', 5))
  async submitProof(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: SubmitProofDto,
  ): Promise<ProofSubmissionResponse> {
    return this.agentTasksService.submitProof(id, user, files || [], dto);
  }

  /**
   * Records a failed pickup or delivery attempt.
   * Updates DeliveryTask to FAILED, transitions order to PICKUP_FAILED or DELIVERY_FAILED,
   * and records an immutable OrderStatusEvent.
   * Source of truth: PRD.md §6.12.1 (FR-POD-11); TECH_STACK.md §9.4, §9.5; TODO.md TASK-036.
   */
  @Post(':id/failed-attempt')
  @ApiOperation({
    summary: 'Record a Failed Pickup or Delivery Attempt',
    description:
      'Records a failed attempt with a reason, optional notes, and optional photo evidence. Transitions order to PICKUP_FAILED or DELIVERY_FAILED without fulfilling the order.',
  })
  @ApiParam({
    name: 'id',
    description: 'DeliveryTask taskId (e.g. TSK_P_402736) or MongoDB ObjectId',
    example: 'TSK_P_402736',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    description: 'Reason for failure, optional notes, and optional photo evidence file',
    type: RecordFailedAttemptDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Failed attempt recorded and order transitioned successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Task already completed or invalid order state.',
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated agent is not assigned to this task.',
  })
  @ApiResponse({
    status: 404,
    description: 'Delivery task or associated order not found.',
  })
  @UseInterceptors(FileInterceptor('photo'))
  async recordFailedAttempt(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: RecordFailedAttemptDto,
  ): Promise<FailedAttemptResponse> {
    return this.agentTasksService.recordFailedAttempt(id, user, file, dto);
  }

  /**
   * Retrieves an OrderProof record with short-lived signed URLs.
   */
  @Get('proofs/:proofId')
  @ApiOperation({ summary: 'Get OrderProof by ID with signed photo URLs' })
  async getProofById(@Param('proofId') proofId: string) {
    return this.agentTasksService.getProofById(proofId);
  }

  /**
   * Retrieves assigned delivery tasks for the authenticated agent.
   * Can be partitioned by route ('today' vs 'completed') or filtered by date/status.
   * Source of truth: PRD.md §6.12.5 (FR-AGT-1, FR-AGT-2); TECH_STACK.md §4.2; TODO.md TASK-037.
   */
  @Get()
  @ApiOperation({
    summary: 'List Assigned Delivery Tasks for Agent',
    description:
      "Retrieves tasks assigned exclusively to the authenticated agent, partitioned by 'today' route or 'completed'.",
  })
  @ApiQuery({
    name: 'partition',
    required: false,
    enum: ['today', 'completed'],
    description: "Partition route into today's active tasks vs completed/failed history.",
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by specific task status (ASSIGNED, IN_PROGRESS, COMPLETED, FAILED).',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Filter by scheduled date (YYYY-MM-DD).',
  })
  async getAgentTasks(
    @CurrentUser() user: UserDocument,
    @Query('partition') partition?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
  ) {
    return this.agentTasksService.getAgentTasks(user, { partition, status, date });
  }
}
