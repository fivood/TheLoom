/**
 * 云同步房间 API(Cloudflare Pages Functions + D1)
 *
 * GET  /api/room/:id  → { version, updatedAt, payload }
 * PUT  /api/room/:id  body { baseVersion, payload } → { version } | 409 { version }
 *
 * - 鉴权:Authorization: Bearer <authToken>,authToken 由客户端从口令派生,
 *   服务端只存其 SHA-256,原始口令与加密密钥从不离开客户端
 * - payload 是端到端加密后的 base64 密文,服务端无法读取内容
 * - 乐观锁:PUT 必须携带 baseVersion,与云端不一致返回 409
 * - 大 payload 按 20 万字符分块存 chunks 表;新版本先写块再原子换版本号,
 *   竞态失败时清理孤块,数据始终一致
 */

interface Env {
  SYNC_DB?: D1Database;
}

const CHUNK = 200_000;
const MAX_PAYLOAD = 20_000_000; // 20M 字符(base64)上限

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bearer(request: Request): string | null {
  const m = request.headers.get('Authorization')?.match(/^Bearer\s+([\w-]{16,128})$/);
  return m ? m[1] : null;
}

function validRoom(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{3,64}$/.test(id);
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(
      'CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
    ),
    db.prepare(
      'CREATE TABLE IF NOT EXISTS chunks(room TEXT NOT NULL, version INTEGER NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(room, version, idx))',
    ),
  ]);
}

async function writeChunks(db: D1Database, room: string, version: number, payload: string) {
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0, idx = 0; i < payload.length; i += CHUNK, idx++) {
    stmts.push(
      db.prepare('INSERT OR REPLACE INTO chunks(room, version, idx, data) VALUES(?1, ?2, ?3, ?4)')
        .bind(room, version, idx, payload.slice(i, i + CHUNK)),
    );
  }
  // 分批提交,避免单次 batch 过大
  for (let i = 0; i < stmts.length; i += 40) {
    await db.batch(stmts.slice(i, i + 40));
  }
}

async function readPayload(db: D1Database, room: string, version: number): Promise<string> {
  const { results } = await db.prepare(
    'SELECT data FROM chunks WHERE room = ?1 AND version = ?2 ORDER BY idx',
  ).bind(room, version).all<{ data: string }>();
  return results.map((r) => r.data).join('');
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const db = env.SYNC_DB;
  if (!db) return json({ error: '云同步未配置:部署方需要绑定 D1 数据库(见 wrangler.toml)' }, 501);
  const room = params.id;
  if (!validRoom(room)) return json({ error: '房间码只能包含字母、数字、- 和 _,长度 3~64' }, 400);
  const token = bearer(request);
  if (!token) return json({ error: '缺少凭证' }, 401);

  await ensureSchema(db);
  const row = await db.prepare('SELECT token_hash, version, updated_at FROM rooms WHERE id = ?1')
    .bind(room).first<{ token_hash: string; version: number; updated_at: number }>();
  if (!row) return json({ error: '房间不存在,先推送一次即可创建' }, 404);
  if (row.token_hash !== await sha256hex(token)) return json({ error: '口令不正确' }, 403);

  const payload = await readPayload(db, room, row.version);
  return json({ version: row.version, updatedAt: row.updated_at, payload });
};

export const onRequestPut: PagesFunction<Env> = async ({ env, params, request }) => {
  const db = env.SYNC_DB;
  if (!db) return json({ error: '云同步未配置:部署方需要绑定 D1 数据库(见 wrangler.toml)' }, 501);
  const room = params.id;
  if (!validRoom(room)) return json({ error: '房间码只能包含字母、数字、- 和 _,长度 3~64' }, 400);
  const token = bearer(request);
  if (!token) return json({ error: '缺少凭证' }, 401);

  let body: { baseVersion?: number; payload?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求体不是有效 JSON' }, 400);
  }
  const { baseVersion, payload } = body;
  if (typeof payload !== 'string' || payload.length === 0) return json({ error: '缺少 payload' }, 400);
  if (payload.length > MAX_PAYLOAD) return json({ error: '项目过大(超过 20MB),请精简头像图片' }, 413);
  if (typeof baseVersion !== 'number') return json({ error: '缺少 baseVersion' }, 400);

  await ensureSchema(db);
  const tokenHash = await sha256hex(token);
  const now = Date.now();
  const row = await db.prepare('SELECT token_hash, version FROM rooms WHERE id = ?1')
    .bind(room).first<{ token_hash: string; version: number }>();

  if (!row) {
    // 新房间:首次推送即创建,口令由创建者确定
    await writeChunks(db, room, 1, payload);
    const created = await db.prepare(
      'INSERT INTO rooms(id, token_hash, version, updated_at) SELECT ?1, ?2, 1, ?3 WHERE NOT EXISTS(SELECT 1 FROM rooms WHERE id = ?1)',
    ).bind(room, tokenHash, now).run();
    if (!created.meta.changes) {
      // 竞态:别人抢先创建了
      await db.prepare('DELETE FROM chunks WHERE room = ?1 AND version = 1 AND NOT EXISTS(SELECT 1 FROM rooms WHERE id = ?1 AND version = 1)').bind(room).run();
      const cur = await db.prepare('SELECT version FROM rooms WHERE id = ?1').bind(room).first<{ version: number }>();
      return json({ error: '房间刚被他人创建,请先拉取', version: cur?.version ?? 1 }, 409);
    }
    return json({ version: 1 });
  }

  if (row.token_hash !== tokenHash) return json({ error: '口令不正确' }, 403);
  if (baseVersion !== row.version) {
    return json({ error: '云端已有更新版本,请先拉取', version: row.version }, 409);
  }

  const newVersion = row.version + 1;
  // 先写新版本的块(不影响当前版本),再原子推进版本号
  await writeChunks(db, room, newVersion, payload);
  const bumped = await db.prepare(
    'UPDATE rooms SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4',
  ).bind(newVersion, now, room, baseVersion).run();

  if (!bumped.meta.changes) {
    // 竞态失败:清理孤块
    await db.prepare('DELETE FROM chunks WHERE room = ?1 AND version = ?2').bind(room, newVersion).run();
    const cur = await db.prepare('SELECT version FROM rooms WHERE id = ?1').bind(room).first<{ version: number }>();
    return json({ error: '云端已有更新版本,请先拉取', version: cur?.version ?? 0 }, 409);
  }

  // 清理旧版本的块
  await db.prepare('DELETE FROM chunks WHERE room = ?1 AND version < ?2').bind(room, newVersion).run();
  return json({ version: newVersion });
};
