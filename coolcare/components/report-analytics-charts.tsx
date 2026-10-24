'use client';

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import type { AnalyticsPeriod, GroupBy, ReportAnalyticsChartsProps } from '@/lib/report-analytics-types';
import { day, money, Section } from './commerce-shared';

const count = new Intl.NumberFormat('en-SG');
const compact = new Intl.NumberFormat('en-SG', { notation: 'compact', maximumFractionDigits: 1 });
const colours = {
  blue: 'var(--chart-1)',
  teal: 'var(--chart-2)',
  amber: 'var(--chart-3)',
  slate: 'var(--chart-4)',
  rose: 'var(--chart-5)',
  muted: 'var(--muted-foreground)',
};

export function periodLabel(period: string, grouping: GroupBy) {
  if (grouping === 'quarter') return period.replace(/^(\d{4})-Q(\d)$/, 'Q$2 $1');
  return grouping === 'day' ? day(period) : period;
}

type Series = { key: string; label: string; colour: string };
type ChartRow = { period: string; from: string; to: string; partial: boolean } & Record<string, string | number | boolean>;
type TableColumn = { label: string; value: (period: AnalyticsPeriod) => ReactNode };

function PeriodCell({ period, groupBy }: { period: AnalyticsPeriod; groupBy: GroupBy }) {
  return <>
    <span className="font-medium">{periodLabel(period.period, groupBy)}{period.partial ? ' *' : ''}</span>
    <span className="mt-1 block text-xs text-muted-foreground">
      {day(period.from)}{period.from !== period.to && ` – ${day(period.to)}`}
      {period.partial && ' · Partial period'}
    </span>
  </>;
}

