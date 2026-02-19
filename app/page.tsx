import { FilmTreeExplorer } from "@/components/film-tree-explorer";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-bg px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Film Tree</h1>
          <p className="max-w-2xl text-sm text-zinc-300 sm:text-base">
            Explore how movies connect through shared cast and crew.
          </p>
        </header>
        <FilmTreeExplorer />
      </div>
    </main>
  );
}
