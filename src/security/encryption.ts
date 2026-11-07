import { fromB64, toB64 } from './kdf';

export interface EncEnvelope { iv: string; ct: string; }

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as unknown as BufferSource, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key: CryptoKey, plaintext: Uint8Array, aad?: string): Promise<EncEnvelope> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const params: AesGcmParams = { name: 'AES-GCM', iv: iv as unknown as BufferSource };
  if (aad) params.additionalData = new TextEncoder().encode(aad) as unknown as BufferSource;
  const ct = await crypto.subtle.encrypt(params, key, plaintext as unknown as BufferSource);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function decryptBytes(key: CryptoKey, env: EncEnvelope, aad?: string): Promise<Uint8Array> {
  const iv = fromB64(env.iv);
  const ct = fromB64(env.ct);
  const params: AesGcmParams = { name: 'AES-GCM', iv: iv as unknown as BufferSource };
  if (aad) params.additionalData = new TextEncoder().encode(aad) as unknown as BufferSource;
  const pt = await crypto.subtle.decrypt(params, key, ct as unknown as BufferSource);
  return new Uint8Array(pt);
}

export async function encryptJson<T>(key: CryptoKey, value: T, aad?: string): Promise<EncEnvelope> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return encryptBytes(key, bytes, aad);
}
export async function decryptJson<T>(key: CryptoKey, env: EncEnvelope, aad?: string): Promise<T> {
  const bytes = await decryptBytes(key, env, aad);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}