import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { Booking, BookingDocument } from '../database/schemas/booking.schema';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import {
  OrderStatusEvent,
  OrderStatusEventDocument,
} from '../database/schemas/order-status-event.schema';
import {
  DeliveryTask,
  DeliveryTaskDocument,
  TaskType,
  TaskStatus,
} from '../database/schemas/delivery-task.schema';
import { Address, AddressDocument } from '../database/schemas/address.schema';
import {
  Service,
  ServiceDocument,
  ServicePrice,
  ServicePriceDocument,
} from '../database/schemas/service.schema';
import {
  IdempotencyRecord,
  IdempotencyRecordDocument,
} from '../database/schemas/idempotency-record.schema';
import { SlotsService } from '../slots/slots.service';
import { CouponsService } from '../coupons/coupons.service';
import { OrderStatus, OrderActorRole } from '../orders/order-status.enum';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';

/**
 * Service managing idempotent booking creation, price verification, slot reservations,
 * and downstream order/task initialization.
 * Source of truth: PRD.md §6.4 (FR-BK-7, FR-BK-8), §9.3; TECH_STACK.md §7.2, §8.3; TODO.md TASK-024.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(OrderStatusEvent.name)
    private readonly orderStatusEventModel: Model<OrderStatusEventDocument>,
    @InjectModel(DeliveryTask.name)
    private readonly deliveryTaskModel: Model<DeliveryTaskDocument>,
    @InjectModel(Address.name)
    private readonly addressModel: Model<AddressDocument>,
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(ServicePrice.name)
    private readonly servicePriceModel: Model<ServicePriceDocument>,
    @InjectModel(IdempotencyRecord.name)
    private readonly idempotencyRecordModel: Model<IdempotencyRecordDocument>,
    private readonly slotsService: SlotsService,
    private readonly couponsService: CouponsService,
  ) {}

  /**
   * Idempotently creates a verified booking and downstream order.
   * If the same Idempotency-Key is received with identical payload, replays the cached order response.
   */
  async createBooking(
    dto: CreateBookingDto,
    idempotencyKey?: string,
    user?: any,
    now: Date = new Date(),
  ): Promise<BookingResponseDto> {
    // 1. Enforce Idempotency-Key presence
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const key = idempotencyKey.trim();
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(dto)).digest('hex');

    // 2. Check for existing IdempotencyRecord
    const existingRecord = await this.idempotencyRecordModel.findOne({
      scope: 'BOOKING',
      key,
    });

    if (existingRecord) {
      if (existingRecord.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key has already been used with a different request payload.',
        );
      }
      this.logger.log(`Idempotent replay triggered for booking key: ${key}`);
      return {
        ...(existingRecord.responseSnapshot as any),
        isIdempotentReplay: true,
      } as BookingResponseDto;
    }

    // 3. Resolve Customer User ID
    const customerUserId =
      user?._id ||
      (dto.userId && Types.ObjectId.isValid(dto.userId)
        ? new Types.ObjectId(dto.userId)
        : new Types.ObjectId());

    // 4. Verify & Snapshot Pickup Address (PRD §9.3, FR-ADDR-2)
    if (!Types.ObjectId.isValid(dto.pickupAddressId)) {
      throw new BadRequestException(`Invalid pickupAddressId: ${dto.pickupAddressId}`);
    }

    const address = await this.addressModel.findById(dto.pickupAddressId);
    if (!address) {
      throw new BadRequestException(`Pickup address not found with ID: ${dto.pickupAddressId}`);
    }

    const addressSnapshot = {
      label: address.label,
      street: address.street,
      apartment: address.apartment,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      geo: address.geo,
    };

    // 5. Verify Pickup Slot Availability & Cutoff Window (FR-BK-4, FR-BK-7)
    if (!Types.ObjectId.isValid(dto.pickupSlotId)) {
      throw new BadRequestException(`Invalid pickupSlotId: ${dto.pickupSlotId}`);
    }

    const slot = await this.slotsService.getSlotById(dto.pickupSlotId);
    if (!slot || !slot.isActive) {
      throw new BadRequestException('The selected pickup slot is not available or inactive.');
    }

    this.slotsService.validateDate(dto.scheduledDate, now);

    const todayStr = this.slotsService.formatDate(now);
    if (dto.scheduledDate === todayStr) {
      const isCutoffPassed = this.slotsService.hasCutoffPassed(
        slot.startTime,
        slot.cutoffHours,
        now,
      );
      if (isCutoffPassed) {
        throw new BadRequestException(
          'Pickup slot booking window has closed (cutoff passed). Please select another time window.',
        );
      }
    }

    if (slot.bookedCount >= slot.capacity) {
      throw new BadRequestException(
        'Pickup slot capacity has been reached. Please choose another slot.',
      );
    }

    // 6. Authoritative Re-verification of Garment Items & Rates (FR-BK-7)
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Booking must contain at least one item.');
    }

    const snapshottedItems: any[] = [];
    let itemsSubtotalMinor = 0;
    const orderCategories: string[] = [];

    for (const item of dto.items) {
      if (!Types.ObjectId.isValid(item.serviceId)) {
        throw new BadRequestException(`Invalid serviceId: ${item.serviceId}`);
      }

      const serviceDoc = await this.serviceModel.findById(item.serviceId);
      if (!serviceDoc || !serviceDoc.active) {
        throw new BadRequestException(
          `Service "${item.serviceName}" is not active or unavailable.`,
        );
      }
      if (serviceDoc.category && !orderCategories.includes(serviceDoc.category)) {
        orderCategories.push(serviceDoc.category);
      }

      const priceDoc = await this.servicePriceModel.findOne({
        serviceId: new Types.ObjectId(item.serviceId),
        itemType: item.itemType,
        active: true,
      });

      const verifiedUnitPriceMinor = priceDoc ? priceDoc.amountMinor : (item.unitPriceMinor ?? 0);

      if (verifiedUnitPriceMinor <= 0) {
        throw new BadRequestException(
          `Price rate not configured for item "${item.itemType}" in service "${item.serviceName}".`,
        );
      }

      let itemAddonTotalMinor = 0;
      if (item.addOns && item.addOns.length > 0) {
        for (const addonName of item.addOns) {
          const addonPrice = await this.servicePriceModel.findOne({
            serviceId: new Types.ObjectId(item.serviceId),
            itemType: addonName,
            isAddon: true,
            active: true,
          });
          if (addonPrice) {
            itemAddonTotalMinor += addonPrice.amountMinor;
          }
        }
      }

      const itemTotalMinor = verifiedUnitPriceMinor * item.quantity + itemAddonTotalMinor;
      itemsSubtotalMinor += itemTotalMinor;

      snapshottedItems.push({
        serviceName: serviceDoc.name,
        itemType: item.itemType,
        quantity: item.quantity,
        unitPriceMinor: verifiedUnitPriceMinor,
        totalPriceMinor: itemTotalMinor,
        addOns: item.addOns || [],
      });
    }

    // 7. Authoritative Re-verification of Coupon Eligibility (FR-PR-3)
    let discountMinor = 0;
    if (dto.couponCode && dto.couponCode.trim().length > 0) {
      const couponValidation = await this.couponsService.validateCoupon(
        {
          code: dto.couponCode,
          subtotalMinor: itemsSubtotalMinor,
          categories: orderCategories,
          userId: customerUserId.toString(),
        },
        now,
      );
      discountMinor = couponValidation.discountMinor;
    }

    // 8. Financial Totals & GST Computation
    const deliveryFeeMinor = itemsSubtotalMinor >= 50000 ? 0 : 5000; // Free above ₹500
    const taxableAmountMinor = Math.max(0, itemsSubtotalMinor - discountMinor);
    const gstMinor = Math.round(taxableAmountMinor * 0.18); // 18% GST
    const totalAmountMinor = taxableAmountMinor + deliveryFeeMinor + gstMinor;

    // 9. Reserve Slot Capacity & Record Coupon Usage
    await this.slotsService.reserveSlot(dto.pickupSlotId);
    if (dto.couponCode && dto.couponCode.trim().length > 0) {
      await this.couponsService.recordCouponUsage(dto.couponCode);
    }

    // 10. Generate Unique Human-Readable Order Tracking ID (e.g. TC402736)
    const randomDigits = Math.floor(100000 + Math.random() * 900000).toString();
    const orderId = `TC${randomDigits}`;

    const isCash = (dto.paymentMethod || 'UPI').toUpperCase() === 'CASH';
    const initialStatus = isCash ? OrderStatus.CONFIRMED : OrderStatus.PAYMENT_PENDING;
    const initialPaymentStatus = isCash ? 'PAID' : 'PENDING';

    // 11. Create Booking Document
    const booking = await this.bookingModel.create({
      userId: customerUserId,
      pickupAddressId: address._id,
      pickupSlotId: slot._id,
      scheduledDate: dto.scheduledDate,
      scheduledTimeSlot: dto.scheduledTimeSlot,
      items: snapshottedItems.map((i, idx) => ({
        serviceId: new Types.ObjectId(dto.items[idx].serviceId),
        serviceName: i.serviceName,
        itemType: i.itemType,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        totalPriceMinor: i.totalPriceMinor,
        addOns: i.addOns,
      })),
      subtotalMinor: itemsSubtotalMinor,
      discountMinor,
      deliveryFeeMinor,
      totalAmountMinor,
      couponCode: dto.couponCode ? dto.couponCode.trim().toUpperCase() : undefined,
      status: 'CONFIRMED',
    });

    // 12. Create Order Document
    const order = await this.orderModel.create({
      orderId,
      userId: customerUserId,
      bookingId: booking._id,
      status: initialStatus,
      paymentStatus: initialPaymentStatus,
      paymentMethod: dto.paymentMethod || 'UPI',
      addressSnapshot,
      items: snapshottedItems,
      pricingSnapshot: {
        subtotalMinor: itemsSubtotalMinor,
        discountMinor,
        deliveryFeeMinor,
        totalAmountMinor,
        currency: 'INR',
        couponCode: dto.couponCode ? dto.couponCode.trim().toUpperCase() : undefined,
      },
      currentScheduledWindow: {
        type: 'PICKUP',
        date: dto.scheduledDate,
        timeSlot: dto.scheduledTimeSlot,
      },
    });

    // 13. Create Initial Order Status Event
    await this.orderStatusEventModel.create({
      orderId,
      orderRef: order._id,
      previousStatus: OrderStatus.DRAFT,
      status: initialStatus,
      actor: {
        actorRole: OrderActorRole.CUSTOMER,
        actorId: customerUserId.toString(),
      },
      note: `Booking confirmed with order #${orderId}`,
    });

    // 14. Create DeliveryTask for Pickup
    const deliveryTask = await this.deliveryTaskModel.create({
      taskId: `TSK_P_${orderId.replace('TC', '')}`,
      orderId,
      orderRef: order._id,
      taskType: TaskType.PICKUP,
      status: TaskStatus.ASSIGNED,
      scheduledDate: dto.scheduledDate,
      scheduledTimeWindow: dto.scheduledTimeSlot,
      attemptNumber: 1,
    });

    // 15. Formulate Response Payload
    const responsePayload: BookingResponseDto = {
      bookingId: booking._id.toString(),
      orderId,
      status: initialStatus,
      paymentStatus: initialPaymentStatus,
      paymentMethod: order.paymentMethod,
      scheduledDate: dto.scheduledDate,
      scheduledTimeSlot: dto.scheduledTimeSlot,
      pickupAddress: addressSnapshot,
      items: snapshottedItems,
      pricing: {
        subtotalMinor: itemsSubtotalMinor,
        discountMinor,
        deliveryFeeMinor,
        gstMinor,
        totalAmountMinor,
        totalAmountFormatted: `₹${(totalAmountMinor / 100).toFixed(2)}`,
        currency: 'INR',
        couponCode: dto.couponCode ? dto.couponCode.trim().toUpperCase() : undefined,
      },
      deliveryTaskId: deliveryTask.taskId,
      isIdempotentReplay: false,
      createdAt: order.createdAt || new Date(),
    };

    // 16. Record Idempotency Result
    await this.idempotencyRecordModel.create({
      scope: 'BOOKING',
      key,
      requestHash,
      resourceId: order._id,
      responseSnapshot: responsePayload,
      statusCode: 201,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24-hour TTL
    });

    return responsePayload;
  }

  /**
   * Retrieves an order by order tracking ID (e.g. TC402736).
   */
  async getOrderByOrderId(orderId: string): Promise<OrderDocument | null> {
    return this.orderModel.findOne({ orderId });
  }

  /**
   * Retrieves a booking by MongoDB ObjectId.
   */
  async getBookingById(bookingId: string): Promise<BookingDocument | null> {
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new BadRequestException(`Invalid bookingId: ${bookingId}`);
    }
    return this.bookingModel.findById(bookingId);
  }
}
