import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { AddressesController } from '../src/addresses/addresses.controller';
import { AddressesService } from '../src/addresses/addresses.service';
import { ProfileController } from '../src/profile/profile.controller';
import { ProfileService } from '../src/profile/profile.service';
import { Address } from '../src/database/schemas/address.schema';
import { User } from '../src/database/schemas/user.schema';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { OrderActorRole } from '../src/orders/order-status.enum';

describe('Addresses & Profile (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let addressModel: any;
  let userModel: any;

  const userAId = new Types.ObjectId();
  const userBId = new Types.ObjectId();

  const userA = {
    _id: userAId,
    phone: '+919718312383',
    name: 'Customer A',
    email: 'customera@atelier.in',
    avatar: 'https://cdn.atelier.in/avatar-a.png',
    role: OrderActorRole.CUSTOMER,
    isActive: true,
    createdAt: new Date(),
    save: jest.fn().mockResolvedValue(true),
  };

  const userB = {
    _id: userBId,
    phone: '+919999999999',
    name: 'Customer B',
    email: 'customerb@atelier.in',
    avatar: 'https://cdn.atelier.in/avatar-b.png',
    role: OrderActorRole.CUSTOMER,
    isActive: true,
    createdAt: new Date(),
    save: jest.fn().mockResolvedValue(true),
  };

  let tokenUserA: string;
  let tokenUserB: string;

  beforeAll(async () => {
    addressModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    };

    userModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              jwt: {
                secret: 'atelier_e2e_jwt_secret',
                expiresIn: '1h',
              },
            }),
          ],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'atelier_e2e_jwt_secret',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [AddressesController, ProfileController],
      providers: [
        AddressesService,
        ProfileService,
        JwtStrategy,
        { provide: getModelToken(Address.name), useValue: addressModel },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    tokenUserA = jwtService.sign({
      sub: userAId.toString(),
      phone: userA.phone,
      role: userA.role,
    });
    tokenUserB = jwtService.sign({
      sub: userBId.toString(),
      phone: userB.phone,
      role: userB.role,
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    userModel.findById.mockImplementation((id: Types.ObjectId | string) => ({
      exec: jest
        .fn()
        .mockResolvedValue(
          id.toString() === userAId.toString()
            ? userA
            : id.toString() === userBId.toString()
              ? userB
              : null,
        ),
    }));
  });

  describe('Address Book Management (IDOR & Defaults)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer()).get('/v1/addresses').expect(HttpStatus.UNAUTHORIZED);

      await request(app.getHttpServer())
        .post('/v1/addresses')
        .send({
          street: 'Shop No. G-246, 40 Foota Road',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110044',
        })
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('creates first address and automatically designates it as default', async () => {
      addressModel.countDocuments.mockResolvedValue(0);
      const mockCreatedAddress = {
        _id: new Types.ObjectId(),
        userId: userAId,
        label: 'Home',
        street: 'Shop No. G-246, 40 Foota Road, Molarband Ext.',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110044',
        isDefault: true,
      };
      addressModel.create.mockResolvedValue(mockCreatedAddress);

      const res = await request(app.getHttpServer())
        .post('/v1/addresses')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          street: 'Shop No. G-246, 40 Foota Road, Molarband Ext.',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110044',
        })
        .expect(HttpStatus.CREATED);

      expect(res.body.isDefault).toBe(true);
      expect(addressModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: userAId,
          isDefault: true,
          label: 'Home',
        }),
      );
    });

    it('lists only addresses belonging to the authenticated user', async () => {
      const userAddresses = [
        {
          _id: new Types.ObjectId(),
          userId: userAId,
          street: 'Shop No. G-246',
          pincode: '110044',
          isDefault: true,
        },
      ];

      addressModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(userAddresses),
        }),
      });

      const res = await request(app.getHttpServer())
        .get('/v1/addresses')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(res.body).toHaveLength(1);
      expect(addressModel.find).toHaveBeenCalledWith({ userId: userAId });
    });

    it('enforces IDOR prevention: User B cannot modify User A address', async () => {
      const addressAId = new Types.ObjectId();
      // Address belongs to User A, so querying with User B returns null
      addressModel.findOne.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .patch(`/v1/addresses/${addressAId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ label: 'Hacked Label' })
        .expect(HttpStatus.NOT_FOUND);

      expect(res.body.message).toContain('Address not found or does not belong');
      expect(addressModel.findOne).toHaveBeenCalledWith({
        _id: addressAId,
        userId: userBId,
      });
    });

    it('enforces IDOR prevention: User B cannot delete User A address', async () => {
      const addressAId = new Types.ObjectId();
      addressModel.findOne.mockResolvedValue(null);

      await request(app.getHttpServer())
        .delete(`/v1/addresses/${addressAId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(HttpStatus.NOT_FOUND);

      expect(addressModel.findOne).toHaveBeenCalledWith({
        _id: addressAId,
        userId: userBId,
      });
    });

    it('deletes address and auto-promotes remaining address when default was removed', async () => {
      const addressId = new Types.ObjectId();
      const remainingAddressId = new Types.ObjectId();

      const mockTarget = {
        _id: addressId,
        userId: userAId,
        isDefault: true,
        deleteOne: jest.fn().mockResolvedValue(true),
      };

      const mockRemaining = {
        _id: remainingAddressId,
        userId: userAId,
        isDefault: false,
        save: jest.fn().mockResolvedValue(true),
      };

      addressModel.findOne
        .mockResolvedValueOnce(mockTarget) // delete target
        .mockReturnValueOnce({
          sort: jest.fn().mockResolvedValue(mockRemaining), // remaining candidate
        });

      const res = await request(app.getHttpServer())
        .delete(`/v1/addresses/${addressId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(mockTarget.deleteOne).toHaveBeenCalled();
      expect(mockRemaining.isDefault).toBe(true);
      expect(mockRemaining.save).toHaveBeenCalled();
    });
  });

  describe('Customer Profile Management', () => {
    it('rejects unauthenticated profile access with 401', async () => {
      await request(app.getHttpServer()).get('/v1/profile').expect(HttpStatus.UNAUTHORIZED);

      await request(app.getHttpServer())
        .patch('/v1/profile')
        .send({ name: 'Hacker' })
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('retrieves authenticated customer profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/profile')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(res.body.id).toBe(userAId.toString());
      expect(res.body.phone).toBe('+919718312383');
      expect(res.body.name).toBe('Customer A');
      expect(res.body.email).toBe('customera@atelier.in');
      expect(res.body.role).toBe(OrderActorRole.CUSTOMER);
    });

    it('updates customer profile details with valid payload', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/profile')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          name: 'Atelier Premium Patron',
          email: 'patron@thedryxclean.com',
          avatar: 'https://thedryxclean.com/assets/patron.png',
        })
        .expect(HttpStatus.OK);

      expect(res.body.name).toBe('Atelier Premium Patron');
      expect(res.body.email).toBe('patron@thedryxclean.com');
      expect(userA.save).toHaveBeenCalled();
    });

    it('rejects invalid email format with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/profile')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ email: 'not-an-email' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('Please provide a valid email address.')]),
      );
    });
  });
});