function DataTable({ title, periods, groupBy, columns }: {
  title: string; periods: AnalyticsPeriod[]; groupBy: GroupBy; columns: TableColumn[];
}) {
  return <details className="border-t pt-4">
    <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View data table: ${title}`}>
      View data table
    </summary>
    <div className="mt-3 max-h-80 overflow-auto rounded-xl border" tabIndex={0} role="region" aria-label={`${title} data`}>
      <table className="w-full min-w-[560px] text-left text-sm">
        <caption className="sr-only">{title}. Figures use scheduled service dates. Partial periods contain only the dates shown.</caption>
        <thead className="sticky top-0 bg-muted"><tr>
          <th scope="col" className="px-3 py-3 font-medium">Period</th>
          {columns.map(column => <th key={column.label} scope="col" className="px-3 py-3 text-right font-medium">{column.label}</th>)}
        </tr></thead>
        <tbody>{periods.map(period => <tr className="border-t align-top" key={period.period}>
          <th scope="row" className="min-w-40 px-3 py-3 font-normal"><PeriodCell period={period} groupBy={groupBy} /></th>
          {columns.map(column => <td key={column.label} className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{column.value(period)}</td>)}
        </tr>)}</tbody>
      </table>
      {!periods.length && <p className="p-4 text-sm text-muted-foreground">No periods to display.</p>}
    </div>
  </details>;
}

function StackedChart({ title, rows, series, groupBy, monetary = false }: {
  title: string; rows: ChartRow[]; series: Series[]; groupBy: GroupBy; monetary?: boolean;
}) {
  const config: ChartConfig = Object.fromEntries(series.map(item => [item.key, { label: item.label, color: item.colour }]));
  // Keep quarter/year comparisons legible without making the page wider on mobile.
  // Long daily ranges remain a bounded scrollable chart; their exact values are in the table.
  const minimumWidth = rows.length > 6 ? Math.min(1440, rows.length * 55) : 0;
  const rowByPeriod = new Map(rows.map(row => [row.period, row]));
  return <>
    <ul className="flex flex-wrap content-start gap-x-4 gap-y-2 text-xs text-muted-foreground xl:min-h-10" aria-label={`${title} legend`}>
      {series.map(item => <li className="inline-flex items-center gap-2" key={item.key}>
        <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.colour }} aria-hidden="true" />{item.label}
      </li>)}
    </ul>
    <div className="min-w-0 overflow-x-auto" aria-hidden="true">
      <div style={{ minWidth: minimumWidth }}>
        <ChartContainer config={config} className="aspect-auto h-[272px] w-full" initialDimension={{ width: 400, height: 272 }}>
          <BarChart data={rows} accessibilityLayer={false} margin={{ top: 12, right: 10, left: 0, bottom: 0 }} maxBarSize={56}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="period" axisLine={false} tickLine={false} tickMargin={10} minTickGap={14} height={groupBy === 'quarter' ? 52 : 40}
              interval={groupBy === 'day' ? 'preserveStartEnd' : 0}
              tick={groupBy === 'day' ? undefined : ({ x, y, payload }) => {
                const period = String(payload.value);
                const quarter = /^(\d{4})-Q(\d)$/.exec(period);
                const marker = rowByPeriod.get(period)?.partial ? ' *' : '';
                return <g transform={`translate(${x},${y})`}>
                  <text textAnchor="middle" fill="var(--muted-foreground)" fontSize={11}>
                    {quarter ? <><tspan x={0} dy="0.71em">Q{quarter[2]}{marker}</tspan><tspan x={0} dy={14}>{quarter[1]}</tspan></> : <tspan x={0} dy="0.71em">{period}{marker}</tspan>}
                  </text>
                </g>;
              }}
              tickFormatter={value => {
                const period = String(value);
                const text = groupBy === 'day'
                  ? new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(period + 'T00:00:00Z'))
                  : periodLabel(period, groupBy);
                return text + (rowByPeriod.get(period)?.partial ? ' *' : '');
              }} />
            <YAxis width={monetary ? 64 : 38} axisLine={false} tickLine={false} allowDecimals={false} tickMargin={6}
              domain={[0, 'auto']} tickFormatter={value => `${monetary ? '$' : ''}${compact.format(Number(value))}`} />
            <Tooltip isAnimationActive={false} cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
              contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: 12, color: 'var(--popover-foreground)', fontSize: 12 }}
              labelStyle={{ fontWeight: 600, marginBottom: 8 }}
              formatter={value => monetary ? money(Number(value)) : count.format(Number(value))}
              labelFormatter={value => {
                const row = rowByPeriod.get(String(value));
                return <><span>{periodLabel(String(value), groupBy)}{row?.partial ? ' · Partial period' : ''}</span>{row && <span className="mt-1 block font-normal">{day(row.from)}{row.from !== row.to && ` – ${day(row.to)}`}</span>}</>;
              }} />
            {series.map(item => <Bar key={item.key} dataKey={item.key} name={item.label} stackId="total" fill={item.colour} isAnimationActive={false} />)}
          </BarChart>
        </ChartContainer>
      </div>
    </div>
    {minimumWidth > 0 && <p className="text-xs text-muted-foreground">Scroll across the chart to compare periods. Exact values are available in the data table.</p>}
  </>;
}

function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="flex min-h-52 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm leading-relaxed text-muted-foreground">{children}</div>;
}

export function ReportAnalyticsCharts({ periods, groupBy }: ReportAnalyticsChartsProps) {
  const grouping = groupBy === 'day' ? 'date' : groupBy;
  const hasOrders = periods.some(period => period.orders > 0);
  const completedCount = periods.reduce((total, period) => total + period.completed, 0);
  const unknownPrices = periods.reduce((total, period) => total + period.unknownCompletedPrices, 0);
  const hasKnownCompletedPrices = completedCount > unknownPrices;
  const hasAnnual = periods.some(period => period.annual.visits > 0);
  const hasOtherStatus = periods.some(period => period.other > 0);
  const hasOtherAnnual = periods.some(period => period.annual.other > 0);
  const statusSeries: Series[] = [
    { key: 'completed', label: 'Completed', colour: colours.teal },
    { key: 'active', label: 'Active', colour: colours.blue },
    { key: 'closed', label: 'Closed without completion', colour: colours.rose },
    ...(hasOtherStatus ? [{ key: 'other', label: 'Other status', colour: colours.muted }] : []),
  ];
  const serviceSeries: Series[] = [
    { key: 'cleaning', label: 'Cleaning', colour: colours.blue },
    { key: 'repair', label: 'Repair', colour: colours.teal },
    { key: 'combined', label: 'Cleaning & Repair', colour: colours.amber },
    { key: 'annual', label: 'Annual bundle', colour: colours.slate },
    { key: 'other', label: 'Other / historical', colour: colours.rose },
  ];
  const periodFields = (period: AnalyticsPeriod) => ({ period: period.period, from: period.from, to: period.to, partial: period.partial });
  const financialRows = periods.map(period => ({ ...periodFields(period), netServiceAmount: period.netServiceAmount, rewardDiscounts: period.rewardDiscounts }));
  const orderRows = periods.map(period => ({ ...periodFields(period), completed: period.completed, active: period.active, closed: period.closed, other: period.other }));
  const serviceRows = periods.map(period => ({ ...periodFields(period), ...period.services }));
  const annualRows = periods.map(period => ({ ...periodFields(period), ...period.annual }));
  const financialTitle = `Completed service value by ${grouping}`;
  const ordersTitle = `Order status by ${grouping}`;
  const servicesTitle = `Service mix by ${grouping}`;
  const annualTitle = `Annual bundle visits by ${grouping}`;

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">All charts use the same applied filters and scheduled service dates. Empty periods remain in the data. {periods.some(period => period.partial) && '* marks a partial period; only the selected dates are included.'}</p>
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <div className="min-w-0 [&>section]:h-full"><Section title={financialTitle}>
        <p className="text-sm leading-relaxed text-muted-foreground xl:min-h-20">Each bar is the completed service amount: after-reward value plus points discounts. Amounts are in SGD and do not represent payments collected.</p>
        {hasKnownCompletedPrices ? <StackedChart title={financialTitle} rows={financialRows} series={[
          { key: 'netServiceAmount', label: 'After rewards (SGD)', colour: colours.blue },
          { key: 'rewardDiscounts', label: 'Reward discounts (SGD)', colour: colours.amber },
        ]} groupBy={groupBy} monetary /> : <EmptyChart>{completedCount ? 'Completed orders in this range have no recorded prices. Their values are excluded, rather than treated as free services.' : 'No completed services in this range. Active orders do not contribute to completed service value.'}</EmptyChart>}
        {unknownPrices > 0 && <p className="text-sm text-amber-800">{count.format(unknownPrices)} completed {unknownPrices === 1 ? 'order has' : 'orders have'} no recorded price. These orders remain in the counts but are excluded from monetary totals.</p>}
        <DataTable title={financialTitle} periods={periods} groupBy={groupBy} columns={[
          { label: 'Completed orders', value: period => count.format(period.completed) },
          { label: 'Service amount (SGD)', value: period => money(period.serviceAmount) },
          { label: 'Reward discounts (SGD)', value: period => money(period.rewardDiscounts) },
          { label: 'After rewards (SGD)', value: period => money(period.netServiceAmount) },
          { label: 'Unpriced orders', value: period => count.format(period.unknownCompletedPrices) },
        ]} />
      </Section></div>
      <div className="min-w-0 [&>section]:h-full"><Section title={ordersTitle}>
        <p className="text-sm leading-relaxed text-muted-foreground xl:min-h-20">Compare the current status of orders scheduled in each period. Active includes requests awaiting confirmation and service in progress; closed includes cancelled, rejected and expired orders.</p>
        {hasOrders ? <StackedChart title={ordersTitle} rows={orderRows} series={statusSeries} groupBy={groupBy} /> : <EmptyChart>No orders match these filters. The data table retains all selected periods with zero orders.</EmptyChart>}
        <DataTable title={ordersTitle} periods={periods} groupBy={groupBy} columns={[
          { label: 'Orders', value: period => count.format(period.orders) },
          { label: 'Completed', value: period => count.format(period.completed) },
          { label: 'Active', value: period => count.format(period.active) },
          { label: 'Closed without completion', value: period => count.format(period.closed) },
          ...(hasOtherStatus ? [{ label: 'Other status', value: (period: AnalyticsPeriod) => count.format(period.other) }] : []),
        ]} />
      </Section></div>
      <div className="min-w-0 [&>section]:h-full"><Section title={servicesTitle}>
        <p className="text-sm leading-relaxed text-muted-foreground xl:min-h-20">See which services were booked, across all statuses. Combined Cleaning &amp; Repair and annual bundle visits each count once, without duplicating their cleaning service.</p>
        {hasOrders ? <StackedChart title={servicesTitle} rows={serviceRows} series={serviceSeries} groupBy={groupBy} /> : <EmptyChart>No services were booked in the selected range.</EmptyChart>}
        <DataTable title={servicesTitle} periods={periods} groupBy={groupBy} columns={serviceSeries.map(item => ({
          label: item.label, value: period => count.format(period.services[item.key as keyof AnalyticsPeriod['services']]),
        }))} />
      </Section></div>
      <div className="min-w-0 [&>section]:h-full"><Section title={annualTitle}>
        <p className="text-sm leading-relaxed text-muted-foreground xl:min-h-20">Track scheduled quarterly entitlements, not the number of plans sold. Return visits stay with the original appointment and do not consume another entitlement.</p>
        {hasAnnual ? <StackedChart title={annualTitle} rows={annualRows} series={[
          { key: 'completed', label: 'Completed', colour: colours.teal },
          { key: 'active', label: 'Awaiting service', colour: colours.blue },
          { key: 'closed', label: 'Closed without completion', colour: colours.rose },
          ...(hasOtherAnnual ? [{ key: 'other', label: 'Other status', colour: colours.muted }] : []),
        ]} groupBy={groupBy} /> : <EmptyChart>No annual bundle visits match these filters. Choose All services or Annual Cleaning Bundle to include package appointments.</EmptyChart>}
        <DataTable title={annualTitle} periods={periods} groupBy={groupBy} columns={[
          { label: 'Scheduled visits', value: period => count.format(period.annual.visits) },
          { label: 'Completed', value: period => count.format(period.annual.completed) },
          { label: 'Awaiting service', value: period => count.format(period.annual.active) },
          { label: 'Closed without completion', value: period => count.format(period.annual.closed) },
          ...(hasOtherAnnual ? [{ label: 'Other status', value: (period: AnalyticsPeriod) => count.format(period.annual.other) }] : []),
        ]} />
      </Section></div>
    </div>
  </div>;
}
