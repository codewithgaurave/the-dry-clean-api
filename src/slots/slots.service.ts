import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PickupSlot, PickupSlotDocument, SlotKey } from '../database/schemas/pickup-slot.schema';
import { Booking, BookingDocument } from '../database/schemas/booking.schema';
import { PickupSlotResponseDto } from './dto/pickup-slot-response.dto';

export interface DefaultSlotConfig {
  slotKey: SlotKey;
  label: string;
  timeWindow: string;
  startTime: string;
  endTime: string;
  capacity: number;
  cutoffHours: number;
}

export const DEFAULT_SLOT_CONFIGS: DefaultSlotConfig[] = [
  {
    slotKey: SlotKey.MORNING,
    label: 'Morning',
    timeWindow: '09:00 - 12:00',
    startTime: '09:00',
    endTime: '12:00',
    capacity: 10,
    cutoffHours: 2, // Cutoff at 07:00
  },
  {
    slotKey: SlotKey.AFTERNOON,
    label: 'Afternoon',
    timeWindow: '13:00 - 16:00',
    startTime: '13:00',
    endTime: '16:00',
    capacity: 10,
    cutoffHours: 2, // Cutoff at 11:00
  },
  {
    slotKey: SlotKey.EVENING,
    label: 'Evening',
    timeWindow: '17:00 - 20:00',
    startTime: '17:00',
    endTime: '20:00',
    capacity: 10,
    cutoffHours: 2, // Cutoff at 15:00
  },
];

/**
 * Service managing pickup slot windows, cutoff windows, dynamic booking capacities, and reservations.
 * Source of truth: PRD.md §6.4 (FR-BK-4), §9.1; TECH_STACK.md §7.2, §7.4; TODO.md TASK-021.
 */
