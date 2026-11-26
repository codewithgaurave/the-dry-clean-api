export interface OrderProofResponseDto {
  id: string;
  orderId: string;
  taskId: string;
  type: string; // 'DELIVERY' | 'PICKUP'
  handoverMethod: string;
  capturedAt: string;
  receivedAt: string;
  photoUrls: string[];
  note?: string;
  reviewStatus: string;
  flaggedReason?: string;
}
