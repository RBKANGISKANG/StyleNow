import { Suspense } from 'react';
import { CustomerMessages } from './CustomerMessages';

export const metadata = { title: 'Messages · StyleNow' };

export default function MessagesPage() {
  // useSearchParams reads a value only the browser has, so the prerender needs
  // a boundary to render past it.
  return (
    <Suspense fallback={<div className="spinner" />}>
      <CustomerMessages />
    </Suspense>
  );
}
