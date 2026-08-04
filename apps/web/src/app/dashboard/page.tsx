import { allShops } from '@/server/store';
import { todayIso, addDays } from '@/server/time';
import { Dashboard } from './Dashboard';

export default function DashboardPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  const days = Array.from({ length: 8 }, (_, i) => addDays(todayIso(), i));
  return <Dashboard shops={shops} days={days} />;
}
