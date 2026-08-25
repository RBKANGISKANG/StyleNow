import { allShops } from '@/core/store';
import { ServicesScreen } from './ServicesScreen';

export default function ServicesPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <ServicesScreen shops={shops} />;
}
