import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Service,
  ServiceDocument,
  ServicePrice,
  ServicePriceDocument,
} from '../database/schemas/service.schema';

export interface FormattedServicePrice {
  id: string;
  itemType: string;
  package?: string;
  unit: string;
  amountMinor: number;
  amountFormatted: string;
  currency: string;
  isAddon: boolean;
  description?: string;
}

export interface FormattedServiceResponse {
  id: string;
  name: string;
  description?: string;
  category: string;
  icon?: string;
  turnaroundTime?: string;
  turnaroundHours: number;
  active: boolean;
  startingPriceMinor: number;
  startingPriceFormatted: string;
  items: FormattedServicePrice[];
  addons: FormattedServicePrice[];
  packages: string[];
}

/**
 * Service Catalogue & Pricing Service.
 * Manages service definitions, per-item/per-kg rates, add-ons, and package options.
 * Source of truth: PRD.md §6.3, §9.1; DESIGN.md §6.3; TODO.md TASK-017.
 */
@Injectable()
export class ServicesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ServicesService.name);

  constructor(
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(ServicePrice.name)
    private readonly servicePriceModel: Model<ServicePriceDocument>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedInitialCatalogue();
  }

  /**
   * List all active services along with their package options and price rates.
   * Can optionally filter by service category.
   */
  async listServices(category?: string): Promise<FormattedServiceResponse[]> {
    const filter: Record<string, any> = { active: true };
    if (category) {
      filter.category = category.toUpperCase();
    }

    const services = await this.serviceModel.find(filter).sort({ createdAt: 1 }).exec();

    const formattedList: FormattedServiceResponse[] = [];
    for (const svc of services) {
      const prices = await this.servicePriceModel
        .find({ serviceId: svc._id, active: true })
        .sort({ amountMinor: 1 })
        .exec();

      formattedList.push(this.formatServiceWithPrices(svc, prices));
    }

    return formattedList;
  }

  /**
   * Retrieve a single service by ID with all active prices and packages.
   */
  async getServiceById(id: string): Promise<FormattedServiceResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid service ID format.');
    }

    const service = await this.serviceModel
      .findOne({
        _id: new Types.ObjectId(id),
        active: true,
      })
      .exec();

    if (!service) {
      throw new NotFoundException(`Service with ID ${id} not found.`);
    }

    const prices = await this.servicePriceModel
      .find({ serviceId: service._id, active: true })
      .sort({ amountMinor: 1 })
      .exec();

    return this.formatServiceWithPrices(service, prices);
  }

  /**
   * Format service document and pricing documents into a coherent response contract.
   */
  private formatServiceWithPrices(
    service: ServiceDocument,
    prices: ServicePriceDocument[],
  ): FormattedServiceResponse {
    const items: FormattedServicePrice[] = [];
    const addons: FormattedServicePrice[] = [];
    const packageSet = new Set<string>();

    let minPriceMinor = Number.MAX_SAFE_INTEGER;

    for (const p of prices) {
      const formattedPrice: FormattedServicePrice = {
        id: p._id.toString(),
        itemType: p.itemType,
        package: p.package,
        unit: p.unit,
        amountMinor: p.amountMinor,
        amountFormatted: this.formatCurrencyMinor(p.amountMinor, p.currency),
        currency: p.currency,
        isAddon: p.isAddon ?? false,
        description: p.description,
      };

      if (p.package) {
        packageSet.add(p.package);
      }

      if (p.isAddon) {
        addons.push(formattedPrice);
      } else {
        items.push(formattedPrice);
        if (p.amountMinor < minPriceMinor) {
          minPriceMinor = p.amountMinor;
        }
      }
    }

    const startingPriceMinor = minPriceMinor === Number.MAX_SAFE_INTEGER ? 0 : minPriceMinor;

    return {
      id: service._id.toString(),
      name: service.name,
      description: service.description,
      category: service.category,
      icon: service.icon,
      turnaroundTime: service.turnaroundTime || `${service.turnaroundHours || 48} Hours`,
      turnaroundHours: service.turnaroundHours || 48,
      active: service.active,
      startingPriceMinor,
      startingPriceFormatted: this.formatCurrencyMinor(startingPriceMinor, 'INR'),
      items,
      addons,
      packages: Array.from(packageSet),
    };
  }

  private formatCurrencyMinor(amountMinor: number, currency: string): string {
    const amountMajor = (amountMinor / 100).toFixed(2);
    return currency === 'INR' ? `₹${amountMajor}` : `${currency} ${amountMajor}`;
  }

  /**
   * Idempotent seed function for "The Dry X Clean" service catalogue.
   * Runs on application startup if the services collection is empty.
   */
  async seedInitialCatalogue(): Promise<void> {
    try {
      const existingCount = await this.serviceModel.countDocuments();
      if (existingCount > 0) {
        this.logger.log(`Service catalogue already seeded (${existingCount} services exist).`);
        return;
      }

      this.logger.log('Seeding initial service catalogue for The Dry X Clean...');

      const defaultServices = [
        {
          name: 'Dry Cleaning',
          category: 'DRY_CLEAN',
          description:
            'Eco-friendly hydrocarbon solvent dry cleaning with individual garment inspection, gentle stain removal, and handcrafted atelier finishing.',
          icon: 'dry_cleaning',
          turnaroundTime: '48-72 Hours',
          turnaroundHours: 48,
          active: true,
          prices: [
            {
              itemType: "Men's Suit (2-Piece)",
              amountMinor: 35000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Silk / Designer Saree',
              amountMinor: 30000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Bridal / Heavy Lehenga',
              amountMinor: 75000,
              unit: 'piece',
              package: 'Premium Atelier',
            },
            { itemType: 'Formal Shirt', amountMinor: 9000, unit: 'piece', package: 'Standard' },
            {
              itemType: 'Trousers / Chinos',
              amountMinor: 10000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Winter Jacket / Overcoat',
              amountMinor: 38000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Woolen Blanket (Double)',
              amountMinor: 45000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Intensive Stain Treatment',
              amountMinor: 10000,
              unit: 'piece',
              isAddon: true,
              description: 'Targeted enzyme pre-spotting for stubborn stains',
            },
            {
              itemType: 'Moth & Moisture Guard Packaging',
              amountMinor: 5000,
              unit: 'piece',
              isAddon: true,
              description: 'Sealed breathable garment shield bag',
            },
            {
              itemType: 'Premium Wooden Atelier Hanger',
              amountMinor: 8000,
              unit: 'piece',
              isAddon: true,
              description: 'Contoured solid wood hanger with non-slip bar',
            },
          ],
        },
        {
          name: 'Premium Laundry',
          category: 'PREMIUM_LAUNDRY',
          description:
            'Fabric-specific temperature washing, pH-balanced German detergents, professional steam pressing, and premium packaging.',
          icon: 'local_laundry_service',
          turnaroundTime: '24-48 Hours',
          turnaroundHours: 24,
          active: true,
          prices: [
            {
              itemType: 'Shirt (Wash & Steam Press)',
              amountMinor: 7000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Trousers (Wash & Steam Press)',
              amountMinor: 8000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Kurta Pajama (Wash & Press)',
              amountMinor: 15000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Bed Sheet Set (Single)',
              amountMinor: 12000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Bed Sheet Set (Double)',
              amountMinor: 18000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Antibacterial Sanitization',
              amountMinor: 4000,
              unit: 'piece',
              isAddon: true,
              description: 'Hospital-grade sanitization rinse',
            },
            {
              itemType: 'Fabric Softener Fragrance Boost',
              amountMinor: 3000,
              unit: 'piece',
              isAddon: true,
              description: 'Long-lasting lavender aroma infusion',
            },
          ],
        },
        {
          name: 'Wash & Fold',
          category: 'WASH_FOLD',
          description:
            'Everyday bulk laundry washed with hypoallergenic detergents, tumble dried, and neatly bundled by weight.',
          icon: 'wash',
          turnaroundTime: '24-36 Hours',
          turnaroundHours: 24,
          active: true,
          prices: [
            {
              itemType: 'Everyday Garments (per kg)',
              amountMinor: 9900,
              unit: 'kg',
              package: 'Basic',
            },
            {
              itemType: 'Towels & Linens (per kg)',
              amountMinor: 12000,
              unit: 'kg',
              package: 'Basic',
            },
            {
              itemType: 'Express 24h Wash & Fold (per kg)',
              amountMinor: 14900,
              unit: 'kg',
              package: 'Express',
            },
            {
              itemType: 'Hypoallergenic Baby Detergent Rinse',
              amountMinor: 5000,
              unit: 'kg',
              isAddon: true,
              description: 'Zero fragrance, dermatologically tested rinse',
            },
          ],
        },
        {
          name: 'Steam Ironing',
          category: 'STEAM_IRONING',
          description:
            'Industrial vacuum steam press that smooths out wrinkles without fabric scorching, shine marks, or fiber stress.',
          icon: 'iron',
          turnaroundTime: '12-24 Hours',
          turnaroundHours: 12,
          active: true,
          prices: [
            { itemType: 'Shirt / T-Shirt', amountMinor: 2500, unit: 'piece', package: 'Standard' },
            { itemType: 'Trousers / Jeans', amountMinor: 3000, unit: 'piece', package: 'Standard' },
            {
              itemType: 'Saree / Heavy Dress',
              amountMinor: 8000,
              unit: 'piece',
              package: 'Standard',
            },
            {
              itemType: 'Bedsheet (Double)',
              amountMinor: 6000,
              unit: 'piece',
              package: 'Standard',
            },
          ],
        },
      ];

      for (const def of defaultServices) {
        const createdService = await this.serviceModel.create({
          name: def.name,
          category: def.category,
          description: def.description,
          icon: def.icon,
          turnaroundTime: def.turnaroundTime,
          turnaroundHours: def.turnaroundHours,
          active: def.active,
        });

        for (const p of def.prices) {
          await this.servicePriceModel.create({
            serviceId: createdService._id,
            itemType: p.itemType,
            amountMinor: p.amountMinor,
            unit: p.unit,
            package: p.package,
            currency: 'INR',
            isAddon: (p as any).isAddon ?? false,
            description: (p as any).description,
            active: true,
          });
        }
      }

      this.logger.log(`Successfully seeded ${defaultServices.length} catalogue services.`);
    } catch (err: any) {
      this.logger.error(`Error during service catalogue seeding: ${err.message}`, err.stack);
    }
  }
}
