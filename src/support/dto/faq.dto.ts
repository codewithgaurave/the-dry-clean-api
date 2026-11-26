export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  tags?: string[];
}

export class FaqQueryDto {
  category?: string;
  search?: string;
}
