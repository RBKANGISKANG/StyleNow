import { allShops } from '@/core/store';
import { TeamScreen } from './TeamScreen';

export default function TeamPage() {
  const shops = allShops().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }));
  return <TeamScreen shops={shops} />;
}
