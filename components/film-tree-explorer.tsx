"use client";

import { useEffect, useState } from "react";
import { FilmTreeGraph } from "@/components/film-tree-graph";
import { MovieSearch } from "@/components/movie-search";
import { FilmTreeResponse, GraphNode, MovieSummary } from "@/lib/types";

type CacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

const TREE_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const TREE_CACHE_VERSION = "v7";

type JourneyStep = {
  id: string;
  kind: "movie" | "person";
  label: string;
};

function getTreeCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function setTreeCache<T>(key: string, value: T, ttlMs: number) {
  if (typeof window === "undefined") return;
  const payload: CacheEnvelope<T> = {
    expiresAt: Date.now() + ttlMs,
    value
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function FilmTreeExplorer() {
  const [tree, setTree] = useState<FilmTreeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(true);
  const [showLegendMobile, setShowLegendMobile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingMovieId, setPendingMovieId] = useState<number | null>(null);
  const [failedMovieId, setFailedMovieId] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [journey, setJourney] = useState<JourneyStep[]>([]);
  const [rootMovieId, setRootMovieId] = useState<number | null>(null);
  const [rootMovieTitle, setRootMovieTitle] = useState<string>("");

  function pushJourneyStep(node: GraphNode) {
    const label = node.type === "movie" ? node.title ?? "Untitled" : `${node.name ?? "Unknown"} (${node.role ?? "Person"})`;
    const step: JourneyStep = {
      id: node.id,
      kind: node.type,
      label
    };

    setJourney((prev) => {
      if (prev[prev.length - 1]?.id === step.id) return prev;
      return [...prev, step].slice(-18);
    });
  }

  async function fetchTree(movieId: number, options?: { fromGraphClick?: boolean }) {
    const cacheKey = `film-tree:tree:${TREE_CACHE_VERSION}:${movieId}`;

    if (options?.fromGraphClick) {
      setPendingMovieId(movieId);
      await sleep(200);
    }

    const cached = getTreeCache<FilmTreeResponse>(cacheKey);
    if (cached) {
      setTree(cached);
      setError(null);
      setPendingMovieId(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tmdb/tree?movieId=${movieId}`);
      const payload = (await response.json()) as FilmTreeResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load graph");
      }

      setTree(payload);
      setTreeCache(cacheKey, payload, TREE_CACHE_TTL_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error while loading graph";
      setError(message);
      setToast("Couldn't load connections");
      setFailedMovieId(movieId);
      setTimeout(() => setFailedMovieId(null), 900);
    } finally {
      setPendingMovieId(null);
      setIsLoading(false);
    }
  }

  async function handleSearchSelect(movie: MovieSummary) {
    setRootMovieId(movie.id);
    setRootMovieTitle(movie.title);
    setJourney([
      {
        id: `movie-${movie.id}`,
        kind: "movie",
        label: movie.title
      }
    ]);
    await fetchTree(movie.id);
  }

  async function handleGraphMovieClick(movieId: number) {
    await fetchTree(movieId, { fromGraphClick: true });
  }

  useEffect(() => {
    const bootstrap = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/tmdb/search?query=${encodeURIComponent("Inception")}`);
        const payload = await response.json();
        const movie = (payload.results?.[0] ?? null) as MovieSummary | null;
        if (movie) {
          setRootMovieId(movie.id);
          setRootMovieTitle(movie.title);
          setJourney([
            {
              id: `movie-${movie.id}`,
              kind: "movie",
              label: movie.title
            }
          ]);
          await fetchTree(movie.id);
        }
      } catch {
        setError("Unable to load default movie.");
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();
    const timer = setTimeout(() => setShowHint(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < 768);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  async function handleResetJourney() {
    if (!rootMovieId) return;
    setJourney([
      {
        id: `movie-${rootMovieId}`,
        kind: "movie",
        label: rootMovieTitle || "Start"
      }
    ]);
    await fetchTree(rootMovieId);
  }

  return (
    <section className="relative h-full w-full overflow-hidden">
      {tree && (
        <div className={`h-full w-full transition-opacity duration-300 ${isLoading || pendingMovieId ? "opacity-30" : "opacity-100"}`}>
          <FilmTreeGraph
            nodes={tree.nodes}
            links={tree.links}
            onMovieClick={handleGraphMovieClick}
            onExploreStep={pushJourneyStep}
            pendingMovieId={pendingMovieId}
            failedMovieId={failedMovieId}
          />
        </div>
      )}

      {!tree && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
          Search a movie title to generate a connection graph.
        </div>
      )}

      <div className="pointer-events-none absolute left-1/2 top-6 z-30 w-[min(90vw,480px)] -translate-x-1/2">
        <div className="pointer-events-auto rounded-full border border-zinc-700/60 bg-zinc-950/55 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <MovieSearch
            onMovieSelect={handleSearchSelect}
            disabled={isLoading}
            isLoading={isLoading || Boolean(pendingMovieId)}
            placeholder="Search any film..."
          />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-6 z-30 rounded-full border border-zinc-700/70 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 backdrop-blur-xl">
        Center: <span className="font-semibold text-white">{tree?.centerTitle ?? "Loading..."}</span>
      </div>

      <div className="absolute left-6 top-24 z-30 w-[min(90vw,340px)]">
        <div className="rounded-2xl border border-zinc-700/70 bg-zinc-950/50 p-3 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Journey</p>
            <button
              type="button"
              onClick={() => {
                void handleResetJourney();
              }}
              className="rounded-full border border-zinc-600/80 bg-zinc-900/70 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-[#c9a84c] hover:text-white"
            >
              Reset
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto pr-1 text-xs text-zinc-200">
            {journey.length === 0 ? (
              <p className="text-zinc-400">Start exploring to build your path.</p>
            ) : (
              <p className="leading-6">
                {journey.map((step, idx) => (
                  <span key={`${step.id}-${idx}`}>
                    <span className={step.kind === "movie" ? "text-white" : "text-zinc-300"}>{step.label}</span>
                    {idx < journey.length - 1 ? <span className="px-2 text-[#c9a84c]">→</span> : null}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={`pointer-events-none absolute bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full border border-zinc-700/60 bg-zinc-950/50 px-3 py-1 text-xs text-zinc-300 backdrop-blur-lg transition-opacity duration-500 ${showHint ? "opacity-100" : "opacity-0"}`}>
        Scroll to zoom. Drag to orbit.
      </div>

      <div className="absolute bottom-6 right-6 z-30">
        {isMobile && (
          <button
            type="button"
            onClick={() => setShowLegendMobile((prev) => !prev)}
            className="mb-2 rounded-full border border-zinc-700/80 bg-zinc-950/60 px-3 py-1 text-xs text-zinc-200 backdrop-blur"
          >
            Legend
          </button>
        )}
        {(!isMobile || showLegendMobile) && (
          <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/55 px-3 py-2 text-xs text-zinc-200 backdrop-blur-xl">
            <p className="mb-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#C9A84C]" /> Director</p>
            <p className="mb-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#4A90D9]" /> Actor</p>
            <p className="mb-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#9B59B6]" /> Writer</p>
            <p className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#1ABC9C]" /> Producer</p>
          </div>
        )}
      </div>

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-40 -translate-x-1/2 rounded-full border border-red-500/60 bg-red-950/75 px-4 py-2 text-sm text-red-100 backdrop-blur">
          {toast}
        </div>
      )}

      {error && !toast && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-40 -translate-x-1/2 rounded-full border border-red-500/60 bg-red-950/75 px-4 py-2 text-sm text-red-100 backdrop-blur">
          {error}
        </div>
      )}
    </section>
  );
}
