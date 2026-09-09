import type { Frame } from '@lacs/contracts';

/**
 * The phone's local database.
 *
 * Every frame lands here before anything tries to upload it. That ordering is
 * the whole point: the node keeps recording when the phone has no network, in
 * a lift, or with the server down, and nothing is lost to an app being killed.
 *
 * Rows are deleted only after the server confirms them, so a failed upload
 * retries rather than evaporates. Ingest is idempotent, so retrying a batch
 * the server already stored is harmless.
 */

const DB_NAME = 'lacs';
const TABLE = `
  CREATE TABLE IF NOT EXISTS pending_frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_frames (created_at);
`;

type SqliteModule = typeof import('@capacitor-community/sqlite');
type Connection = Awaited<ReturnType<SqliteModule['SQLiteConnection']['prototype']['createConnection']>>;

let connection: Connection | null = null;

async function db(): Promise<Connection> {
  if (connection) return connection;

  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  // A connection can survive an app reload while the JS module does not.
  const consistent = await sqlite.checkConnectionsConsistency().catch(() => ({ result: false }));
  const exists = await sqlite.isConnection(DB_NAME, false).catch(() => ({ result: false }));

  connection = consistent.result && exists.result
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

  await connection.open();
  await connection.execute(TABLE);
  return connection;
}

export async function bufferFrames(frames: Frame[]): Promise<void> {
  if (frames.length === 0) return;
  const conn = await db();

  const statements = frames.map((frame) => ({
    statement:
      'INSERT INTO pending_frames (device_id, seq, payload, created_at) VALUES (?, ?, ?, ?);',
    values: [frame.id, frame.seq, JSON.stringify(frame), Date.now()],
  }));

  await conn.executeSet(statements);
}

export interface PendingBatch {
  ids: number[];
  frames: Frame[];
}

export async function takeBatch(limit = 200): Promise<PendingBatch> {
  const conn = await db();
  const res = await conn.query(
    'SELECT id, payload FROM pending_frames ORDER BY id ASC LIMIT ?;',
    [limit],
  );

  const rows = (res.values ?? []) as Array<{ id: number; payload: string }>;
  const ids: number[] = [];
  const frames: Frame[] = [];

  for (const row of rows) {
    try {
      frames.push(JSON.parse(row.payload) as Frame);
      ids.push(row.id);
    } catch {
      // Unparseable row: drop it rather than block the queue behind it.
      ids.push(row.id);
    }
  }

  return { ids, frames };
}

/** Called only after the server has accepted the batch. */
export async function clearBatch(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const conn = await db();
  await conn.run(`DELETE FROM pending_frames WHERE id IN (${ids.map(() => '?').join(',')});`, ids);
}

export async function pendingCount(): Promise<number> {
  const conn = await db();
  const res = await conn.query('SELECT COUNT(*) AS n FROM pending_frames;');
  const rows = (res.values ?? []) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * Sheds the oldest rows when the buffer has grown past what a phone should
 * hold. Oldest first: if a long outage means something must be lost, the
 * recent minutes are the ones worth keeping.
 */
export async function trim(maxRows = 50_000): Promise<number> {
  const conn = await db();
  const count = await pendingCount();
  if (count <= maxRows) return 0;

  const excess = count - maxRows;
  await conn.run(
    'DELETE FROM pending_frames WHERE id IN (SELECT id FROM pending_frames ORDER BY id ASC LIMIT ?);',
    [excess],
  );
  return excess;
}
