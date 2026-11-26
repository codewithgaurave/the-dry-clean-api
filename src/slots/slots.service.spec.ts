import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SlotsService } from './slots.service';
import { PickupSlot, SlotKey } from '../database/schemas/pickup-slot.schema';
import { Booking } from '../database/schemas/booking.schema';

describe('SlotsService', () => {
  let service: SlotsService;
  let pickupSlotModel: any;
  let bookingModel: any;

  beforeEach(async () => {
    pickupSlotModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn().mockImplementation((dto: any) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...dto,
        }),
      ),
    };

    bookingModel = {
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlotsService,
        {
          provide: getModelToken(PickupSlot.name),
          useValue: pickupSlotModel,
        },
        {
          provide: getModelToken(Booking.name),
          useValue: bookingModel,
        },
      ],
    }).compile();

    service = module.get<SlotsService>(SlotsService);
  });

  describe('Date validation', () => {
    const fixedNow = new Date(2026, 10, 5, 10, 0, 0); // 2026-11-05 10:00:00

    it('should accept valid future date', () => {
      expect(() => service.validateDate('2026-11-10', fixedNow)).not.toThrow();
    });

    it('should accept today date', () => {
      expect(() => service.validateDate('2026-11-05', fixedNow)).not.toThrow();
    });

    it('should reject past date with BadRequestException', () => {
      expect(() => service.validateDate('2026-11-04', fixedNow)).toThrow(
        new BadRequestException('Date cannot be in the past'),
      );
    });

    it('should reject invalid date format with BadRequestException', () => {
      expect(() => service.validateDate('05-11-2026', fixedNow)).toThrow(
        new BadRequestException('Date must be formatted as YYYY-MM-DD'),
      );
      expect(() => service.validateDate('invalid-date', fixedNow)).toThrow(
        new BadRequestException('Date must be formatted as YYYY-MM-DD'),
      );
    });

    it('should reject non-existent calendar date with BadRequestException', () => {
      expect(() => service.validateDate('2026-02-31', fixedNow)).toThrow(
        new BadRequestException('Invalid calendar date: 2026-02-31'),
      );
    });
  });

  describe('Cutoff calculation', () => {
    it('should correctly compute cutoff times 2 hours before window start', () => {
      expect(service.calculateCutoffTime('09:00', 2)).toBe('07:00');
      expect(service.calculateCutoffTime('13:00', 2)).toBe('11:00');
      expect(service.calculateCutoffTime('17:00', 2)).toBe('15:00');
    });

    it('should accurately determine if cutoff has passed for a given clock time', () => {
      // Slot at 09:00, cutoff is 07:00
      const morningBeforeCutoff = new Date(2026, 10, 5, 6, 45, 0); // 06:45
      const morningAtCutoff = new Date(2026, 10, 5, 7, 0, 0); // 07:00
      const morningAfterCutoff = new Date(2026, 10, 5, 8, 15, 0); // 08:15

      expect(service.hasCutoffPassed('09:00', 2, morningBeforeCutoff)).toBe(false);
      expect(service.hasCutoffPassed('09:00', 2, morningAtCutoff)).toBe(true);
      expect(service.hasCutoffPassed('09:00', 2, morningAfterCutoff)).toBe(true);
    });
  });

  describe('getAvailableSlots', () => {
    const fixedNowMorning = new Date(2026, 10, 5, 6, 30, 0); // 2026-11-05 06:30
    const fixedNowAfternoon = new Date(2026, 10, 5, 8, 0, 0); // 2026-11-05 08:00
    const futureDate = '2026-11-08';
    const todayDate = '2026-11-05';

    it('should provision and return all 3 standard slots for a future date with full capacity', async () => {
      pickupSlotModel.find.mockResolvedValue([]);
      pickupSlotModel.create.mockImplementation((dto: any) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...dto,
        }),
      );
      bookingModel.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const slots = await service.getAvailableSlots(futureDate, 'ALL', fixedNowMorning);

      expect(slots).toHaveLength(3);
      expect(slots[0].slotKey).toBe(SlotKey.MORNING);
      expect(slots[0].timeWindow).toBe('09:00 - 12:00');
      expect(slots[0].capacity).toBe(10);
      expect(slots[0].remainingCapacity).toBe(10);
      expect(slots[0].isAvailable).toBe(true);
      expect(slots[0].unavailableReason).toBeNull();
      expect(slots[0].cutoffTime).toBe('07:00');

      expect(slots[1].slotKey).toBe(SlotKey.AFTERNOON);
      expect(slots[1].timeWindow).toBe('13:00 - 16:00');
      expect(slots[1].isAvailable).toBe(true);

      expect(slots[2].slotKey).toBe(SlotKey.EVENING);
      expect(slots[2].timeWindow).toBe('17:00 - 20:00');
      expect(slots[2].isAvailable).toBe(true);
    });

    it('should mark morning slot as CUTOFF_PASSED when requested today past 07:00 AM', async () => {
      const mockSlots = [
        {
          _id: new Types.ObjectId(),
          slotKey: SlotKey.MORNING,
          label: 'Morning',
          timeWindow: '09:00 - 12:00',
          startTime: '09:00',
          endTime: '12:00',
          capacity: 10,
          bookedCount: 0,
          cutoffHours: 2,
          isActive: true,
          date: todayDate,
          serviceArea: 'ALL',
        },
        {
          _id: new Types.ObjectId(),
          slotKey: SlotKey.AFTERNOON,
          label: 'Afternoon',
          timeWindow: '13:00 - 16:00',
          startTime: '13:00',
          endTime: '16:00',
          capacity: 10,
          bookedCount: 0,
          cutoffHours: 2,
          isActive: true,
          date: todayDate,
          serviceArea: 'ALL',
        },
        {
          _id: new Types.ObjectId(),
          slotKey: SlotKey.EVENING,
          label: 'Evening',
          timeWindow: '17:00 - 20:00',
          startTime: '17:00',
          endTime: '20:00',
          capacity: 10,
          bookedCount: 0,
          cutoffHours: 2,
          isActive: true,
          date: todayDate,
          serviceArea: 'ALL',
        },
      ];

      pickupSlotModel.find.mockResolvedValue(mockSlots);
      bookingModel.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      // fixedNowAfternoon is 08:00 AM (past 07:00 cutoff)
      const slots = await service.getAvailableSlots(todayDate, 'ALL', fixedNowAfternoon);

      expect(slots[0].slotKey).toBe(SlotKey.MORNING);
      expect(slots[0].isAvailable).toBe(false);
      expect(slots[0].unavailableReason).toBe('CUTOFF_PASSED');

      expect(slots[1].slotKey).toBe(SlotKey.AFTERNOON);
      expect(slots[1].isAvailable).toBe(true);
      expect(slots[1].unavailableReason).toBeNull();

      expect(slots[2].slotKey).toBe(SlotKey.EVENING);
      expect(slots[2].isAvailable).toBe(true);
      expect(slots[2].unavailableReason).toBeNull();
    });

    it('should mark slot as CAPACITY_REACHED when bookedCount equals capacity', async () => {
      const afternoonSlotId = new Types.ObjectId();
      const mockSlots = [
        {
          _id: afternoonSlotId,
          slotKey: SlotKey.AFTERNOON,
          label: 'Afternoon',
          timeWindow: '13:00 - 16:00',
          startTime: '13:00',
          endTime: '16:00',
          capacity: 10,
          bookedCount: 10, // Saturation reached
          cutoffHours: 2,
          isActive: true,
          date: futureDate,
          serviceArea: 'ALL',
        },
      ];

      pickupSlotModel.find.mockResolvedValue(mockSlots);
      bookingModel.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const slots = await service.getAvailableSlots(futureDate, 'ALL', fixedNowMorning);

      const afternoonSlot = slots.find((s) => s.slotKey === SlotKey.AFTERNOON);
      expect(afternoonSlot).toBeDefined();
      expect(afternoonSlot!.bookedCount).toBe(10);
      expect(afternoonSlot!.remainingCapacity).toBe(0);
      expect(afternoonSlot!.isAvailable).toBe(false);
      expect(afternoonSlot!.unavailableReason).toBe('CAPACITY_REACHED');
    });

    it('should dynamically count active bookings from Booking collection', async () => {
      const eveningSlotId = new Types.ObjectId();
      const mockSlots = [
        {
          _id: eveningSlotId,
          slotKey: SlotKey.EVENING,
          label: 'Evening',
          timeWindow: '17:00 - 20:00',
          startTime: '17:00',
          endTime: '20:00',
          capacity: 10,
          bookedCount: 0,
          cutoffHours: 2,
          isActive: true,
          date: futureDate,
          serviceArea: 'ALL',
        },
      ];

      pickupSlotModel.find.mockResolvedValue(mockSlots);
      // Simulate 4 active bookings for the evening slot
      bookingModel.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: new Types.ObjectId(), scheduledTimeSlot: '17:00 - 20:00', status: 'CONFIRMED' },
          { _id: new Types.ObjectId(), scheduledTimeSlot: '17:00 - 20:00', status: 'DRAFT' },
          { _id: new Types.ObjectId(), pickupSlotId: eveningSlotId, status: 'CONFIRMED' },
          { _id: new Types.ObjectId(), scheduledTimeSlot: 'Evening', status: 'CONFIRMED' },
        ]),
      });

      const slots = await service.getAvailableSlots(futureDate, 'ALL', fixedNowMorning);
      const evening = slots.find((s) => s.slotKey === SlotKey.EVENING);

      expect(evening!.bookedCount).toBe(4);
      expect(evening!.remainingCapacity).toBe(6);
      expect(evening!.isAvailable).toBe(true);
    });

    it('should mark inactive slot with SLOT_INACTIVE', async () => {
      const mockSlots = [
        {
          _id: new Types.ObjectId(),
          slotKey: SlotKey.MORNING,
          label: 'Morning',
          timeWindow: '09:00 - 12:00',
          startTime: '09:00',
          endTime: '12:00',
          capacity: 10,
          bookedCount: 0,
          cutoffHours: 2,
          isActive: false, // Inactive slot
          date: futureDate,
          serviceArea: 'ALL',
        },
      ];

      pickupSlotModel.find.mockResolvedValue(mockSlots);
      bookingModel.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const slots = await service.getAvailableSlots(futureDate, 'ALL', fixedNowMorning);
      const morning = slots.find((s) => s.slotKey === SlotKey.MORNING);

      expect(morning!.isAvailable).toBe(false);
      expect(morning!.unavailableReason).toBe('SLOT_INACTIVE');
    });
  });

  describe('Slot Management Helpers', () => {
    it('getSlotById should return slot document if found', async () => {
      const slotId = new Types.ObjectId();
      const mockDoc = { _id: slotId, label: 'Morning' };
      pickupSlotModel.findById.mockResolvedValue(mockDoc);

      const res = await service.getSlotById(slotId.toString());
      expect(res).toBe(mockDoc);
    });

    it('getSlotById should throw BadRequestException for invalid ObjectId', async () => {
      await expect(service.getSlotById('not-a-valid-id')).rejects.toThrow(BadRequestException);
    });

    it('getSlotById should throw NotFoundException if document does not exist', async () => {
      pickupSlotModel.findById.mockResolvedValue(null);
      const slotId = new Types.ObjectId();
      await expect(service.getSlotById(slotId.toString())).rejects.toThrow(NotFoundException);
    });

    it('reserveSlot should increment bookedCount and save', async () => {
      const slotId = new Types.ObjectId();
      const mockDoc = {
        _id: slotId,
        bookedCount: 2,
        capacity: 10,
        save: jest.fn().mockResolvedValue({ _id: slotId, bookedCount: 3 }),
      };
      pickupSlotModel.findById.mockResolvedValue(mockDoc);

      const updated = await service.reserveSlot(slotId.toString());
      expect(mockDoc.bookedCount).toBe(3);
      expect(mockDoc.save).toHaveBeenCalled();
      expect(updated.bookedCount).toBe(3);
    });

    it('reserveSlot should throw BadRequestException if capacity reached', async () => {
      const slotId = new Types.ObjectId();
      const mockDoc = {
        _id: slotId,
        bookedCount: 10,
        capacity: 10,
        save: jest.fn(),
      };
      pickupSlotModel.findById.mockResolvedValue(mockDoc);

      await expect(service.reserveSlot(slotId.toString())).rejects.toThrow(
        new BadRequestException('Slot capacity has already been reached'),
      );
    });

    it('releaseSlot should decrement bookedCount and save', async () => {
      const slotId = new Types.ObjectId();
      const mockDoc = {
        _id: slotId,
        bookedCount: 3,
        save: jest.fn().mockResolvedValue({ _id: slotId, bookedCount: 2 }),
      };
      pickupSlotModel.findById.mockResolvedValue(mockDoc);

      const updated = await service.releaseSlot(slotId.toString());
      expect(mockDoc.bookedCount).toBe(2);
      expect(mockDoc.save).toHaveBeenCalled();
      expect(updated.bookedCount).toBe(2);
    });
  });
});
