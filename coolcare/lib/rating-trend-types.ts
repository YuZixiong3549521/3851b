export type RatingGrouping = 'month' | 'quarter' | 'year';
export type RatingPeriod = { period: string; from: string; to: string; partial: boolean; count: number; average: number | null; positive: number; neutral: number; negative: number };
export type RatingTrend = {
  technicianId: number;
  name: string;
  count: number;
  average: number | null;
  periods: Record<RatingGrouping, RatingPeriod[]>;
  comparison: {
    minimumReviews: number;
    earlier: { from: string; to: string; count: number; average: number | null };
    later: { from: string | null; to: string; count: number; average: number | null };
    difference: number | null;
    direction: 'higher' | 'lower' | 'unchanged' | 'insufficient';
  };
};
