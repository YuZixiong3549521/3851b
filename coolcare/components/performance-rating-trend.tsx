'use client';

import { useId, useState } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp, TrendingDown, Minus, Star } from 'lucide-react';
import { ChartContainer } from '@/components/ui/chart';
import { NativeSelect } from '@/components/ui/native-select';
import { englishCalendarDate } from '@/lib/english-date';
import type { RatingGrouping, RatingTrend } from '@/lib/rating-trend-types';

const number = (value: number | null) => value == null ? 'Not rated' : value.toFixed(2);
function periodLabel(period: string, grouping: RatingGrouping) {
  if (grouping === 'year') return period;
  if (grouping === 'quarter') return period.replace(/^(\d{4})-Q(\d)$/, 'Q$2 $1');
  return new Intl.DateTimeFormat('en-SG', { month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' }).format(new Date(period + '-01T00:00:00+08:00'));
}

export function PerformanceRatingTrend({ trends, role, busy }: {
  trends: RatingTrend[]; role: 'admin' | 'technician'; busy: boolean;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [grouping, setGrouping] = useState<RatingGrouping>('month');
  const id = useId();
  const selected = trends.find(row => String(row.technicianId) === selectedId) ?? trends.find(row => row.count > 0) ?? trends[0];
  const periods = selected?.periods[grouping] ?? [];
  const comparison = selected?.comparison;
  const direction = comparison?.direction;
  const ChangeIcon = direction === 'higher' ? TrendingUp : direction === 'lower' ? TrendingDown : Minus;
  const chartRows = periods.map(row => ({ ...row, label: periodLabel(row.period, grouping) + (row.partial ? ' *' : '') }));
  return <section className="min-w-0 space-y-5 rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl"><h2 id={`${id}-title`} className="flex items-center gap-2 text-xl font-semibold"><Star className="size-5 text-primary" />Customer rating trend</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">See how customer ratings change over time for an individual technician. Points show the average rating for visits completed in each period, using Singapore time.</p></div>
      <div className="flex w-full flex-wrap gap-3 sm:w-auto">
        {role === 'admin' && <div className="min-w-0 flex-1 sm:min-w-52"><label htmlFor={`${id}-technician`} className="mb-1 block text-sm font-medium">Technician for this chart</label>
          <NativeSelect id={`${id}-technician`} value={selected?.technicianId ?? ''} onChange={event => setSelectedId(event.target.value)} disabled={busy || !trends.length}>
            {!trends.length && <option value="">No technicians in this period</option>}
            {trends.map(person => <option key={person.technicianId} value={person.technicianId}>{person.name} · {person.count} {person.count === 1 ? 'review' : 'reviews'}</option>)}
          </NativeSelect></div>}
        <div><label htmlFor={`${id}-group`} className="mb-1 block text-sm font-medium">Group ratings by</label><NativeSelect id={`${id}-group`} value={grouping} onChange={event => setGrouping(event.target.value as RatingGrouping)} disabled={busy}>
          <option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option>
        </NativeSelect></div>
      </div>
    </div>
    {!selected ? <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">No recorded technician visits in this date range. Choose another period above.</p> : <>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2"><p className="font-semibold">{selected.name}</p><p className="text-sm">{number(selected.average)}{selected.average != null && ' / 5'} <span className="text-muted-foreground">· {selected.count} customer {selected.count === 1 ? 'review' : 'reviews'}</span></p></div>
      {!selected.count ? <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">This technician has no customer ratings for completed visits in the selected period. Unrated visits are not shown as zero.</p> : <div className="min-w-0 overflow-x-auto" aria-hidden="true">
        <div style={{ minWidth: chartRows.length > 8 ? Math.min(2100, chartRows.length * 72) : 0 }}>
          <ChartContainer className="aspect-auto h-64 w-full" config={{ average: { label: 'Average customer rating', color: 'var(--chart-1)' } }} initialDimension={{ width: 500, height: 256 }}>
            <LineChart data={chartRows} accessibilityLayer={false} margin={{ top: 18, right: 20, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={12} minTickGap={18} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} allowDecimals={false} axisLine={false} tickLine={false} width={30} />
              <Tooltip content={({ active, payload }) => {
                const row = payload?.[0]?.payload as typeof chartRows[number] | undefined;
                return active && row ? <div className="space-y-1 rounded-xl border bg-card p-3 text-sm shadow-md"><p className="font-semibold">{row.label}</p><p>{englishCalendarDate(row.from)} – {englishCalendarDate(row.to)}</p><p>Average: {number(row.average)} / 5</p><p>{row.count} customer {row.count === 1 ? 'review' : 'reviews'}</p></div> : null;
              }} />
              <Line dataKey="average" type="linear" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--chart-1)' }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </div>
      </div>}
      <p className="text-xs leading-relaxed text-muted-foreground">The vertical scale is 1–5 stars. Gaps mean no ratings, not a zero score. * marks a partial calendar period. One current review is counted per completed visit for each captured team member; an edited review updates that visit’s average. The chart is grouped by service completion date, not the date feedback was received.</p>
      {comparison && <div className="space-y-2 rounded-xl border bg-muted/25 p-4">
        <p className="flex items-center gap-2 font-medium"><ChangeIcon className="size-4 text-primary" />{direction === 'insufficient' ? 'More reviews needed to compare' : direction === 'higher' ? 'Higher average in the later half' : direction === 'lower' ? 'Lower average in the later half' : 'Same average in both halves'}</p>
        <div className="grid gap-3 text-sm sm:grid-cols-2"><p><span className="block text-muted-foreground">Earlier half · {englishCalendarDate(comparison.earlier.from)} – {englishCalendarDate(comparison.earlier.to)}</span>{number(comparison.earlier.average)}{comparison.earlier.average != null && ' / 5'} · {comparison.earlier.count} {comparison.earlier.count === 1 ? 'review' : 'reviews'}</p>
          <p><span className="block text-muted-foreground">Later half{comparison.later.from ? ` · ${englishCalendarDate(comparison.later.from)} – ${englishCalendarDate(comparison.later.to)}` : ' · Choose a longer date range'}</span>{number(comparison.later.average)}{comparison.later.average != null && ' / 5'} · {comparison.later.count} {comparison.later.count === 1 ? 'review' : 'reviews'}</p></div>
        <p className="text-xs text-muted-foreground">{comparison.difference == null ? `At least ${comparison.minimumReviews} rated visits in each half are needed before showing a direction.` : `Difference: ${comparison.difference > 0 ? '+' : ''}${comparison.difference.toFixed(2)} stars. This describes the recorded reviews; it does not prove a change in service quality.`} The comparison uses the same two halves of the selected date range for every chart grouping.</p>
      </div>}
      <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium text-primary">View rating trend data</summary>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keep the wide, scrolling data table usable with the keyboard. */}
        <section className="mt-3 max-h-80 overflow-auto rounded-xl border" aria-label={`${selected.name} rating trend data`} tabIndex={0}>
        <table className="w-full min-w-[610px] text-left text-sm"><caption className="sr-only">{selected.name}: customer ratings by completed visit date. Positive means 4–5 stars, neutral 3 stars and negative 1–2 stars.</caption><thead className="sticky top-0 bg-muted"><tr>{['Period', 'Average / 5', 'Reviews', 'Positive (4–5)', 'Neutral (3)', 'Negative (1–2)'].map(label => <th scope="col" className="px-3 py-3 font-medium" key={label}>{label}</th>)}</tr></thead>
          <tbody>{periods.map(row => <tr className="border-t" key={row.period}><th scope="row" className="px-3 py-3 font-normal"><span className="font-medium">{periodLabel(row.period, grouping)}{row.partial && ' *'}</span><span className="mt-1 block text-xs text-muted-foreground">{englishCalendarDate(row.from)} – {englishCalendarDate(row.to)}</span></th><td className="px-3 py-3 tabular-nums">{number(row.average)}</td><td className="px-3 py-3 tabular-nums">{row.count}</td><td className="px-3 py-3 tabular-nums">{row.positive}</td><td className="px-3 py-3 tabular-nums">{row.neutral}</td><td className="px-3 py-3 tabular-nums">{row.negative}</td></tr>)}</tbody>
        </table></section></details>
    </>}
  </section>;
}
