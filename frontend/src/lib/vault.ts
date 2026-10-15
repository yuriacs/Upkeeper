/*
 * Criptografia do perfil privado, feita só no navegador (WebCrypto). O servidor nunca vê a
 * senha, a chave do cofre nem o conteúdo. Desenho completo em PRIVACIDADE.md (raiz do projeto).
 *
 *   senha ──PBKDF2-SHA256 (600 mil rodadas, salt da conta)──► chave-mestra
 *   chave-mestra ──HKDF "upkeeper:auth"──► auth_key   (vai para o servidor no lugar da senha)
 *   chave-mestra ──HKDF "upkeeper:vault-wrap"──► tranca a chave do cofre   (nunca sai daqui)
 *   código de recuperação ──HKDF "upkeeper:recovery-wrap"──► tranca a mesma chave do cofre
 *   chave do cofre (aleatória, AES-256-GCM) ──► cifra o JSON do perfil
 *
 * Mudar qualquer rótulo ou parâmetro daqui quebra os cofres existentes.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

const AAD_KEY = enc.encode('upkeeper:vault-key:v1')
const AAD_DATA = enc.encode('upkeeper:vault-data:v1')
export const KDF_ITERATIONS = 600_000

/** O que fica dentro do cofre. Dado pessoal novo do perfil entra aqui (PRIVACIDADE.md). */
export type VaultData = {
  email?: string
}

/** Cofre como o servidor guarda: tudo cifrado */
export type SealedVault = { key_by_secret: string; key_by_recovery: string; data: string }

export class VaultError extends Error {
  code: 'wrong_secret' | 'wrong_recovery' | 'unsupported' | 'corrupt'
  constructor(code: VaultError['code']) {
    super(code)
    this.code = code
  }
}

// ---- base64 ---------------------------------------------------------------------------------

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const s = atob(value)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

function subtle(): SubtleCrypto {
  // Só existe em HTTPS (ou localhost)
  if (!globalThis.crypto?.subtle) throw new VaultError('unsupported')
  return crypto.subtle
}

export const newSalt = () => toB64(random(16))

// ---- chaves da senha ------------------------------------------------------------------------

export type SecretKeys = { authKey: string; wrapKey: CryptoKey }

/**
 * Tira da senha a auth_key (para o servidor) e a chave que tranca o cofre (fica aqui).
 * Leva ~0,3–1 s de propósito: deixa caro testar senhas.
 */
export async function deriveSecretKeys(
  password: string,
  salt: string,
  iterations = KDF_ITERATIONS,
): Promise<SecretKeys> {
  const s = subtle()
  const base = await s.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
  const masterBits = await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations }, base, 256)
  const master = await s.importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) })
  const authBits = await s.deriveBits(hkdf('upkeeper:auth'), master, 256)
  const wrapKey = await s.deriveKey(hkdf('upkeeper:vault-wrap'), master, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  return { authKey: toB64(new Uint8Array(authBits)), wrapKey }
}

// ---- código de recuperação (Crockford base32: sem I, L, O, U para não confundir) -------------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_BYTES = 20 // 160 bits → 32 caracteres

export function newRecoveryCode(): string {
  const bytes = random(RECOVERY_BYTES)
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.match(/.{4}/g)!.join('-')
}

function recoveryBytes(code: string): Uint8Array<ArrayBuffer> | null {
  const clean = code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (clean.length !== 32) return null
  const out = new Uint8Array(RECOVERY_BYTES)
  let bits = 0
  let value = 0
  let i = 0
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) return null
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255
      bits -= 8
    }
  }
  return out
}

