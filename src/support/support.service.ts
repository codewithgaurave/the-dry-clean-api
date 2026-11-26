import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SupportTicket,
  SupportTicketDocument,
  SupportTicketType,
  SupportTicketStatus,
  TicketPriority,
} from '../database/schemas/support-ticket.schema';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import { CreateSupportTicketDto } from './dto/create-ticket.dto';
import { FaqItem } from './dto/faq.dto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  // Curated Knowledge Base conforming to PRD.md §6.11, §6.12.3, §6.12.4
  private readonly faqs: FaqItem[] = [
    {
      id: 'faq-pod-1',
      category: 'Delivery & Proof',
      question: 'How does Photo Proof of Delivery (POD) work?',
      answer:
        'For every completed pickup and delivery, our dedicated valet captures high-resolution photographic evidence of the garments at your doorstep or handover location. You immediately receive a notification with a secure, private link to view the photo in your Atelier app.',
      tags: ['proof', 'pod', 'delivery', 'valet', 'photo'],
    },
    {
      id: 'faq-privacy-2',
      category: 'Privacy & Security',
      question: 'What is your photo capture privacy and retention policy?',
      answer:
        'In strict compliance with privacy standards, valets are rigorously trained to photograph only the sealed garment package and doorstep, strictly avoiding residents’ faces or home interiors. Photos are encrypted in private cloud storage, never exposed publicly, and accessible only via short-lived 15-minute signed links. Records are retained for 90 days for dispute protection and then automatically purged.',
      tags: ['privacy', 'retention', 'security', 'camera', 'data'],
    },
    {
      id: 'faq-guarantee-3',
      category: 'Garment Care',
      question: 'What is covered under the ₹50,000 Fabric Guarantee?',
      answer:
        'Every order processed through our atelier is backed by our ₹50,000 Zero-Damage Fabric Guarantee. If any item is damaged or compromised due to operational failure during cleaning or pressing, our claims team will compensate the verified garment value within 7 business days.',
      tags: ['guarantee', 'protection', 'damage', 'insurance', 'care'],
    },
    {
      id: 'faq-service-4',
      category: 'Services & Turnaround',
      question: 'How long does dry cleaning take for delicate couture and suits?',
      answer:
        'Standard artisanal dry cleaning takes 48 hours to ensure thorough fabric relaxation and hand inspection. Express 24-hour turnaround is available on select business suits, shirts, and casual garments upon request during booking.',
      tags: ['turnaround', 'express', 'timing', 'duration'],
    },
    {
      id: 'faq-order-5',
      category: 'Orders & Booking',
      question: 'Can I cancel or reschedule my scheduled pickup?',
      answer:
        'Yes. You can cancel or reschedule your pickup slot with zero fee anytime up until the valet is dispatched (status: Confirmed or Pickup Scheduled) directly via the live order screen in your app.',
      tags: ['cancel', 'reschedule', 'slot', 'booking'],
    },
    {
      id: 'faq-dispute-6',
      category: 'Disputes & Support',
      question: 'How do I report a missing item or disputed delivery?',
      answer:
        'If you do not recognize the delivery proof photo or find an item missing, tap the "Report an Issue" button on your Order Details screen within 48 hours of delivery. A priority investigation ticket will immediately be escalated to operations.',
      tags: ['dispute', 'missing', 'ticket', 'support', 'issue'],
    },
  ];

  constructor(
    @InjectModel(SupportTicket.name)
    private readonly supportTicketModel: Model<SupportTicketDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  /**
   * Create a new customer support ticket.
   */
  async createTicket(userId: string, dto: CreateSupportTicketDto) {
    let orderRef: Types.ObjectId | undefined;
    if (dto.orderId) {
      const order = await this.orderModel.findOne({
        $or: [
          { orderId: dto.orderId },
          ...(Types.ObjectId.isValid(dto.orderId)
            ? [{ _id: new Types.ObjectId(dto.orderId) }]
            : []),
        ],
      });
      if (order) {
        orderRef = order._id as Types.ObjectId;
      }
    }

    // Determine category mapping
    let ticketType = SupportTicketType.OTHER;
    const cat = (dto.category || '').toUpperCase();
    if (cat.includes('DELIVERY') || cat.includes('DISPUTE')) {
      ticketType = SupportTicketType.DELIVERY_DISPUTE;
    } else if (cat.includes('ORDER')) {
      ticketType = SupportTicketType.ORDER_ISSUE;
    } else if (cat.includes('DAMAGE')) {
      ticketType = SupportTicketType.DAMAGED_ITEMS;
    } else if (cat.includes('BILLING') || cat.includes('PAYMENT')) {
      ticketType = SupportTicketType.BILLING;
    }

    // Determine priority
    let priority = TicketPriority.MEDIUM;
    const prio = (dto.priority || '').toUpperCase();
    if (prio === 'URGENT') priority = TicketPriority.URGENT;
    else if (prio === 'HIGH') priority = TicketPriority.HIGH;
    else if (prio === 'LOW') priority = TicketPriority.LOW;

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const dateSuffix = Date.now().toString().slice(-6);
    const ticketNumber = `TKT-${dto.orderId ? dto.orderId + '-' : ''}${dateSuffix}${randomSuffix}`;

    const created = await this.supportTicketModel.create({
      ticketNumber,
      userId: new Types.ObjectId(userId),
      orderId: dto.orderId || 'GENERAL',
      orderRef,
      type: ticketType,
      subject: dto.subject,
      description: dto.description,
      status: SupportTicketStatus.OPEN,
      priority,
    });

    this.logger.log(`Created support ticket ${ticketNumber} for user ${userId}`);

    return {
      id: created._id.toString(),
      ticketNumber: created.ticketNumber,
      orderId: created.orderId,
      type: created.type,
      subject: created.subject,
      description: created.description,
      status: created.status,
      priority: created.priority,
      createdAt: created.createdAt,
    };
  }

  /**
   * Get all tickets submitted by a user.
   */
  async getUserTickets(userId: string) {
    const filter = Types.ObjectId.isValid(userId)
      ? { userId: new Types.ObjectId(userId) }
      : { userId };

    const tickets = await this.supportTicketModel.find(filter).sort({ createdAt: -1 }).lean();

    return tickets.map((t) => ({
      id: (t as any)._id.toString(),
      ticketNumber: t.ticketNumber,
      orderId: t.orderId,
      type: t.type,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      createdAt: (t as any).createdAt,
      resolutionNote: t.resolutionNote,
    }));
  }

  /**
   * Retrieve FAQs, with optional filtering.
   */
  getFaqs(category?: string, search?: string): FaqItem[] {
    let result = this.faqs;

    if (category && category !== 'ALL') {
      const catLower = category.toLowerCase();
      result = result.filter((f) => f.category.toLowerCase().includes(catLower));
    }

    if (search && search.trim().length > 0) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (f) =>
          f.question.toLowerCase().includes(q) ||
          f.answer.toLowerCase().includes(q) ||
          (f.tags && f.tags.some((t) => t.toLowerCase().includes(q))),
      );
    }

    return result;
  }
}
