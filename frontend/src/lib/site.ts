// Dados públicos do site. Defina VITE_CONTACT_EMAIL na Vercel (e no .env local) com o e-mail
// de contato para pedidos sobre dados pessoais (LGPD).
export const SITE_NAME = 'Choose at random'
export const CONTACT_EMAIL: string = import.meta.env.VITE_CONTACT_EMAIL ?? ''
// Data ISO (AAAA-MM-DD); a página formata no idioma atual.
export const PRIVACY_UPDATED_AT = '2026-10-10'
export const KOFI_URL = 'https://ko-fi.com/chooseatrandom'
