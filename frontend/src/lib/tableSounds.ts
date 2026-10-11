/*
 * Sons da mesa virtual, sintetizados com Web Audio (sem arquivos para baixar).
 * O navegador só libera o áudio depois do primeiro clique na página; antes disso os sons são ignorados.
 */
import { readJSON, writeJSON } from './storage'

export type SoundName = 'coin' | 'dice' | 'shuffle' | 'draw' | 'reveal' | 'chat' | 'join' | 'turn'

const MUTE_KEY = 'precon-draft:table-muted'
let muted = readJSON<boolean>(MUTE_KEY, false)
let ctx: AudioContext | null = null

export const isMuted = () => muted
export function setMuted(value: boolean) {
  muted = value
  writeJSON(MUTE_KEY, value)
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Um tom curto com ataque rápido e queda exponencial. */
function tone(ac: AudioContext, freq: number, start: number, dur: number, gain = 0.2, type: OscillatorType = 'sine') {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g).connect(ac.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

/** Ruído filtrado (dados rolando, cartas embaralhando). */
function noise(ac: AudioContext, start: number, dur: number, gain = 0.15, freq = 2500) {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = ac.createBufferSource()
  src.buffer = buffer
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  const g = ac.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(ac.destination)
  src.start(start)
}

export function playSound(name: SoundName) {
  if (muted) return
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + 0.01
  switch (name) {
    case 'coin':
      // "tim" metálico duas vezes
      tone(ac, 1760, t, 0.35, 0.12, 'triangle')
      tone(ac, 2637, t + 0.08, 0.5, 0.08, 'sine')
      break
    case 'dice':
      // batidas curtas e irregulares
      for (let i = 0; i < 6; i++)
        noise(ac, t + i * 0.07 + Math.random() * 0.03, 0.05, 0.25, 1200 + Math.random() * 1500)
      break
    case 'shuffle':
      for (let i = 0; i < 10; i++) noise(ac, t + i * 0.035, 0.04, 0.12, 3500)
      break
    case 'draw':
      noise(ac, t, 0.08, 0.1, 5000)
      break
    case 'reveal':
      tone(ac, 523.25, t, 0.4, 0.12)
      tone(ac, 659.25, t + 0.1, 0.4, 0.12)
      tone(ac, 783.99, t + 0.2, 0.6, 0.12)
      break
    case 'chat':
      tone(ac, 880, t, 0.15, 0.08)
      tone(ac, 1320, t + 0.07, 0.2, 0.06)
      break
    case 'turn':
      // gongo curto: passou o turno
      tone(ac, 220, t, 0.8, 0.14, 'triangle')
      tone(ac, 330, t + 0.02, 0.7, 0.08, 'sine')
      break
    case 'join':
      tone(ac, 392, t, 0.25, 0.08)
      tone(ac, 587.33, t + 0.12, 0.35, 0.08)
      break
  }
}
