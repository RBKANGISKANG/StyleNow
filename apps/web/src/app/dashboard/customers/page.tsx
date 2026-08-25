import { allShops } from '@/core/store';
import { CustomersScreen } from './CustomersScreen';

export default function CustomersPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <CustomersScreen shops={shops} />;
}
