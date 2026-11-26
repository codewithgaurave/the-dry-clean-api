import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { Service, ServicePrice } from '../database/schemas/service.schema';
import { Coupon, CouponDiscountType } from '../database/schemas/coupon.schema';

describe('PricingService', () => {
  let pricingService: PricingService;
  let serviceModel: any;
  let servicePriceModel: any;
  let couponModel: any;

  const mockServiceId = new Types.ObjectId();
  const mockServiceDoc = {
    _id: mockServiceId,
    name: 'Dry Cleaning',
    active: true,
  };

  const mockSuitPrice = {
    _id: new Types.ObjectId(),
    serviceId: mockServiceId,
    itemType: "Men's Suit (2-Piece)",
    amountMinor: 35000, // ₹350.00
    unit: 'piece',
    package: 'Standard',
    active: true,
    isAddon: false,
  };

  const mockShirtPrice = {
    _id: new Types.ObjectId(),
    serviceId: mockServiceId,
    itemType: 'Formal Shirt',
    amountMinor: 9000, // ₹90.00
    unit: 'piece',
    package: 'Standard',
    active: true,
    isAddon: false,
  };

  const mockAddonStain = {
    _id: new Types.ObjectId(),
    serviceId: mockServiceId,
    itemType: 'Stain Treatment',
    amountMinor: 10000, // ₹100.00
    unit: 'piece',
    active: true,
    isAddon: true,
  };

  beforeEach(async () => {
    serviceModel = {
      findOne: jest.fn(),
    };

    servicePriceModel = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    couponModel = {
      findOne: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(4),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: getModelToken(Service.name), useValue: serviceModel },
        { provide: getModelToken(ServicePrice.name), useValue: servicePriceModel },
        { provide: getModelToken(Coupon.name), useValue: couponModel },
      ],
    }).compile();

    pricingService = module.get<PricingService>(PricingService);
  });

  describe('calculateQuote', () => {
    it('throws BadRequestException when line items array is empty', async () => {
      await expect(pricingService.calculateQuote({ items: [] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calculates line item arithmetic with delivery fee below ₹500 and 18% GST', async () => {
      // Order: 1 Suit = ₹350.00 (35000 minor)
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceDoc),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSuitPrice),
      });

      const quote = await pricingService.calculateQuote({
        items: [
          {
            serviceId: mockServiceId.toString(),
            itemType: "Men's Suit (2-Piece)",
            quantity: 1,
            package: 'Standard',
          },
        ],
      });

      expect(quote.items).toHaveLength(1);
      expect(quote.items[0].totalPriceMinor).toBe(35000);
      expect(quote.items[0].unitPriceFormatted).toBe('₹350.00');

      const breakdown = quote.breakdown;
      expect(breakdown.itemsSubtotalMinor).toBe(35000);
      expect(breakdown.itemsSubtotalFormatted).toBe('₹350.00');

      // Delivery fee below ₹500 threshold
      expect(breakdown.isDeliveryFree).toBe(false);
      expect(breakdown.deliveryFeeMinor).toBe(5000); // ₹50.00
      expect(breakdown.deliveryFeeFormatted).toBe('₹50.00');

      // GST: 18% of 35000 = 6300 (₹63.00) -> CGST 3150, SGST 3150
      expect(breakdown.gstRate).toBe(18);
      expect(breakdown.taxableAmountMinor).toBe(35000);
      expect(breakdown.gstMinor).toBe(6300);
      expect(breakdown.gstFormatted).toBe('₹63.00');
      expect(breakdown.cgstMinor).toBe(3150);
      expect(breakdown.sgstMinor).toBe(3150);

      // Total = 35000 (subtotal) + 5000 (delivery) + 6300 (gst) = 46300 (₹463.00)
      expect(breakdown.totalAmountMinor).toBe(46300);
      expect(breakdown.totalAmountFormatted).toBe('₹463.00');
    });

    it('waives delivery fee for orders exceeding ₹500 threshold', async () => {
      // Order: 2 Suits = 2 * ₹350.00 = ₹700.00 (70000 minor)
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceDoc),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSuitPrice),
      });

      const quote = await pricingService.calculateQuote({
        items: [
          {
            serviceId: mockServiceId.toString(),
            itemType: "Men's Suit (2-Piece)",
            quantity: 2,
            package: 'Standard',
          },
        ],
      });

      const breakdown = quote.breakdown;
      expect(breakdown.itemsSubtotalMinor).toBe(70000);
      expect(breakdown.isDeliveryFree).toBe(true);
      expect(breakdown.deliveryFeeMinor).toBe(0);
      expect(breakdown.deliveryFeeFormatted).toBe('FREE');

      // GST: 18% of 70000 = 12600
      expect(breakdown.gstMinor).toBe(12600);
      // Total = 70000 + 0 + 12600 = 82600
      expect(breakdown.totalAmountMinor).toBe(82600);
      expect(breakdown.totalAmountFormatted).toBe('₹826.00');
    });

    it('accurately calculates add-on fees per quantity', async () => {
      // Order: 2 Shirts (₹90 each) + Stain treatment add-on (₹100 each)
      // Total line item: (2 * 90) + (2 * 100) = 180 + 200 = 380 (38000 minor)
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceDoc),
      });

      servicePriceModel.findOne
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(mockShirtPrice),
        })
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(mockAddonStain),
        });

      const quote = await pricingService.calculateQuote({
        items: [
          {
            serviceId: mockServiceId.toString(),
            itemType: 'Formal Shirt',
            quantity: 2,
            addonIds: [mockAddonStain._id.toString()],
          },
        ],
      });

      expect(quote.items[0].addons).toHaveLength(1);
      expect(quote.items[0].addons[0].unitPriceMinor).toBe(10000);
      expect(quote.items[0].addons[0].totalPriceMinor).toBe(20000);
      expect(quote.items[0].totalPriceMinor).toBe(38000);
      expect(quote.breakdown.itemsSubtotalMinor).toBe(38000);
    });

    it('applies percentage coupon with maximum discount cap', async () => {
      // Subtotal ₹700 (70000 minor).
      // WELCOME10: 10% off (7000 minor), capped at ₹150 (15000 minor).
      // Here 10% = 7000 < 15000, so discount is 7000 (₹70.00).
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceDoc),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSuitPrice),
      });

      couponModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          code: 'WELCOME10',
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 10,
          maxDiscountMinor: 15000,
          minOrderValueMinor: 30000,
          active: true,
        }),
      });

      const quote = await pricingService.calculateQuote({
        items: [
          {
            serviceId: mockServiceId.toString(),
            itemType: "Men's Suit (2-Piece)",
            quantity: 2,
          },
        ],
        couponCode: 'welcome10',
      });

      const breakdown = quote.breakdown;
      expect(breakdown.couponApplied).toBe(true);
      expect(breakdown.couponCode).toBe('WELCOME10');
      expect(breakdown.discountMinor).toBe(7000);
      expect(breakdown.discountFormatted).toBe('₹70.00');

      // Taxable = 70000 - 7000 = 63000
      expect(breakdown.taxableAmountMinor).toBe(63000);
      // GST: 18% of 63000 = 11340
      expect(breakdown.gstMinor).toBe(11340);
      // Total = 63000 + 0 + 11340 = 74340
      expect(breakdown.totalAmountMinor).toBe(74340);
      expect(breakdown.totalAmountFormatted).toBe('₹743.40');
    });

    it('applies flat discount coupon correctly', async () => {
      // Subtotal ₹700 (70000 minor).
      // FLAT100: Flat ₹100 discount (10000 minor).
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceDoc),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSuitPrice),
      });

      couponModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          code: 'FLAT100',
          discountType: CouponDiscountType.FLAT,
          discountValue: 10000,
          minOrderValueMinor: 50000,
          active: true,
        }),
      });

      const quote = await pricingService.calculateQuote({
        items: [
          {
            serviceId: mockServiceId.toString(),
            itemType: "Men's Suit (2-Piece)",
            quantity: 2,
          },
        ],
        couponCode: 'FLAT100',
      });

      const breakdown = quote.breakdown;
      expect(breakdown.couponApplied).toBe(true);
      expect(breakdown.discountMinor).toBe(10000);
      expect(breakdown.discountFormatted).toBe('₹100.00');
    });

    it('rejects coupon when subtotal does not meet minimum order threshold', async () => {
      // Subtotal ₹350 (35000 minor).
      // FLAT100 requires min order ₹500 (50000 minor).
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceDoc),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSuitPrice),
      });

      couponModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          code: 'FLAT100',
          discountType: CouponDiscountType.FLAT,
          discountValue: 10000,
          minOrderValueMinor: 50000,
          active: true,
        }),
      });

      const quote = await pricingService.calculateQuote({
        items: [
          {
            serviceId: mockServiceId.toString(),
            itemType: "Men's Suit (2-Piece)",
            quantity: 1,
          },
        ],
        couponCode: 'FLAT100',
      });

      const breakdown = quote.breakdown;
      expect(breakdown.couponApplied).toBe(false);
      expect(breakdown.discountMinor).toBe(0);
      expect(breakdown.couponMessage).toContain('Minimum order value of ₹500.00 required');
    });

    it('handles invalid or expired coupon code gracefully', async () => {
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceDoc),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSuitPrice),
      });

      couponModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const quote = await pricingService.calculateQuote({
        items: [
          {
            serviceId: mockServiceId.toString(),
            itemType: "Men's Suit (2-Piece)",
            quantity: 1,
          },
        ],
        couponCode: 'INVALIDCODE',
      });

      expect(quote.breakdown.couponApplied).toBe(false);
      expect(quote.breakdown.couponMessage).toContain('Invalid or expired coupon code');
    });
  });
});
