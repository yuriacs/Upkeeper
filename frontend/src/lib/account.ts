/*
 * Cadastro, login e cofre: a parte que acontece no navegador antes de falar com o servidor.
 * A senha nunca é enviada; vai a auth_key derivada dela (lib/vault.ts).
 */
import { api, setAuthToken } from './api'
import type { AuthResponse, User, VaultPayload } from './types'
import {
  decryptData,
  deriveSecretKeys,
  encryptData,
  newSalt,
  sealVault,
  storeKey,
  unwrapWithRecovery,
  unwrapWithSecret,
  type OpenedKey,
  type SecretKeys,
  type VaultData,
} from './vault'

export type AuthResult = { res: AuthResponse; recoveryCode?: string }

export async function registerAccount(username: string, email: string, password: string): Promise<AuthResult> {
  const salt = newSalt()
  const { authKey, wrapKey } = await deriveSecretKeys(password, salt)
  const { sealed, key, recoveryCode } = await sealVault(wrapKey, { email: email.trim() })
  const res = await api.register({ username, email, auth_key: authKey, salt, vault: sealed })
  await storeKey(res.user.id, key)
  return { res, recoveryCode }
}

export async function loginAccount(login: string, password: string): Promise<AuthResult> {
  const pre = await api.prelogin(login)
  let res: AuthResponse
  let keys: SecretKeys
  if (pre.scheme === 'legacy' || !pre.salt) {
    // Conta antiga: manda a senha uma última vez e passa para a chave derivada
    const salt = newSalt()
    keys = await deriveSecretKeys(password, salt)
    res = await api.login({ login, password, upgrade: { auth_key: keys.authKey, salt } })
  } else {
    keys = await deriveSecretKeys(password, pre.salt, pre.iterations)
    res = await api.login({ login, auth_key: keys.authKey })
  }
  // Já está logado. Abrir o cofre é extra: se falhar, abre depois na página da conta.
  let recoveryCode: string | undefined
  try {
    setAuthToken(res.token)
    // Entrou pelo e-mail: ele é desta conta (a impressão digital bateu), então vai para o cofre
    const typedEmail = login.includes('@') ? login.trim() : undefined
    recoveryCode = await openOrCreateVault(res.user.id, keys, typedEmail)
  } catch {
    /* cofre fica trancado */
  }
  return { res, recoveryCode }
}

async function openOrCreateVault(userId: number, { authKey, wrapKey }: SecretKeys, typedEmail?: string) {
  const v = await api.vault()
  if (v.exists) {
    const opened = await unwrapWithSecret(wrapKey, v.key_by_secret)
    await storeKey(userId, opened.key)
    if (typedEmail) {
      const data = await decryptData(opened.key, v.data)
      if (!data.email) await api.patchVault(await encryptData(opened.key, { ...data, email: typedEmail }), v.version)
    }
    return undefined
  }
  const { sealed, key, recoveryCode } = await sealVault(wrapKey, typedEmail ? { email: typedEmail } : {})
  await api.putVault({ ...sealed, version: v.version, auth_key: authKey })
  await storeKey(userId, key)
  return recoveryCode
}

/** Prova da senha para ações sensíveis (excluir a conta, trocar o cofre). */
export async function passwordProof(user: User, password: string): Promise<{ auth_key: string } | { password: string }> {
  if (user.auth_scheme === 'legacy') return { password }
  const v = await api.vault()
  return { auth_key: (await deriveSecretKeys(password, v.salt, v.iterations)).authKey }
}

// ---- cofre já logado ------------------------------------------------------------------------

/** Abre o cofre com a senha (ou senha do cofre) e devolve também as chaves para trancar de novo. */
export async function openWithSecret(v: VaultPayload, secret: string) {
  const keys = await deriveSecretKeys(secret, v.salt, v.iterations)
  const opened = await unwrapWithSecret(keys.wrapKey, v.key_by_secret)
  return { opened, keys }
}

export async function openWithRecovery(v: VaultPayload, code: string): Promise<OpenedKey> {
  return unwrapWithRecovery(code, v.key_by_recovery)
}

/**
 * Cria o cofre (conta que ainda não tem) ou tranca de novo com um código de recuperação novo.
 * Conta com senha: `secret` é a senha da conta. Conta só Google/Discord: é a senha do cofre
 * (na criação, ganha um salt novo).
 */
export async function sealWithSecret(
  user: User,
  v: VaultPayload,
  secret: string,
  data: VaultData,
  opened?: OpenedKey,
): Promise<{ payload: VaultPayload; key: CryptoKey; recoveryCode: string }> {
  const ownSalt = !user.has_password && !v.exists
  const salt = ownSalt ? newSalt() : v.salt
  const keys = await deriveSecretKeys(secret, salt, ownSalt ? undefined : v.iterations)
  if (v.exists && !opened) opened = await unwrapWithSecret(keys.wrapKey, v.key_by_secret)
  const { sealed, key, recoveryCode } = await sealVault(keys.wrapKey, data, opened)
  const payload = await api.putVault({
    ...sealed,
    version: v.version,
    ...(ownSalt ? { salt } : {}),
    ...(user.has_password ? { auth_key: keys.authKey } : {}),
  })
  await storeKey(user.id, key)
  return { payload, key, recoveryCode }
}

// ---- esqueci a senha ------------------------------------------------------------------------

/**
 * Nova senha pelo link do e-mail. Com o código de recuperação, o cofre é trancado de novo com a
 * senha nova (mesmo conteúdo). Sem ele, começa um cofre vazio com um código novo.
 */
export async function resetPassword(
  uid: string,
  token: string,
  password: string,
  vault: { exists: boolean; key_by_recovery: string; data: string },
  recoveryCode?: string,
): Promise<{ username: string; recoveryCode?: string }> {
  const salt = newSalt()
  const { authKey, wrapKey } = await deriveSecretKeys(password, salt)
  let sealed
  let newCode: string | undefined
  if (vault.exists && recoveryCode) {
    const opened = await unwrapWithRecovery(recoveryCode, vault.key_by_recovery)
    const data = await decryptData(opened.key, vault.data)
    sealed = (await sealVault(wrapKey, data, opened, recoveryCode)).sealed
  } else {
    const fresh = await sealVault(wrapKey, {})
    sealed = fresh.sealed
    newCode = fresh.recoveryCode
  }
  const { username } = await api.resetPassword({ uid, token, auth_key: authKey, salt, vault: sealed })
  return { username, recoveryCode: newCode }
}
