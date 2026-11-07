// Runs once when the Next.js server starts, before it serves a request.
export async function register() {
  // The import must sit inside this check so the edge bundle drops it.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPersistence } = await import('./lib/server-persistence');
    await startPersistence();
    const { startBookingMail } = await import('./lib/booking-mail');
    startBookingMail();
  }
}
