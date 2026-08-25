import * as s3 from './s3';
import * as onedrive from './onedrive';
import type { S3Config } from './s3';

/**
 * 同步后端分发。上层(remoteSync / assetSync)只认 key,不认后端 ——
 * 加密、冲突判定、资源内容寻址全部复用,换后端只是换这四个动作的实现。
 */

export type RemoteProvider = 's3' | 'onedrive';

/** 两种后端的配置并集;RemoteConfig 结构上满足它,所以这里不反向依赖 remoteSync */
export type RemoteTarget = Partial<S3Config> & {
  provider?: RemoteProvider;
  prefix?: string;
  clientId?: string;
};

export interface ObjectHead {
  etag: string | null;
  size: number;
  lastModified: number;
}

function isOneDrive(cfg: RemoteTarget): boolean {
  return cfg.provider === 'onedrive';
}

export function getObject(cfg: RemoteTarget, key: string): Promise<Uint8Array | null> {
  return isOneDrive(cfg) ? onedrive.getObject(cfg, key) : s3.getObject(cfg as S3Config, key);
}

export function headObject(cfg: RemoteTarget, key: string): Promise<ObjectHead | null> {
  return isOneDrive(cfg) ? onedrive.headObject(cfg, key) : s3.headObject(cfg as S3Config, key);
}

export function putObject(
  cfg: RemoteTarget, key: string, body: Uint8Array, contentType = 'application/octet-stream',
): Promise<string | null> {
  return isOneDrive(cfg)
    ? onedrive.putObject(cfg, key, body, contentType)
    : s3.putObject(cfg as S3Config, key, body, contentType);
}

export function deleteObject(cfg: RemoteTarget, key: string): Promise<void> {
  return isOneDrive(cfg) ? onedrive.deleteObject(cfg, key) : s3.deleteObject(cfg as S3Config, key);
}

export function testConnection(cfg: RemoteTarget): Promise<{ ok: true } | { ok: false; reason: string }> {
  return isOneDrive(cfg) ? onedrive.testConnection(cfg) : s3.testConnection(cfg as S3Config);
}

/**
 * 加密密钥的作用域。**S3 那支的字符串一个字都不能动** ——
 * 它参与密钥派生,改了等于把已有桶里的数据锁死。
 */
export function remoteScope(cfg: RemoteTarget): string {
  if (isOneDrive(cfg)) return `theloom:onedrive/${cfg.prefix ?? ''}`;
  return `theloom:${cfg.bucket}/${cfg.prefix ?? ''}`;
}

/** 配置是否齐全到可以同步 */
export function targetReady(cfg: RemoteTarget): boolean {
  if (isOneDrive(cfg)) return !!(cfg.clientId && onedrive.signedIn());
  return !!(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
}
