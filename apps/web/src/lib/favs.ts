'use client';
/** Favourite shops — device-scoped, like a signed-out heart list. */
import { useEffect, useState } from 'react';

const KEY = 'sn-favs';

function read(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function useFavourites(): [string[], (shopId: string) => void] {
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => setFavs(read()), []);
  const toggle = (shopId: string) => {
    setFavs((cur) => {
      const next = cur.includes(shopId) ? cur.filter((x) => x !== shopId) : [...cur, shopId];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // private mode — favourites just don't persist
      }
      return next;
    });
  };
  return [favs, toggle];
}
