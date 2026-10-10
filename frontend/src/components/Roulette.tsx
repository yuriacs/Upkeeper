import { useEffect, useRef, useState } from 'react'

/**
 * Gira artes de comandantes cada vez mais devagar até `duration` ms e chama onDone.
 * Puramente visual: o deck real já foi sorteado no servidor.
 */
export default function Roulette({ arts, duration, onDone }: { arts: string[]; duration: number; onDone: () => void }) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * Math.max(arts.length, 1)))
  // A duração vale a partir da montagem (o componente pode re-renderizar com valores novos)
  const length = useRef(duration)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  }, [onDone])

  useEffect(() => {
    const start = performance.now()
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const progress = (performance.now() - start) / length.current
      if (progress >= 1) {
        done.current()
        return
      }
      setIndex((i) => (i + 1 + Math.floor(Math.random() * 3)) % Math.max(arts.length, 1))
      // Começa rápido (~60 ms) e desacelera até ~320 ms entre trocas
      timer = setTimeout(tick, 60 + progress * progress * 260)
    }
    timer = setTimeout(tick, 60)
    return () => clearTimeout(timer)
  }, [arts.length])

  const art = arts[index]
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-surface shadow-lg shadow-black/50 ring-1 ring-white/5">
      {art && <img src={art} alt="" className="h-full w-full scale-110 object-cover blur-[1px] brightness-75" />}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-7xl text-parchment drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">?</span>
      </div>
    </div>
  )
}