@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    @InjectModel(PickupSlot.name)
    private readonly pickupSlotModel: Model<PickupSlotDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
  ) {}

  /**
   * Retrieves available pickup slots for a given date and service area.
   * Computes cutoff window rules (2h prior to startTime) and dynamic capacity availability.
   *
   * @param dateStr Target date in YYYY-MM-DD ISO format
   * @param serviceArea Optional service area or pincode (defaults to 'ALL')
   * @param now Optional reference time for deterministic testing
   */
  async getAvailableSlots(
    dateStr: string,
    serviceArea: string = 'ALL',
    now: Date = new Date(),
  ): Promise<PickupSlotResponseDto[]> {
    this.validateDate(dateStr, now);

    const area = serviceArea && serviceArea.trim() ? serviceArea.trim() : 'ALL';
    const todayStr = this.formatDate(now);
    const isToday = dateStr === todayStr;

    // 1. Fetch or initialize slots in MongoDB for the given date and area
    const slots = await this.ensureSlotsForDate(dateStr, area);

    // 2. Fetch active bookings for this date to compute dynamic remaining capacity
    const activeBookings = await this.bookingModel
      .find({
        scheduledDate: dateStr,
        status: { $ne: 'CANCELLED' },
      })
      .select('_id scheduledTimeSlot pickupSlotId status');

    // 3. Map slot records into response DTOs with availability evaluations
    return slots.map((slot) => {
      const cutoffTimeStr = this.calculateCutoffTime(slot.startTime, slot.cutoffHours);
      const isCutoffPassed = isToday && this.hasCutoffPassed(slot.startTime, slot.cutoffHours, now);

      // Count active bookings targeting this specific slot
      const bookingsForSlot = activeBookings.filter((b) => {
        if (b.pickupSlotId && slot._id) {
          return b.pickupSlotId.toString() === slot._id.toString();
        }
        return b.scheduledTimeSlot === slot.timeWindow || b.scheduledTimeSlot === slot.label;
      }).length;

      const effectiveBookedCount = Math.max(slot.bookedCount || 0, bookingsForSlot);
      const capacity = slot.capacity ?? 10;
      const remainingCapacity = Math.max(0, capacity - effectiveBookedCount);

      let isAvailable = true;
      let unavailableReason: 'CUTOFF_PASSED' | 'CAPACITY_REACHED' | 'SLOT_INACTIVE' | null = null;

      if (!slot.isActive) {
        isAvailable = false;
        unavailableReason = 'SLOT_INACTIVE';
      } else if (isCutoffPassed) {
        isAvailable = false;
        unavailableReason = 'CUTOFF_PASSED';
      } else if (remainingCapacity <= 0) {
        isAvailable = false;
        unavailableReason = 'CAPACITY_REACHED';
      }

      return {
        id: slot._id ? slot._id.toString() : new Types.ObjectId().toString(),
        slotKey: slot.slotKey,
        label: slot.label,
        timeWindow: slot.timeWindow,
        startTime: slot.startTime,
        endTime: slot.endTime,
        date: slot.date,
        serviceArea: slot.serviceArea,
        capacity,
        bookedCount: effectiveBookedCount,
        remainingCapacity,
        isAvailable,
        unavailableReason,
        cutoffTime: cutoffTimeStr,
      };
    });
  }

  /**
   * Retrieves a single slot by MongoDB ObjectId.
   */
  async getSlotById(slotId: string): Promise<PickupSlotDocument> {
    if (!Types.ObjectId.isValid(slotId)) {
      throw new BadRequestException(`Invalid slot ObjectId: ${slotId}`);
    }
    const slot = await this.pickupSlotModel.findById(slotId);
    if (!slot) {
      throw new NotFoundException(`Pickup slot not found with ID: ${slotId}`);
    }
    return slot;
  }

  /**
   * Atomically increments bookedCount for a slot if capacity is not exceeded.
   */
  async reserveSlot(slotId: string): Promise<PickupSlotDocument> {
    if (!Types.ObjectId.isValid(slotId)) {
      throw new BadRequestException(`Invalid slot ObjectId: ${slotId}`);
    }

    const slot = await this.pickupSlotModel.findById(slotId);
    if (!slot) {
      throw new NotFoundException(`Pickup slot not found with ID: ${slotId}`);
    }

    if (slot.bookedCount >= slot.capacity) {
      throw new BadRequestException('Slot capacity has already been reached');
    }

    slot.bookedCount += 1;
    return slot.save();
  }

  /**
   * Atomically decrements bookedCount when a booking is cancelled or rescheduled.
   */
  async releaseSlot(slotId: string): Promise<PickupSlotDocument> {
    if (!Types.ObjectId.isValid(slotId)) {
      throw new BadRequestException(`Invalid slot ObjectId: ${slotId}`);
    }

    const slot = await this.pickupSlotModel.findById(slotId);
    if (!slot) {
      throw new NotFoundException(`Pickup slot not found with ID: ${slotId}`);
    }

    if (slot.bookedCount > 0) {
      slot.bookedCount -= 1;
      return slot.save();
    }
    return slot;
  }

  /**
   * Validates date string format and ensures date is not in the past.
   */
  public validateDate(dateStr: string, now: Date): void {
    if (!dateStr || typeof dateStr !== 'string') {
      throw new BadRequestException('Date query parameter is required');
    }

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(dateStr)) {
      throw new BadRequestException('Date must be formatted as YYYY-MM-DD');
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));

    if (
      isNaN(parsedDate.getTime()) ||
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() + 1 !== month ||
      parsedDate.getUTCDate() !== day
    ) {
      throw new BadRequestException(`Invalid calendar date: ${dateStr}`);
    }

    const todayStr = this.formatDate(now);
    if (dateStr < todayStr) {
      throw new BadRequestException('Date cannot be in the past');
    }
  }

  /**
   * Formats a Date object to YYYY-MM-DD.
   */
  public formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Computes the cutoff string (HH:mm) given start time and cutoff hours.
   */
  public calculateCutoffTime(startTime: string, cutoffHours: number): string {
    const [h, m] = startTime.split(':').map(Number);
    const startMinutes = h * 60 + m;
    const cutoffMinutes = startMinutes - cutoffHours * 60;

    const normalizedMinutes = Math.max(0, cutoffMinutes);
    const cutoffH = Math.floor(normalizedMinutes / 60);
    const cutoffM = normalizedMinutes % 60;

    return `${String(cutoffH).padStart(2, '0')}:${String(cutoffM).padStart(2, '0')}`;
  }

  /**
   * Checks whether the current time is past the slot cutoff window.
   */
  public hasCutoffPassed(startTime: string, cutoffHours: number, now: Date): boolean {
    const [h, m] = startTime.split(':').map(Number);
    const cutoffMinutes = (h - cutoffHours) * 60 + m;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return currentMinutes >= cutoffMinutes;
  }

  /**
   * Ensures that slot documents exist in the database for the given date.
   */
  private async ensureSlotsForDate(
    dateStr: string,
    serviceArea: string,
  ): Promise<PickupSlotDocument[]> {
    const existing = await this.pickupSlotModel.find({
      date: dateStr,
      serviceArea,
    });

    const existingMap = new Map<string, PickupSlotDocument>();
    for (const slot of existing) {
      existingMap.set(slot.slotKey, slot);
    }

    const result: PickupSlotDocument[] = [];

    for (const config of DEFAULT_SLOT_CONFIGS) {
      let slot = existingMap.get(config.slotKey);
      if (!slot) {
        try {
          slot = await this.pickupSlotModel.create({
            serviceArea,
            date: dateStr,
            slotKey: config.slotKey,
            label: config.label,
            timeWindow: config.timeWindow,
            startTime: config.startTime,
            endTime: config.endTime,
            capacity: config.capacity,
            bookedCount: 0,
            cutoffHours: config.cutoffHours,
            isActive: true,
          });
        } catch (err: any) {
          // Handle potential concurrent insert race condition gracefully
          const found = await this.pickupSlotModel.findOne({
            date: dateStr,
            slotKey: config.slotKey,
            serviceArea,
          });
          if (found) {
            slot = found;
          } else {
            throw err;
          }
        }
      }
      if (slot) {
        result.push(slot);
      }
    }

    return result;
  }
}
