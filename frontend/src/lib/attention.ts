/*
 * Chamar a atenção de quem está com a aba em segundo plano (sua vez na mesa, partida achada na
 * fila): o título da aba pisca, toca um som e, se a pessoa permitiu, aparece a notificação do
 * navegador. Com a aba à vista não faz nada (a própria página já mostra). O título volta quando
 * a aba aparece de novo.
 */
import { playSound } from './tableSounds'

let timer: number | null = null
let saved = ''

function stop() {
  if (document.hidden || timer === null) return
  window.clearInterval(timer)
  timer = null
  document.title = saved
  document.removeEventListener('visibilitychange', stop)
}

/** O navegador permite notificações (ou ainda não perguntou: 'default') */
export function notifyPermission(): NotificationPermission | 'unsupported' {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
}

/** Pede para mostrar notificações (só funciona a partir de um clique) */
export async function askNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (notifyPermission() === 'unsupported') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/**
 * `flash`: o texto que alterna com o título; `notice`: a notificação do navegador (`tag` evita
 * empilhar várias da mesma mesa).
 */
export function callAttention(flash: string, notice?: { title: string; body?: string; tag?: string }) {
  if (typeof document === 'undefined' || !document.hidden) return
  playSound('your_turn')
  if (timer === null) {
    saved = document.title
    let on = false
    timer = window.setInterval(() => {
      on = !on
      document.title = on ? flash : saved
    }, 1000)
    document.addEventListener('visibilitychange', stop)
  }
  if (notice && notifyPermission() === 'granted') {
    try {
      const n = new Notification(notice.title, { body: notice.body, tag: notice.tag, icon: '/favicon-32.png' })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch {
      /* Android: só por service worker; o título e o som já avisam */
    }
  }
}
