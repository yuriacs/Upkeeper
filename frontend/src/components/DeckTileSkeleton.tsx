export default function DeckTileSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-gold/10 bg-surface" aria-hidden>
      <div className="skeleton aspect-[4/3]" />
      <div className="space-y-2 p-4">
        <div className="skeleton h-5 w-2/3 rounded" />
        <div className="skeleton h-4 w-1/2 rounded" />
        <div className="skeleton mt-4 h-3 w-1/3 rounded" />
      </div>
    </div>
  )
}
