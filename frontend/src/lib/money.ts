/** Valor em dinheiro no idioma de quem lê (US$ 61,50 / $61.50) */
export function money(value: string | number | null | undefined, currency: 'USD' | 'EUR', locale: string, whole = false) {
  const n = typeof value === 'string' ? Number(value) : value
  if (n === null || n === undefined || Number.isNaN(n)) return null
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: whole ? 0 : 2,
    minimumFractionDigits: whole ? 0 : 2,
  }).format(n)
}
