export default function DeckTileSkeleton() {
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-surface" aria-hidden>
      <div className="skeleton absolute inset-0" />
      <div className="absolute inset-x-3 bottom-3 space-y-2">
        <div className="skeleton h-6 w-2/3 rounded" />
        <div className="skeleton h-4 w-1/2 rounded" />
      </div>
    </div>
  )
}
