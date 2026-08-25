'use client';
/** HR tab — contracts, hours, utilisation and absences for one shop. */
import { useCallback, useEffect, useState } from 'react';
import { apiLocations } from '@/lib/api';
import type { ShopRef } from '@/lib/owned-shops';
import { HrPanel } from '@/components/HrPanel';
import { useToast } from '../toast';
import { OperatorShell } from '../shell';

export function HrScreen({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard/hr">
      {({ shopId }) => <HrTab shopId={shopId} />}
    </OperatorShell>
  );
}

function HrTab({ shopId }: { shopId: string }) {
  const [locations, setLocations] = useState<Array<{ id: string; label: string }>>([]);
  const { setToast, toastEl } = useToast();

  useEffect(() => {
    if (!shopId) return;
    void apiLocations(shopId).then(setLocations);
  }, [shopId]);

  const onChanged = useCallback((msg: string) => setToast(msg), [setToast]);

  return (
    <>
      <HrPanel shopId={shopId} locations={locations} onChanged={onChanged} />
      {toastEl}
    </>
  );
}
