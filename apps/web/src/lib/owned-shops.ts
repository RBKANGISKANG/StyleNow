'use client';
/**
 * Shop scoping shared by every operator screen.
 *
 * An operator only ever sees the shops connected to their account (or, signed
 * out, to this device) — never another company's calendar. The selected shop is
 * remembered in localStorage so the dashboard and the HR page stay on the same
 * shop when you move between them.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiMyShops } from './api';
import { useAuth } from './auth';
import { deviceId } from './device';

export interface ShopRef {
  id: string;
  name: string;
  emoji: string;
}

const SELECTED_KEY = 'stylenow.operator.shop';

function remembered(): string {
  try {
    return window.localStorage.getItem(SELECTED_KEY) ?? '';
  } catch {
    return ''; // private mode — fall back to the first owned shop
  }
}

export interface OwnedShops {
  ownerKey: string | null;
  /** null while the owned set is still loading */
  ownedIds: string[] | null;
  myShops: ShopRef[];
  shopId: string;
  setShopId: (id: string) => void;
  /** re-read the owned set after a claim / disconnect */
  refresh: () => void;
}

export function useOwnedShops(shops: ShopRef[]): OwnedShops {
  const { user } = useAuth();
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [ownedIds, setOwnedIds] = useState<string[] | null>(null);
  const [shopId, setShopIdState] = useState('');

  useEffect(() => {
    const key = user?.email ?? (typeof window === 'undefined' ? '' : deviceId());
    setOwnerKey(key);
    void apiMyShops(key).then(setOwnedIds);
  }, [user]);

  const refresh = useCallback(() => {
    if (ownerKey === null) return;
    void apiMyShops(ownerKey).then(setOwnedIds);
  }, [ownerKey]);

  const myShops = shops.filter((s) => (ownedIds ?? []).includes(s.id));

  const setShopId = useCallback((id: string) => {
    setShopIdState(id);
    try {
      window.localStorage.setItem(SELECTED_KEY, id);
    } catch {
      // ignore — the selection just won't survive the page hop
    }
  }, []);

  // Keep the selection inside the owned set, preferring the shop last used on
  // the other operator screen.
  useEffect(() => {
    if (myShops.length === 0) {
      setShopIdState('');
      return;
    }
    if (myShops.some((s) => s.id === shopId)) return;
    const last = remembered();
    setShopId(myShops.some((s) => s.id === last) ? last : myShops[0].id);
  }, [myShops, shopId, setShopId]);

  return { ownerKey, ownedIds, myShops, shopId, setShopId, refresh };
}
