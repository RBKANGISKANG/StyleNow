import { allShops } from '@/core/store';
import { HrScreen } from './HrScreen';

export default function HrPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <HrScreen shops={shops} />;
}
