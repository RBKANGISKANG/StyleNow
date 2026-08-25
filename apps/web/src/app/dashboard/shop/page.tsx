import { allShops } from '@/core/store';
import { ShopScreen } from './ShopScreen';

export default function ShopSettingsPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <ShopScreen shops={shops} />;
}
