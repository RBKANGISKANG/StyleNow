import { allShops } from '@/core/store';
import { Dashboard } from './Dashboard';

export default function DashboardPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <Dashboard shops={shops} />;
}
