/**
 * Durable storage for the server process.
 *
 * DATABASE_URL set → Postgres (e.g. Supabase). Every record — each booking,
 *   salon, account, lead… — is its own row in public.stylenow_records
 *   (kind, id, doc jsonb). A change writes only the rows that changed, in one
 *   transaction, so a crash mid-save never leaves half a state and the cost
 *   of a save no longer grows with the size of the whole database.
 *   - Single writer: the process takes a Postgres advisory lock at start-up.
 *     A second copy of the server pointed at the same database refuses to
 *     start instead of silently overwriting the first one's data.
 *   - Daily backup: one full snapshot per day in public.stylenow_backups,
 *     the last 14 kept.
 *   - Migration: data saved by the old one-row format (public.stylenow_state)
 *     is loaded and rewritten as records on first start; the old row is kept.
 * otherwise → a JSON file, STYLENOW_DATA_FILE or .data/stylenow-state.json.
 *
 * Loaded once before the first request (instrumentation.ts); writes are
 * coalesced (200 ms), one in flight at a time, and flushed on shutdown.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { attachServerStore } from '@/core/store';

const WRITE_DELAY_MS = 200;
const LOCK_KEY = 0x5354594c; // "STYL"
const BACKUPS_KEPT = 14;

interface Backend {
  name: string;
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
}

type Row = { kind: string; id: string; doc: string };

/**
 * The snapshot is an object of collections. A collection that is an array of
 * [key, value] pairs or of objects with an `id` becomes one row per element;
 * anything else (a plain list, a setting) is one row of its own.
 */
export function snapshotToRows(json: string): Row[] {
  const snap = JSON.parse(json) as Record<string, unknown>;
  const rows: Row[] = [];
  for (const [kind, val] of Object.entries(snap)) {
    if (Array.isArray(val) && val.length && val.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string')) {
      for (const [id, v] of val as Array<[string, unknown]>) rows.push({ kind, id: `k:${id}`, doc: JSON.stringify(v) });
    } else if (Array.isArray(val) && val.length && val.every((e) => e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string')) {
      for (const e of val as Array<{ id: string }>) rows.push({ kind, id: `o:${e.id}`, doc: JSON.stringify(e) });
    } else {
      rows.push({ kind, id: '*', doc: JSON.stringify(val) });
    }
  }
  return rows;
}

export function rowsToSnapshot(rows: Array<{ kind: string; id: string; doc: unknown }>): string {
  const snap: Record<string, unknown> = {};
  for (const r of rows) {
    const doc = typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc;
    if (r.id === '*') snap[r.kind] = doc;
    else if (r.id.startsWith('k:')) ((snap[r.kind] ??= []) as unknown[]).push([r.id.slice(2), doc]);
    else ((snap[r.kind] ??= []) as unknown[]).push(doc);
  }
  return JSON.stringify(snap);
}

const digest = (s: string) => createHash('sha1').update(s).digest('base64');

async function postgresBackend(url: string): Promise<Backend> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: url,
    max: 4,
    ssl: /localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  await pool.query(`
    create table if not exists public.stylenow_records (
      kind       text        not null,
      id         text        not null,
      doc        jsonb       not null,
      seq        bigserial,
      updated_at timestamptz not null default now(),
      primary key (kind, id)
    );
    create table if not exists public.stylenow_backups (
      taken_at timestamptz primary key default now(),
      doc      jsonb not null
    );`);

  // One writer per database. The lock lives as long as this connection does.
  const lockClient = await pool.connect();
  const { rows: lr } = await lockClient.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
  if (!lr[0]?.ok) {
    lockClient.release();
    throw new Error('another StyleNow server is already writing to this database — refusing to start a second writer');
  }

  const saved = new Map<string, string>(); // kind\0id → digest of the doc in the database
  let lastBackup = 0;

  return {
    name: 'postgres (one row per record)',
    async load() {
      const r = await pool.query('select kind, id, doc::text as doc from public.stylenow_records order by seq');
      if (r.rows.length) {
        for (const row of r.rows) saved.set(`${row.kind}\0${row.id}`, digest(row.doc));
        const b = await pool.query('select extract(epoch from max(taken_at)) * 1000 as at from public.stylenow_backups');
        lastBackup = Number(b.rows[0]?.at ?? 0);
        return rowsToSnapshot(r.rows);
      }
      // First start after the upgrade: bring the old one-row state across.
      const old = await pool.query(`select to_regclass('public.stylenow_state') is not null as has`);
      if (old.rows[0]?.has) {
        const o = await pool.query(`select doc::text as doc from public.stylenow_state where id = 'main'`);
        if (o.rows[0]?.doc) {
          console.log('[stylenow] migrating the old single-row state into stylenow_records');
          return o.rows[0].doc as string;
        }
      }
      return null;
    },
    async save(json) {
      const rows = snapshotToRows(json);
      const next = new Map(rows.map((r) => [`${r.kind}\0${r.id}`, digest(r.doc)]));
      const changed = rows.filter((r) => saved.get(`${r.kind}\0${r.id}`) !== next.get(`${r.kind}\0${r.id}`));
      const gone = [...saved.keys()].filter((k) => !next.has(k));
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (let i = 0; i < changed.length; i += 500) {
          const part = changed.slice(i, i + 500);
          await client.query(
            `insert into public.stylenow_records (kind, id, doc, updated_at)
             select k, i, d::jsonb, now() from unnest($1::text[], $2::text[], $3::text[]) as t(k, i, d)
             on conflict (kind, id) do update set doc = excluded.doc, updated_at = now()`,
            [part.map((r) => r.kind), part.map((r) => r.id), part.map((r) => r.doc)],
          );
        }
        if (gone.length) {
          await client.query(
            'delete from public.stylenow_records where (kind, id) in (select * from unnest($1::text[], $2::text[]))',
            [gone.map((k) => k.split('\0')[0]), gone.map((k) => k.split('\0')[1])],
          );
        }
        if (Date.now() - lastBackup > 864e5) {
          await client.query('insert into public.stylenow_backups (doc) values ($1::jsonb) on conflict do nothing', [json]);
          await client.query(`delete from public.stylenow_backups where taken_at not in (select taken_at from public.stylenow_backups order by taken_at desc limit ${BACKUPS_KEPT})`);
          lastBackup = Date.now();
        }
        await client.query('commit');
        // Only now does memory agree with the database.
        for (const r of changed) saved.set(`${r.kind}\0${r.id}`, next.get(`${r.kind}\0${r.id}`)!);
        for (const k of gone) saved.delete(k);
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
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
        .catch((e) => {
          console.error('[stylenow] could not save state:', (e as Error).message);
          // keep the newest unsaved state so the next change (or shutdown) retries it
          pending ??= json;
        });
      return inFlight;
    };

    const initial = await backend.load();
    attachServerStore(initial, (json) => {
      pending = json;
      timer ??= setTimeout(() => void flush(), WRITE_DELAY_MS);
    });
    // Write the loaded (or migrated) state once in the record format.
    if (initial) {
      pending = initial;
      await flush();
    }

    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      process.once(sig, () => {
        void flush().finally(() => process.exit(0));
      });
    }
    console.log(`[stylenow] state persisted to ${backend.name}`);
  })();
  return started;
}
