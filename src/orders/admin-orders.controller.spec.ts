import { Test, TestingModule } from '@nestjs/testing';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersService } from './orders.service';
import { OrderStatus, OrderActorRole } from './order-status.enum';
import { TaskType } from '../database/schemas/delivery-task.schema';
import { UserDocument } from '../database/schemas/user.schema';

describe('AdminOrdersController', () => {
  let controller: AdminOrdersController;
  let ordersService: jest.Mocked<Partial<OrdersService>>;

  const mockAdminUser = {
    _id: 'usr_admin_001',
    name: 'Aditya Sharma',
    phone: '+919876543210',
    role: OrderActorRole.ADMIN,
  } as unknown as UserDocument;

  const mockOpsUser = {
    _id: 'usr_ops_001',
    name: 'Rajesh Kumar',
    phone: '+919811122334',
    role: OrderActorRole.OPERATIONS,
  } as unknown as UserDocument;

  beforeEach(async () => {
    ordersService = {
      listAdminOrders: jest.fn(),
      getAdminOrderById: jest.fn(),
      updateOrderStatusByAdmin: jest.fn(),
      assignOrderTaskByAdmin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminOrdersController],
      providers: [{ provide: OrdersService, useValue: ordersService }],
    }).compile();

    controller = module.get<AdminOrdersController>(AdminOrdersController);
  });

  describe('listOrders', () => {
    it('delegates query to ordersService.listAdminOrders', async () => {
      const mockResult = {
        orders: [{ orderId: 'TC402736', status: OrderStatus.CLEANING_IN_PROGRESS }] as any,
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      (ordersService.listAdminOrders as jest.Mock).mockResolvedValue(mockResult);

      const query = { status: 'CLEANING_IN_PROGRESS', page: 1, limit: 10 };
      const res = await controller.listOrders(query);

      expect(ordersService.listAdminOrders).toHaveBeenCalledWith(query);
      expect(res).toEqual(mockResult);
    });
  });

  describe('getOrderById', () => {
    it('delegates to ordersService.getAdminOrderById', async () => {
      const mockDetail = {
        order: { orderId: 'TC402736', status: OrderStatus.ASSESSMENT } as any,
        tasks: [],
        events: [],
      };
      (ordersService.getAdminOrderById as jest.Mock).mockResolvedValue(mockDetail);

      const res = await controller.getOrderById('TC402736');

      expect(ordersService.getAdminOrderById).toHaveBeenCalledWith('TC402736');
      expect(res).toEqual(mockDetail);
    });
  });

  describe('updateOrderStatus', () => {
    it('delegates status update to ordersService.updateOrderStatusByAdmin with user context', async () => {
      const mockUpdated = {
        order: { orderId: 'TC402736', status: OrderStatus.QUALITY_CHECK } as any,
        event: { status: OrderStatus.QUALITY_CHECK } as any,
      };
      (ordersService.updateOrderStatusByAdmin as jest.Mock).mockResolvedValue(mockUpdated);

      const dto = {
        status: OrderStatus.QUALITY_CHECK,
        note: 'Quality check passed with flying colors.',
      };

      const res = await controller.updateOrderStatus('TC402736', dto, mockOpsUser);

      expect(ordersService.updateOrderStatusByAdmin).toHaveBeenCalledWith(
        'TC402736',
        OrderStatus.QUALITY_CHECK,
        mockOpsUser,
        'Quality check passed with flying colors.',
      );
      expect(res).toEqual(mockUpdated);
    });
  });

  describe('assignOrder', () => {
    it('delegates task assignment to ordersService.assignOrderTaskByAdmin', async () => {
      const mockTask = {
        taskId: 'TSK_P_402736_001',
        orderId: 'TC402736',
        agentId: 'usr_agent_001',
      } as any;
      (ordersService.assignOrderTaskByAdmin as jest.Mock).mockResolvedValue(mockTask);

      const dto = {
        agentId: 'usr_agent_001',
        taskType: TaskType.PICKUP,
      };

      const res = await controller.assignOrder('TC402736', dto, mockAdminUser);

      expect(ordersService.assignOrderTaskByAdmin).toHaveBeenCalledWith(
        'TC402736',
        dto,
        mockAdminUser,
      );
      expect(res).toEqual(mockTask);
    });
  });
});
