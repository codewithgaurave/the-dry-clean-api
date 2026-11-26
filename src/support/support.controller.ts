import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-ticket.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';

/**
 * SupportController:
 * REST API for customer support ticketing, concierge queries, and knowledge base FAQs.
 * Source of truth: PRD.md §6.11 (FR-SUP-1, FR-SUP-2), §10; TECH_STACK.md §4.1; TODO.md TASK-045.
 */
@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('faqs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get curated knowledge base FAQs',
    description:
      'Returns searchable and categorised FAQs covering garment care, photo proof of delivery, privacy, and guarantees.',
  })
  @ApiQuery({ name: 'category', required: false, example: 'Delivery & Proof' })
  @ApiQuery({ name: 'search', required: false, example: 'guarantee' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'FAQs retrieved successfully.',
  })
  getFaqs(@Query('category') category?: string, @Query('search') search?: string) {
    return this.supportService.getFaqs(category, search);
  }

  @Post('tickets')
  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a new customer support ticket',
    description:
      'Creates a tracked support ticket linked to customer account and optional order ID.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Support ticket created successfully.',
  })
  async createTicket(@CurrentUser() user: UserDocument, @Body() dto: CreateSupportTicketDto) {
    return this.supportService.createTicket(user._id.toString(), dto);
  }

  @Get('tickets')
  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get customer support tickets',
    description: 'Returns chronological history of user-submitted support tickets.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User tickets retrieved successfully.',
  })
  async getUserTickets(@CurrentUser() user: UserDocument) {
    return this.supportService.getUserTickets(user._id.toString());
  }
}
