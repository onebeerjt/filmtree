export function LoadingSkeleton() {
  return (
    <div className="h-[68vh] w-full animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="mb-6 h-8 w-2/5 rounded bg-zinc-800" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-20 rounded-xl bg-zinc-800" />
        <div className="h-20 rounded-xl bg-zinc-800" />
        <div className="h-20 rounded-xl bg-zinc-800" />
      </div>
      <div className="mt-6 h-[70%] rounded-xl bg-zinc-800" />
    </div>
  );
}
