/**
 * 项目数据的压缩与端到端加密原语。
 *
 * 云房间(sync.ts)与外链网盘(remote/)共用同一套 —— 两处各写一份 AES-GCM
 * 是加密代码最不该出现的情况:一旦实现分岔,同一份稿子在两条通道上就
 * 解不开了,而且这类 bug 只有在真正需要恢复数据时才会暴露。
 */

export async function gzip(data: Uint8Array, mode: 'gzip' | 'gunzip'): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    mode === 'gzip' ? new CompressionStream('gzip') : new DecompressionStream('gzip'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** PBKDF2 12 万次派生 AES-GCM 密钥;salt 用调用方的作用域串,避免跨库撞用 */
export async function deriveAesKey(salt: string, pass: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 120_000, hash: 'SHA-256' },
    material,
    256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** 输出 iv(12B) || 密文,直接可写进对象存储,不再套 base64 */
export async function encryptBytes(plain: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function decryptBytes(payload: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: payload.slice(0, 12) },
    key,
    payload.slice(12) as BufferSource,
  );
  return new Uint8Array(plain);
}
