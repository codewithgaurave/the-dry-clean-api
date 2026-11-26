import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationStatus,
  NotificationType,
} from '../database/schemas/notification.schema';
import { User } from '../database/schemas/user.schema';
import { Order } from '../database/schemas/order.schema';
import { FcmService } from './fcm.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockNotificationModel: any;
  let mockUserModel: any;
  let mockOrderModel: any;
  let mockFcmService: any;

  const mockUserId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678901');

  beforeEach(async () => {
    mockNotificationModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    };

    mockUserModel = {
      findById: jest.fn(),
      updateOne: jest.fn(),
    };

    mockOrderModel = {
      findOne: jest.fn(),
    };

    mockFcmService = {
      sendPush: jest.fn().mockResolvedValue({ success: true, messageId: 'sim_123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getModelToken(Notification.name),
          useValue: mockNotificationModel,
        },
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Order.name),
          useValue: mockOrderModel,
        },
        {
          provide: FcmService,
          useValue: mockFcmService,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('getUserNotifications', () => {
    it('returns paginated notifications and calculates unread count', async () => {
      const mockNotifList = [
        {
          _id: new Types.ObjectId(),
          userId: mockUserId,
          title: 'Garments Collected',
          status: NotificationStatus.UNREAD,
        },
      ];

      const mockQueryChain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockNotifList),
      };

      mockNotificationModel.find.mockReturnValue(mockQueryChain);
      mockNotificationModel.countDocuments
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(1) }) // total
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(1) }); // unreadCount

      const res = await service.getUserNotifications(mockUserId, { page: 1, limit: 10 });

      expect(res.notifications).toEqual(mockNotifList);
      expect(res.total).toBe(1);
      expect(res.unreadCount).toBe(1);
      expect(mockNotificationModel.find).toHaveBeenCalledWith({ userId: mockUserId });
    });
  });

  describe('markAsRead', () => {
    it('marks notification as read when owned by user', async () => {
      const notifId = new Types.ObjectId();
      const mockNotif = {
        _id: notifId,
        userId: mockUserId,
        status: NotificationStatus.UNREAD,
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };

      mockNotificationModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockNotif),
      });

      const res = await service.markAsRead(mockUserId, notifId.toString());

      expect(res.status).toBe(NotificationStatus.READ);
      expect(mockNotif.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when notification does not belong to user', async () => {
      mockNotificationModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.markAsRead(mockUserId, new Types.ObjectId().toString())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('updates all unread notifications to read for customer', async () => {
      mockNotificationModel.updateMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
      });

      const res = await service.markAllAsRead(mockUserId);

      expect(res.modifiedCount).toBe(3);
      expect(mockNotificationModel.updateMany).toHaveBeenCalledWith(
        { userId: mockUserId, status: NotificationStatus.UNREAD },
        { $set: { status: NotificationStatus.READ } },
      );
    });
  });

  describe('registerDeviceToken', () => {
    it('updates customer fcmToken and devicePlatform', async () => {
      mockUserModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      });

      const res = await service.registerDeviceToken(mockUserId, {
        token: 'fcm_token_xyz',
        platform: 'ios',
      });

      expect(res.success).toBe(true);
      expect(mockUserModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId },
        { $set: { fcmToken: 'fcm_token_xyz', devicePlatform: 'ios' } },
      );
    });
  });

  describe('dispatchOrderStatusNotification', () => {
    it('creates in-app notification and dispatches FCM push when customer has fcmToken', async () => {
      const mockOrder = {
        orderId: 'TC402738',
        _id: new Types.ObjectId(),
        userId: mockUserId,
      };

      const mockUser = {
        _id: mockUserId,
        name: 'Aditya Sharma',
        fcmToken: 'customer_fcm_token_123',
      };

      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockOrder),
      });

      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser),
      });

      const createdNotif: any = {
        _id: new Types.ObjectId(),
        orderId: 'TC402738',
        title: 'Garments Delivered',
        body: 'Your garments have been safely delivered.',
        isPushSent: false,
        save: jest.fn().mockResolvedValue(true),
      };
      mockNotificationModel.create.mockResolvedValue(createdNotif);

      const res = await service.dispatchOrderStatusNotification(
        'TC402738',
        'DELIVERED',
        'https://s3.example.com/proof.jpg',
      );

      expect(res).toBeDefined();
      expect(mockNotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          orderId: 'TC402738',
          type: NotificationType.PROOF_AVAILABLE,
        }),
      );
      expect(mockFcmService.sendPush).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'customer_fcm_token_123',
          title: 'Garments Delivered',
        }),
      );
      expect(createdNotif.isPushSent).toBe(true);
      expect(createdNotif.save).toHaveBeenCalled();
    });
  });
});