async function recoveryWrapKey(code: string): Promise<CryptoKey> {
  const bytes = recoveryBytes(code)
  if (!bytes) throw new VaultError('wrong_recovery')
  const s = subtle()
  const ikm = await s.importKey('raw', bytes, 'HKDF', false, ['deriveKey'])
  return s.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('upkeeper:recovery-wrap') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---- AES-GCM ----------------------------------------------------------------------------------

async function seal(key: CryptoKey, plain: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = random(12)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toB64(out)
}

async function open(key: CryptoKey, blob: string, aad: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const raw = fromB64(blob)
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: aad }, key, raw.slice(12))
  return new Uint8Array(plain)
}

/** Chave do cofre pronta para usar e guardar neste navegador (não exportável). */
function importVaultKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Chave do cofre aberta: a CryptoKey (para o dia a dia) e os bytes (só para trancar de novo). */
export type OpenedKey = { key: CryptoKey; raw: Uint8Array<ArrayBuffer> }

export async function unwrapWithSecret(wrapKey: CryptoKey, keyBySecret: string): Promise<OpenedKey> {
  try {
    const raw = await open(wrapKey, keyBySecret, AAD_KEY)
    return { key: await importVaultKey(raw), raw }
  } catch (err) {
    if (err instanceof VaultError) throw err
    throw new VaultError('wrong_secret')
  }
}

export async function unwrapWithRecovery(code: string, keyByRecovery: string): Promise<OpenedKey> {
  const wrap = await recoveryWrapKey(code)
  try {
    const raw = await open(wrap, keyByRecovery, AAD_KEY)
    return { key: await importVaultKey(raw), raw }
  } catch {
    throw new VaultError('wrong_recovery')
  }
}

export async function encryptData(key: CryptoKey, data: VaultData): Promise<string> {
  return seal(key, enc.encode(JSON.stringify({ v: 1, ...data })), AAD_DATA)
}

export async function decryptData(key: CryptoKey, blob: string): Promise<VaultData> {
  try {
    const { v: _v, ...data } = JSON.parse(dec.decode(await open(key, blob, AAD_DATA))) as VaultData & { v?: number }
    return data
  } catch {
    throw new VaultError('corrupt')
  }
}

/**
 * Tranca a chave do cofre pela senha e pelo código de recuperação. Sem `opened`, cria uma chave
 * nova (cofre novo); sem `recoveryCode`, gera um código novo.
 */
export async function sealVault(
  wrapKey: CryptoKey,
  data: VaultData,
  opened?: OpenedKey,
  recoveryCode?: string,
): Promise<{ sealed: SealedVault; key: CryptoKey; recoveryCode: string }> {
  const raw = opened?.raw ?? random(32)
  const key = opened?.key ?? (await importVaultKey(raw))
  const code = recoveryCode ?? newRecoveryCode()
  const sealed: SealedVault = {
    key_by_secret: await seal(wrapKey, raw, AAD_KEY),
    key_by_recovery: await seal(await recoveryWrapKey(code), raw, AAD_KEY),
    data: await encryptData(key, data),
  }
  return { sealed, key, recoveryCode: code }
}

// ---- chave guardada neste navegador (IndexedDB, não exportável) -------------------------------

const DB = 'upkeeper-vault'
const STORE = 'keys'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await db()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(conn.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    conn.close()
  }
}

/** Sem IndexedDB (aba anônima em alguns navegadores): o cofre só fica aberto até recarregar. */
const memory = new Map<number, CryptoKey>()

export async function storeKey(userId: number, key: CryptoKey) {
  memory.set(userId, key)
  try {
    await tx('readwrite', (s) => s.put(key, userId))
  } catch {
    /* fica só na memória */
  }
}

export async function loadKey(userId: number): Promise<CryptoKey | null> {
  if (memory.has(userId)) return memory.get(userId)!
  try {
    const key = (await tx<CryptoKey | undefined>('readonly', (s) => s.get(userId))) ?? null
    if (key) memory.set(userId, key)
    return key
  } catch {
    return null
  }
}

export async function forgetKeys() {
  memory.clear()
  try {
    await tx('readwrite', (s) => s.clear())
  } catch {
    /* nada guardado */
  }
}
