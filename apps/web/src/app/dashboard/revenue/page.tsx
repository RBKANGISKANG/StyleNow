import { allShops } from '@/core/store';
import { RevenueScreen } from './RevenueScreen';

export default function RevenuePage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <RevenueScreen shops={shops} />;
}
