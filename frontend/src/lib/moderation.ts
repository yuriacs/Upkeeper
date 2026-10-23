/*
 * Denúncia de imagens enviadas pelos jogadores (foto de perfil, fundo da mesa e artes de cartas e
 * fichas): qualquer jogador denuncia a de outra pessoa e a imagem vai para a fila do painel de admin.
 */
import { api, ApiError } from './api'
import type { Vars } from './i18n'

const UPLOADED = /\/api\/(avatar|card-art|playmat|sleeve)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/

/** O endereço é de uma imagem enviada por um jogador (dá para denunciar) */
export const isUploadedImage = (url: string | null | undefined): url is string => !!url && UPLOADED.test(url)

/**
 * Pergunta antes e denuncia. Devolve o texto para mostrar ao jogador (null se ele desistiu).
 */
export async function reportImage(url: string, t: (text: string, vars?: Vars) => string): Promise<string | null> {
  if (!window.confirm(t('Report this image as offensive or inappropriate? An admin will review it.'))) return null
  try {
    await api.reportImage(url)
    return t('Thanks! The image was reported and an admin will review it.')
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) return t('You sent too many reports. Try again tomorrow.')
    if (err instanceof ApiError && err.status === 404) return t('This image is no longer available.')
    return err instanceof Error ? err.message : t('Could not send the report.')
  }
}
