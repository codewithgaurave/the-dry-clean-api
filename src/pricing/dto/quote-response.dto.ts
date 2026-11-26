export interface QuoteAddonResponse {
  id: string;
  itemType: string;
  unitPriceMinor: number;
  totalPriceMinor: number;
  amountFormatted: string;
}

export interface QuoteItemResponse {
  serviceId: string;
  serviceName: string;
  itemType: string;
  quantity: number;
  package?: string;
  unit: string;
  unitPriceMinor: number;
  unitPriceFormatted: string;
  addons: QuoteAddonResponse[];
  totalPriceMinor: number;
  totalPriceFormatted: string;
}

export interface QuoteBreakdown {
  itemsSubtotalMinor: number;
  itemsSubtotalFormatted: string;
  discountMinor: number;
  discountFormatted: string;
  couponCode?: string;
  couponApplied: boolean;
  couponMessage?: string;
  deliveryFeeMinor: number;
  deliveryFeeFormatted: string;
  isDeliveryFree: boolean;
  taxableAmountMinor: number;
  taxableAmountFormatted: string;
  gstRate: number; // 18
  gstMinor: number;
  gstFormatted: string;
  cgstMinor: number;
  sgstMinor: number;
  totalAmountMinor: number;
  totalAmountFormatted: string;
  currency: string;
}

export interface QuoteResponseDto {
  items: QuoteItemResponse[];
  breakdown: QuoteBreakdown;
}
