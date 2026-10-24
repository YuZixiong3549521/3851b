export type GroupBy = 'day' | 'quarter' | 'year';

export type AnalyticsPeriod = {
  period: string;
  from: string;
  to: string;
  partial: boolean;
  orders: number;
  completed: number;
  active: number;
  closed: number;
  other: number;
  unknownCompletedPrices: number;
  serviceAmount: number;
  rewardDiscounts: number;
  netServiceAmount: number;
  services: {
    cleaning: number;
    repair: number;
    combined: number;
    annual: number;
    other: number;
  };
  annual: {
    visits: number;
    completed: number;
    active: number;
    closed: number;
    other: number;
  };
};

export type ReportAnalyticsChartsProps = {
  periods: AnalyticsPeriod[];
  groupBy: GroupBy;
};
