import Link from 'next/link';

export function ReleasedRewardsNotice({ status, points }: { status?: string | null; points?: number }) {
  if (status !== 'Released' || !points) return <p className="text-sm text-muted-foreground">{!status || !points ? 'No loyalty points were reserved for this booking.' : 'Check My Rewards for the current status of your loyalty points.'}</p>;
  return <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">Your {points} reserved loyalty points have been returned. <Link href="/customer/rewards" className="font-medium underline underline-offset-4">View My Rewards</Link> for your current balance.</p>;
}
