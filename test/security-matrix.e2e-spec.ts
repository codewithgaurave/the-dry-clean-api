import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';

import { AgentTasksController } from '../src/agent/agent-tasks.controller';
import { AgentTasksService } from '../src/agent/agent-tasks.service';
import { AdminOrdersController } from '../src/orders/admin-orders.controller';
import { AdminProofsController } from '../src/orders/admin-proofs.controller';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersService } from '../src/orders/orders.service';
import { ReconciliationController } from '../src/reconciliation/reconciliation.controller';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

import { User } from '../src/database/schemas/user.schema';
import { OrderActorRole } from '../src/orders/order-status.enum';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * End-to-End Security & Authorization Matrix Test Suite.
 * Source of truth: TECH_STACK.md §12.1, §12.2; PRD.md §16; TODO.md TASK-047.
 */
describe('Security & Authorization Matrix (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const customerAId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678901');
  const customerBId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678902');
  const agent1Id = new Types.ObjectId('66fa3b5b1a2c3d4e5f678903');
  const agent2Id = new Types.ObjectId('66fa3b5b1a2c3d4e5f678904');
  const opsId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678905');
  const adminId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678906');

  const usersMap: Record<string, any> = {
    [customerAId.toString()]: {
      _id: customerAId,
      name: 'Customer A',
      phone: '+919876543201',
      role: OrderActorRole.CUSTOMER,
      isActive: true,
    },
    [customerBId.toString()]: {
      _id: customerBId,
      name: 'Customer B',
      phone: '+919876543202',
      role: OrderActorRole.CUSTOMER,
      isActive: true,
    },
    [agent1Id.toString()]: {
      _id: agent1Id,
      name: 'Courier Agent 1',
      phone: '+919876543203',
      role: OrderActorRole.AGENT,
      isActive: true,
    },
    [agent2Id.toString()]: {
      _id: agent2Id,
      name: 'Courier Agent 2',
      phone: '+919876543204',
      role: OrderActorRole.AGENT,
      isActive: true,
    },
    [opsId.toString()]: {
      _id: opsId,
      name: 'Operations Manager',
      phone: '+919876543205',
      role: OrderActorRole.OPERATIONS,
      isActive: true,
    },
    [adminId.toString()]: {
      _id: adminId,
      name: 'Super Admin',
      phone: '+919876543206',
      role: OrderActorRole.ADMIN,
      isActive: true,
    },
  };

  let tokenCustomerA: string;
  let tokenAgent1: string;
  let tokenAgent2: string;
  let tokenOps: string;
  let tokenAdmin: string;

  let mockAgentTasksService: any;
  let mockOrdersService: any;
  let mockReconciliationService: any;

  beforeAll(async () => {
    mockAgentTasksService = {
      getAgentTasks: jest.fn().mockResolvedValue([]),
      getTaskById: jest.fn().mockResolvedValue({}),
      submitProof: jest.fn().mockImplementation((taskId, agent, files) => {
        // Zero photo check
        if (!files || files.length === 0) {
          throw new BadRequestException('MANDATORY_PROOF_PHOTO');
        }
        // Unassigned agent check
        if (agent._id.toString() !== agent1Id.toString()) {
          throw new ForbiddenException('UNASSIGNED_AGENT');
        }
        return Promise.resolve({
          success: true,
          taskId,
          orderId: 'TC402738',
          status: 'PICKED_UP',
        });
      }),
      recordFailedAttempt: jest.fn().mockResolvedValue({}),
    };

    mockOrdersService = {
      getCustomerOrderById: jest.fn().mockImplementation((userId, orderId) => {
        if (orderId === 'TC_ORDER_B' && userId.toString() === customerAId.toString()) {
          throw { status: HttpStatus.NOT_FOUND, message: 'Order not found or unauthorized' };
        }
        return Promise.resolve({ orderId: 'TC_ORDER_A', userId });
      }),
      getCustomerOrderProofs: jest.fn().mockImplementation((userId, orderId) => {
        if (orderId === 'TC_ORDER_B' && userId.toString() === customerAId.toString()) {
          throw { status: HttpStatus.NOT_FOUND, message: 'Order not found or unauthorized' };
        }
        return Promise.resolve([]);
      }),
      getAdminOrders: jest.fn().mockResolvedValue({ orders: [], total: 0 }),
      transitionOrderStatus: jest.fn().mockResolvedValue({}),
      reviewProof: jest.fn().mockResolvedValue({ success: true }),
    };

    mockReconciliationService = {
      reconcileProofInvariants: jest.fn().mockResolvedValue({
        scannedOrders: 5,
        anomaliesFound: 0,
        breaches: [],
      }),
      getAnomalies: jest.fn().mockResolvedValue([]),
      resolveAnomaly: jest.fn().mockResolvedValue({}),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ jwt: { secret: 'atelier_security_matrix_secret_key' } })],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'atelier_security_matrix_secret_key',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [
        AgentTasksController,
        AdminOrdersController,
        AdminProofsController,
        OrdersController,
        ReconciliationController,
      ],
      providers: [
        JwtStrategy,
        RolesGuard,
        { provide: AgentTasksService, useValue: mockAgentTasksService },
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: ReconciliationService, useValue: mockReconciliationService },
        {
          provide: getModelToken(User.name),
          useValue: {
            findById: jest.fn().mockImplementation((id) => ({
              exec: jest.fn().mockResolvedValue(usersMap[id.toString()]),
            })),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);

    tokenCustomerA = jwtService.sign({
      sub: customerAId.toString(),
      role: OrderActorRole.CUSTOMER,
    });
    tokenAgent1 = jwtService.sign({ sub: agent1Id.toString(), role: OrderActorRole.AGENT });
    tokenAgent2 = jwtService.sign({ sub: agent2Id.toString(), role: OrderActorRole.AGENT });
    tokenOps = jwtService.sign({ sub: opsId.toString(), role: OrderActorRole.OPERATIONS });
    tokenAdmin = jwtService.sign({ sub: adminId.toString(), role: OrderActorRole.ADMIN });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Customer Role Restrictions (RBAC Blockers)', () => {
    it('Customer attempting to list agent tasks is rejected with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/agent/tasks')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .expect(HttpStatus.FORBIDDEN);
    });

    it('Customer attempting to submit agent proof is rejected with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/agent/tasks/TSK_P_1/proof')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .expect(HttpStatus.FORBIDDEN);
    });

    it('Customer attempting to access Admin Orders table is rejected with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/admin/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .expect(HttpStatus.FORBIDDEN);
    });

    it('Customer attempting to review photo proofs in Admin is rejected with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/admin/proofs/PRF_1/review')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({ status: 'VERIFIED', reason: 'Customer attempt' })
        .expect(HttpStatus.FORBIDDEN);
    });

    it('Customer attempting to trigger proof reconciliation is rejected with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/admin/reconciliation/run')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .expect(HttpStatus.FORBIDDEN);
    });
  });

  describe('2. Multi-Tenant Customer Isolation', () => {
    it('Customer A cannot access Customer B order details (404/403 isolation)', async () => {
      await request(app.getHttpServer())
        .get('/orders/TC_ORDER_B')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('Customer A cannot access Customer B photo proofs (404/403 isolation)', async () => {
      await request(app.getHttpServer())
        .get('/orders/TC_ORDER_B/proofs')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('3. Agent Proof Rules & Assignment Integrity', () => {
    it('Agent submitting proof without photos is rejected with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/agent/tasks/TSK_P_1/proof')
        .set('Authorization', `Bearer ${tokenAgent1}`)
        .send({})
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('Unassigned Agent 2 submitting proof for Agent 1 task is rejected with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/agent/tasks/TSK_P_1/proof')
        .set('Authorization', `Bearer ${tokenAgent2}`)
        .attach('photos', Buffer.from('fake image bytes'), 'doorstep.jpg')
        .expect(HttpStatus.FORBIDDEN);
    });
  });

  describe('4. Operations & Admin Authorization Privileges', () => {
    it('Operations staff can query admin orders (200 OK)', async () => {
      await request(app.getHttpServer())
        .get('/admin/orders')
        .set('Authorization', `Bearer ${tokenOps}`)
        .expect(HttpStatus.OK);
    });

    it('Operations staff can trigger proof reconciliation cycle (200 OK)', async () => {
      await request(app.getHttpServer())
        .post('/admin/reconciliation/run')
        .set('Authorization', `Bearer ${tokenOps}`)
        .expect(HttpStatus.OK);
    });

    it('Super Admin can approve/review proof (200 OK)', async () => {
      await request(app.getHttpServer())
        .post('/admin/proofs/PRF_1/review')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'VERIFIED', reason: 'Doorstep framing confirmed' })
        .expect(HttpStatus.OK);
    });
  });
});
