import { Injectable, NotFoundException, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationStatus,
  NotificationType,
} from '../database/schemas/notification.schema';
import { User, UserDocument } from '../database/schemas/user.schema';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import { FcmService } from './fcm.service';
import { StorageService } from '../storage/storage.service';
import { OutboxWorkerService } from '../outbox/outbox-worker.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

export interface PaginatedNotificationsResult {
  notifications: NotificationDocument[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * NotificationsService:
 * Manages in-app notification inbox, device token registration,
 * and push notification dispatches triggered by outbox status transitions.
 * Source of truth: PRD.md §6.9 (FR-NTF-1, FR-NTF-2), §6.12.3; TECH_STACK.md §4.1; TODO.md TASK-044.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly fcmService: FcmService,
    @Optional()
    private readonly storageService?: StorageService,
    @Optional()
    private readonly outboxWorkerService?: OutboxWorkerService,
  ) {}

  onModuleInit() {
    if (this.outboxWorkerService) {
      this.outboxWorkerService.registerHandler('ORDER_STATUS_CHANGED', async (payload: any) => {
        try {
          if (payload && payload.orderId && payload.status) {
            await this.dispatchOrderStatusNotification(
              payload.orderId,
              payload.status,
              payload.proofUrl,
            );
          }
        } catch (err: any) {
          this.logger.error(`Error processing outbox ORDER_STATUS_CHANGED: ${err?.message}`);
        }
      });
      this.logger.log('Subscribed NotificationsService to outbox event: ORDER_STATUS_CHANGED');
    }
  }

  /**
   * Retrieves paginated notifications strictly for the authenticated customer.
   */
  async getUserNotifications(
    userId: string | Types.ObjectId,
    query: ListNotificationsQueryDto = {},
  ): Promise<PaginatedNotificationsResult> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const filter: any = { userId: userObjectId };

    if (query.status && query.status.trim().toUpperCase() !== 'ALL') {
      filter.status = query.status.trim().toUpperCase();
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      this.notificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.notificationModel.countDocuments(filter).exec(),
      this.notificationModel
        .countDocuments({ userId: userObjectId, status: NotificationStatus.UNREAD })
        .exec(),
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Marks a specific notification as READ. Enforces customer tenancy.
   */
  async markAsRead(
    userId: string | Types.ObjectId,
    notificationId: string,
  ): Promise<NotificationDocument> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const notification = await this.notificationModel
      .findOne({ _id: new Types.ObjectId(notificationId), userId: userObjectId })
      .exec();

    if (!notification) {
      throw new NotFoundException(`Notification '${notificationId}' not found or unauthorized.`);
    }

    notification.status = NotificationStatus.READ;
    return notification.save();
  }

  /**
   * Marks all unread notifications as READ for the user.
   */
  async markAllAsRead(userId: string | Types.ObjectId): Promise<{ modifiedCount: number }> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const result = await this.notificationModel
      .updateMany(
        { userId: userObjectId, status: NotificationStatus.UNREAD },
        { $set: { status: NotificationStatus.READ } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Registers or refreshes the customer's FCM device token for push dispatches.
   */
  async registerDeviceToken(
    userId: string | Types.ObjectId,
    dto: RegisterDeviceTokenDto,
  ): Promise<{ success: boolean }> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    await this.userModel
      .updateOne(
        { _id: userObjectId },
        {
          $set: {
            fcmToken: dto.token.trim(),
            devicePlatform: dto.platform || 'android',
          },
        },
      )
      .exec();

    this.logger.log(`Registered device token for user '${userObjectId}'.`);
    return { success: true };
  }

  /**
   * Dispatches both an in-app Notification record and an FCM push notification
   * when key order status changes occur.
   */
  async dispatchOrderStatusNotification(
    orderId: string,
    status: string,
    proofUrl?: string,
  ): Promise<NotificationDocument | null> {
    const order = await this.orderModel.findOne({ orderId }).exec();
    if (!order) {
      this.logger.warn(`Cannot dispatch notification: Order '${orderId}' not found.`);
      return null;
    }

    const user = await this.userModel.findById(order.userId).exec();
    if (!user) {
      this.logger.warn(`Cannot dispatch notification: User '${order.userId}' not found.`);
      return null;
    }

    const { title, body, type } = this.getNotificationContentForStatus(status, order.orderId);

    // Create in-app notification record
    const notification = await this.notificationModel.create({
      userId: user._id,
      orderId: order.orderId,
      orderRef: order._id,
      title,
      body,
      type,
      status: NotificationStatus.UNREAD,
      actionUrl: `/orders/${order.orderId}`,
      proofUrl,
      metadata: {
        status,
        timestamp: new Date().toISOString(),
      },
    });

    // Dispatch FCM push notification if customer registered a device token
    if (user.fcmToken) {
      const pushResult = await this.fcmService.sendPush({
        token: user.fcmToken,
        title,
        body,
        data: {
          orderId: order.orderId,
          status,
          notificationId: notification._id.toString(),
          actionUrl: `/orders/${order.orderId}`,
          proofUrl: proofUrl || '',
        },
      });

      if (pushResult.success) {
        notification.isPushSent = true;
        notification.pushSentAt = new Date();
        await notification.save();
      } else {
        notification.pushError = pushResult.error;
        await notification.save();
      }
    }

    return notification;
  }

  private getNotificationContentForStatus(status: string, orderId: string) {
    switch (status.toUpperCase()) {
      case 'PICKUP_SCHEDULED':
        return {
          title: 'Valet Assigned for Collection',
          body: `Your dry cleaning collection for order #${orderId} is confirmed. Our valet will arrive during your scheduled window.`,
          type: NotificationType.VALET_DISPATCH,
        };
      case 'PICKED_UP':
        return {
          title: 'Garments Collected',
          body: `Order #${orderId} has been safely collected and is en route to our master garment care atelier.`,
          type: NotificationType.ORDER_STATUS,
        };
      case 'RECEIVED_AT_FACILITY':
        return {
          title: 'Arrived at Care Atelier',
          body: `Your garments for order #${orderId} have arrived at our facility for fabric inspection.`,
          type: NotificationType.ORDER_STATUS,
        };
      case 'CLEANING_IN_PROGRESS':
        return {
          title: 'Artisanal Care in Progress',
          body: `Master dry cleaners are performing bespoke treatment on order #${orderId}.`,
          type: NotificationType.ORDER_STATUS,
        };
      case 'QUALITY_CHECK':
        return {
          title: 'Quality Inspection',
          body: `Order #${orderId} is undergoing hand-pressing and rigorous quality check.`,
          type: NotificationType.ORDER_STATUS,
        };
      case 'READY_FOR_DELIVERY':
        return {
          title: 'Ready for Dispatch',
          body: `Order #${orderId} is packaged in breathable garment bags and ready for delivery return.`,
          type: NotificationType.ORDER_STATUS,
        };
      case 'OUT_FOR_DELIVERY':
        return {
          title: 'Out for Delivery',
          body: `Our valet courier is en route to return your impeccably cared garments for order #${orderId}.`,
          type: NotificationType.VALET_DISPATCH,
        };
      case 'DELIVERED':
        return {
          title: 'Garments Delivered',
          body: `Order #${orderId} has been safely delivered. View your photographic proof in the app.`,
          type: NotificationType.PROOF_AVAILABLE,
        };
      default:
        return {
          title: `Order Update: #${orderId}`,
          body: `Your order status has updated to ${status.replace(/_/g, ' ')}.`,
          type: NotificationType.ORDER_STATUS,
        };
    }
  }
}
