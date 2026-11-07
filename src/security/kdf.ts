import { argon2id } from 'hash-wasm';

export interface KdfParams { memory: number; iterations: number; parallelism: number; hashLength: number; }

export const DEFAULT_KDF: KdfParams = { memory: 65536, iterations: 3, parallelism: 1, hashLength: 32 };

export async function deriveKey(password: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  const out = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: params.hashLength,
    outputType: 'binary'
  });
  return out as Uint8Array;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}