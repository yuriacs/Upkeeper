import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../lib/api'

const POSES = [
  'rotate-[-14deg] translate-x-10 translate-y-3',
  'z-10 -translate-y-1',
  'rotate-[14deg] -translate-x-10 translate-y-3',
]

/** Três artes de comandantes em leque, escolhidas ao acaso a cada visita. */
export default function HeroFan() {
  const pool = useQuery({ queryKey: ['roulette-pool'], queryFn: () => api.decks({}, 1, 200), staleTime: Infinity })
  // Sorteado uma vez por visita; a escolha das artes deriva dele sem chamar Math.random no render
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const arts = useMemo(() => {
    const all = (pool.data?.results ?? []).map((d) => d.face_commander?.image_art_crop).filter(Boolean) as string[]
    const picked: string[] = []
    let x = seed
    while (all.length && picked.length < 3) {
      x = (x * 1103515245 + 12345) % 2 ** 31
      picked.push(all.splice(x % all.length, 1)[0])
    }
    return picked
  }, [pool.data, seed])

  return (
    <div className="flex justify-center pb-5 pt-1" aria-hidden>
      {POSES.map((pose, i) => (
        <div
          key={i}
          className={`h-28 w-20 overflow-hidden rounded-lg border-2 border-gold/50 bg-surface shadow-xl shadow-black/60 sm:h-36 sm:w-26 ${pose}`}
        >
          {arts[i] ? (
            <img
              src={arts[i]}
              alt=""
              className="flip-in h-full w-full object-cover"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ) : (
            <div className="skeleton h-full w-full" />
          )}
        </div>
      ))}
    </div>
  )
}
