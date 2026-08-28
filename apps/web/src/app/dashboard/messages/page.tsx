import { allShops } from '@/core/store';
import { MessagesScreen } from './MessagesScreen';

export default function MessagesPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <MessagesScreen shops={shops} />;
}
