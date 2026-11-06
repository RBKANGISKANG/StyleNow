/**
 * Durable storage for the server process. Without it the engine's state —
 * bookings, salons, payments, settings — lived only in memory and was lost
 * on every restart or deploy.
 *
 * DATABASE_URL set   → Postgres (e.g. the Supabase database): one row in
 *                       public.stylenow_state holding the engine snapshot.
 * otherwise          → a JSON file, STYLENOW_DATA_FILE or .data/stylenow-state.json.
 *
 * The snapshot is loaded once before the first request (instrumentation.ts)
 * and written after changes: coalesced, one write in flight at a time, and
 * flushed on shutdown.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { attachServerStore } from '@/core/store';

const ROW_ID = 'main';
const WRITE_DELAY_MS = 200;

interface Backend {
  name: string;
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
}

async function postgresBackend(url: string): Promise<Backend> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: url,
    max: 3,
    ssl: /localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  await pool.query(`create table if not exists public.stylenow_state (
    id         text primary key,
    doc        jsonb       not null,
    updated_at timestamptz not null default now()
  )`);
  return {
    name: 'postgres',
    async load() {
      const r = await pool.query('select doc::text as doc from public.stylenow_state where id = $1', [ROW_ID]);
      return r.rows[0]?.doc ?? null;
    },
    async save(json) {
      await pool.query(
        `insert into public.stylenow_state (id, doc, updated_at) values ($1, $2::jsonb, now())
         on conflict (id) do update set doc = excluded.doc, updated_at = now()`,
        [ROW_ID, json],
      );
    },
  };
}

function fileBackend(file: string): Backend {
  return {
    name: `file ${file}`,
    async load() {
      try {
        return await fs.readFile(file, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async save(json) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      // Write beside, then rename: a crash mid-write never leaves half a file.
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, json, 'utf8');
      await fs.rename(tmp, file);
    },
  };
}

let started: Promise<void> | null = null;

export function startPersistence(): Promise<void> {
  started ??= (async () => {
    const url = process.env.DATABASE_URL;
    const backend = url
      ? await postgresBackend(url)
      : fileBackend(process.env.STYLENOW_DATA_FILE || path.join(process.cwd(), '.data', 'stylenow-state.json'));

    let pending: string | null = null;
    let timer: NodeJS.Timeout | null = null;
    let inFlight: Promise<void> = Promise.resolve();

    const flush = (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = null;
      const json = pending;
      pending = null;
      if (json === null) return inFlight;
      inFlight = inFlight
        .then(() => backend.save(json))
        .catch((e) => console.error('[stylenow] could not save state:', (e as Error).message));
      return inFlight;
    };

    attachServerStore(await backend.load(), (json) => {
      pending = json;
      timer ??= setTimeout(() => void flush(), WRITE_DELAY_MS);
    });

    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      process.once(sig, () => {
        void flush().finally(() => process.exit(0));
      });
    }
    console.log(`[stylenow] state persisted to ${backend.name}`);
  })();
  return started;
}
