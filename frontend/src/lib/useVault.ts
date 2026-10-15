import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { openWithRecovery, openWithSecret, sealWithSecret } from './account'
import { api } from './api'
import { useAuth } from './auth'
import { showRecoveryCode } from './recoveryCode'
import type { VaultPayload } from './types'
import { decryptData, encryptData, forgetKeys, loadKey, storeKey, type VaultData } from './vault'

/**
 * Estado do perfil privado (cofre) da conta logada:
 * - relogin: conta antiga ainda logada desde antes; precisa entrar de novo
 * - none: ainda não tem cofre
 * - locked: tem, mas a chave não está neste navegador
 * - open: aberto, com `data`
 */
export type VaultStatus = 'loading' | 'error' | 'relogin' | 'none' | 'locked' | 'open'

export function useVault() {
  const { user, updateUser } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id
  const query = useQuery({
    queryKey: ['vault', userId],
    queryFn: api.vault,
    enabled: !!userId,
    staleTime: Infinity,
  })
  const payload = query.data
  // undefined = ainda procurando a chave neste navegador
  const [key, setKey] = useState<CryptoKey | null | undefined>(undefined)
  useEffect(() => {
    if (!userId) return
    let alive = true
    void loadKey(userId).then((k) => alive && setKey(k))
    return () => {
      alive = false
    }
  }, [userId])

  // Conteúdo aberto, ligado ao cofre e à chave de onde veio (null = a chave não abriu)
  const [opened, setOpened] = useState<{ payload: VaultPayload; key: CryptoKey; data: VaultData | null } | null>(null)
  useEffect(() => {
    if (!key || !payload?.exists) return
    let alive = true
    decryptData(key, payload.data)
      .then((d) => alive && setOpened({ payload, key, data: d }))
      // Chave velha (o cofre foi trocado em outro aparelho): pede para abrir de novo
      .catch(() => alive && setOpened({ payload, key, data: null }))
    return () => {
      alive = false
    }
  }, [key, payload])
  const current = opened && opened.payload === payload && opened.key === key ? opened : null
  const data = current?.data ?? null
  const stale = !!current && current.data === null

  const setPayload = useCallback(
    (p: VaultPayload) => queryClient.setQueryData(['vault', userId], p),
    [queryClient, userId],
  )

  let status: VaultStatus
  if (!user) status = 'loading'
  else if (user.has_password && user.auth_scheme === 'legacy') status = 'relogin'
  else if (query.isError) status = 'error'
  else if (!payload) status = 'loading'
  else if (!payload.exists) status = 'none'
  else if (key === undefined) status = 'loading'
  else if (!key || stale) status = 'locked'
  else if (!data) status = 'loading'
  else status = 'open'

  const adopt = async (k: CryptoKey) => {
    if (user) await storeKey(user.id, k)
    setKey(k)
  }

  return {
    status,
    data,
    payload,
    /** O que tranca o cofre: a senha da conta ou a senha do cofre (conta só Google/Discord) */
    secretKind: payload?.secret ?? (user?.has_password ? 'password' : 'vault_password'),
    refetch: query.refetch,

    unlock: async (secret: string) => {
      const { opened } = await openWithSecret(payload!, secret)
      await adopt(opened.key)
    },
    unlockWithRecovery: async (code: string) => {
      await adopt((await openWithRecovery(payload!, code)).key)
    },
    /** Cria o cofre, ou tranca de novo com um código de recuperação novo (mostra o código) */
    seal: async (secret: string) => {
      const { payload: p, key: k, recoveryCode } = await sealWithSecret(user!, payload!, secret, data ?? {})
      setPayload(p)
      await adopt(k)
      updateUser({ ...user!, has_vault: true })
      showRecoveryCode(recoveryCode)
    },
    save: async (next: VaultData) => {
      const p = await api.patchVault(await encryptData(key!, next), payload!.version)
      setOpened({ payload: p, key: key!, data: next })
      setPayload(p)
    },
    /** Troca o e-mail: impressão digital no servidor, cópia legível no cofre */
    setEmail: async (email: string) => {
      const res = await api.setEmail(email)
      updateUser(res.user)
      const next = { ...data, email: email.trim() }
      const p = await api.patchVault(await encryptData(key!, next), payload!.version)
      setOpened({ payload: p, key: key!, data: next })
      setPayload(p)
    },
    lock: async () => {
      await forgetKeys()
      setKey(null)
    },
  }
}
