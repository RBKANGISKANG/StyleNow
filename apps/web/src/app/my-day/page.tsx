import { allShops } from '@/core/store';
import { MyDay } from './MyDay';

export default function MyDayPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <MyDay shops={shops} />;
}
