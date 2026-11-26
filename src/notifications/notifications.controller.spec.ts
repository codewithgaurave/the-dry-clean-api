import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { UserDocument } from '../database/schemas/user.schema';
import { Types } from 'mongoose';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: jest.Mocked<Partial<NotificationsService>>;

  const mockUser = {
    _id: new Types.ObjectId(),
    phone: '+919876543210',
    name: 'Aditya Sharma',
  } as unknown as UserDocument;

  beforeEach(async () => {
    service = {
      getUserNotifications: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
      registerDeviceToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('listNotifications delegates to service with user tenancy', async () => {
    const mockResult = {
      notifications: [{ id: 'notif_1', title: 'Valet Assigned' }] as any,
      total: 1,
      unreadCount: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };
    (service.getUserNotifications as jest.Mock).mockResolvedValue(mockResult);

    const query = { status: 'UNREAD', page: 1, limit: 10 };
    const res = await controller.listNotifications(mockUser, query);

    expect(service.getUserNotifications).toHaveBeenCalledWith(mockUser._id, query);
    expect(res).toEqual(mockResult);
  });

  it('markAsRead updates notification state', async () => {
    const mockNotif = { id: 'notif_1', status: 'READ' } as any;
    (service.markAsRead as jest.Mock).mockResolvedValue(mockNotif);

    const res = await controller.markAsRead(mockUser, 'notif_1');

    expect(service.markAsRead).toHaveBeenCalledWith(mockUser._id, 'notif_1');
    expect(res).toEqual(mockNotif);
  });

  it('markAllAsRead clears unread counter', async () => {
    (service.markAllAsRead as jest.Mock).mockResolvedValue({ modifiedCount: 5 });

    const res = await controller.markAllAsRead(mockUser);

    expect(service.markAllAsRead).toHaveBeenCalledWith(mockUser._id);
    expect(res).toEqual({ modifiedCount: 5 });
  });

  it('registerDeviceToken registers customer FCM token', async () => {
    (service.registerDeviceToken as jest.Mock).mockResolvedValue({ success: true });

    const dto = { token: 'fcm_token_12345', platform: 'android' };
    const res = await controller.registerDeviceToken(mockUser, dto);

    expect(service.registerDeviceToken).toHaveBeenCalledWith(mockUser._id, dto);
    expect(res).toEqual({ success: true });
  });
});
