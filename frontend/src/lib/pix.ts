/*
 * Código Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central), gerado no navegador.
 * Os dados vêm das variáveis da Vercel: VITE_PIX_KEY, VITE_PIX_NAME e VITE_PIX_CITY.
 */

export const PIX_KEY: string = (import.meta.env.VITE_PIX_KEY ?? '').trim()
export const PIX_NAME: string = (import.meta.env.VITE_PIX_NAME ?? '').trim()
export const PIX_CITY: string = (import.meta.env.VITE_PIX_CITY ?? '').trim()
export const PIX_ENABLED = !!(PIX_KEY && PIX_NAME && PIX_CITY)

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`

/** Sem acento, maiúsculas e só caracteres que todos os bancos aceitam */
const plain = (text: string, max: number) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .toUpperCase()
    .trim()
    .slice(0, max)

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como pede o padrão do Pix */
export function crc16(text: string): string {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Código "copia e cola". `amount` em reais (sem valor: a pessoa digita no banco). `username`: quem
 * doa logado leva o nome de usuário na descrição e no identificador do Pix, que aparecem no extrato
 * de quem recebe, para o admin ativar os perks de apoiador na conta certa.
 */
export function pixPayload(
  { key, name, city }: { key: string; name: string; city: string },
  amount?: number | null,
  username?: string | null,
): string {
  // Descrição (campo 02 da conta): o campo 26 inteiro não passa de 99 caracteres
  const room = 99 - field('00', 'br.gov.bcb.pix').length - field('01', key).length - 4
  // Nome de usuário como está (letras, números, ponto, hífen e sublinhado), para o admin achar a conta
  const who = username ? username.replace(/[^A-Za-z0-9._-]/g, '') : ''
  const note = who && room > 8 ? `Upkeeper ${who}`.slice(0, Math.min(room, 72)) : ''
  const account = field('00', 'br.gov.bcb.pix') + field('01', key) + (note ? field('02', note) : '')
  const txid = username ? username.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) : ''
  const body =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (amount && amount > 0 ? field('54', amount.toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', plain(name, 25)) +
    field('60', plain(city, 15)) +
    field('62', field('05', txid || '***')) +
    '6304'
  return body + crc16(body)
}
