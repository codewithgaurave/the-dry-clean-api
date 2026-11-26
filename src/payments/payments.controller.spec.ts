import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentIntentResponseDto } from './dto/payment-intent-response.dto';
import { PaymentGateway, PaymentStatus } from '../database/schemas/payment.schema';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  const mockIntentResponse: PaymentIntentResponseDto = {
    paymentId: '66fa3b5b1a2c3d4e5f678999',
    orderId: 'TC402736',
    gateway: PaymentGateway.MOCK,
    gatewayOrderId: 'order_mock_TC402736_1730000000',
    amountMinor: 74340,
    amountFormatted: '₹743.40',
    currency: 'INR',
    keyId: 'rzp_test_mock_atelier_key',
    status: PaymentStatus.INITIATED,
    paymentMethod: 'UPI',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const mockPaymentsService = {
      createPaymentIntent: jest.fn().mockResolvedValue(mockIntentResponse),
      processWebhook: jest.fn().mockResolvedValue({
        received: true,
        status: 'processed',
        orderId: 'TC402736',
        paymentStatus: PaymentStatus.SUCCESSFUL,
      }),
      getPaymentById: jest.fn(),
      getPaymentsByOrderId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('createPaymentIntent', () => {
    it('should delegate to paymentsService with dto, user, and idempotency key', async () => {
      const dto: CreatePaymentIntentDto = { orderId: 'TC402736', paymentMethod: 'UPI' };
      const user = { _id: 'user_123' };
      const idempotencyKey = 'key_abc';

      const result = await controller.createPaymentIntent(dto, user, idempotencyKey);

      expect(result).toBe(mockIntentResponse);
      expect(service.createPaymentIntent).toHaveBeenCalledWith(dto, user, idempotencyKey);
    });
  });

  describe('handleWebhook (TASK-027)', () => {
    it('should extract signature header, raw body, and delegate to processWebhook', async () => {
      const payload = { event: 'payment.captured', orderId: 'TC402736' };
      const signature = 'test_signature';
      const req = { rawBody: Buffer.from(JSON.stringify(payload)) };

      const result = await controller.handleWebhook(payload, signature, undefined, undefined, req);

      expect(result).toBeDefined();
      expect(result.received).toBe(true);
      expect(result.status).toBe('processed');
      expect(service.processWebhook).toHaveBeenCalledWith(req.rawBody, signature);
    });

    it('should fallback to parsed body if req.rawBody is missing', async () => {
      const payload = { event: 'payment.captured', orderId: 'TC402736' };
      const signature = 'custom_sig';

      await controller.handleWebhook(payload, undefined, signature, undefined, undefined);

      expect(service.processWebhook).toHaveBeenCalledWith(payload, signature);
    });
  });

  describe('getPaymentById', () => {
    it('should return payment record when found', async () => {
      const mockDoc = { _id: '66fa3b5b1a2c3d4e5f678999', orderId: 'TC402736' };
      (service.getPaymentById as jest.Mock).mockResolvedValue(mockDoc);

      const result = await controller.getPaymentById('66fa3b5b1a2c3d4e5f678999');
      expect(result).toBe(mockDoc);
    });

    it('should throw NotFoundException when payment not found', async () => {
      (service.getPaymentById as jest.Mock).mockResolvedValue(null);

      await expect(controller.getPaymentById('66fa3b5b1a2c3d4e5f678999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPaymentsByOrderId', () => {
    it('should return list of payments for order', async () => {
      const list = [mockIntentResponse];
      (service.getPaymentsByOrderId as jest.Mock).mockResolvedValue(list);

      const result = await controller.getPaymentsByOrderId('TC402736');
      expect(result).toBe(list);
      expect(service.getPaymentsByOrderId).toHaveBeenCalledWith('TC402736');
    });
  });
});
