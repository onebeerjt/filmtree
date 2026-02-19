"use client";

import { useEffect, useState } from "react";
import { FilmTreeGraph } from "@/components/film-tree-graph";
import { MovieSearch } from "@/components/movie-search";
import { FilmTreeResponse, MovieSummary } from "@/lib/types";

type CacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

const TREE_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const TREE_CACHE_VERSION = "v5";

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

export function FilmTreeExplorer() {
  const [tree, setTree] = useState<FilmTreeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchTree(movieId: number) {
    const cacheKey = `film-tree:tree:${TREE_CACHE_VERSION}:${movieId}`;
    const cached = getTreeCache<FilmTreeResponse>(cacheKey);

    if (cached) {
      setTree(cached);
      setError(null);
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
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSearchSelect(movie: MovieSummary) {
    await fetchTree(movie.id);
  }

  useEffect(() => {
    const bootstrap = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/tmdb/search?query=${encodeURIComponent("Inception")}`);
        const payload = await response.json();
        const movie = (payload.results?.[0] ?? null) as MovieSummary | null;
        if (movie) {
          await fetchTree(movie.id);
        }
      } catch {
        setError("Unable to load default movie. Search above to begin.");
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();
  }, []);

  return (
    <section className="relative h-full w-full">
      {tree && <FilmTreeGraph nodes={tree.nodes} links={tree.links} onMovieClick={fetchTree} />}

      {!tree && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
          Search a movie title to generate a connection graph.
        </div>
      )}

      <div className="pointer-events-none absolute left-0 top-0 z-20 w-full p-3 sm:p-6">
        <div className="pointer-events-auto w-full max-w-xl rounded-2xl border border-zinc-700/60 bg-zinc-950/70 p-4 shadow-2xl backdrop-blur-xl sm:p-5">
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">Film Tree</h1>
          <p className="mt-2 text-sm text-zinc-300 sm:text-base">Type a title, hit Enter, then explore by clicking any movie node.</p>
          <div className="mt-4">
            <MovieSearch onMovieSelect={handleSearchSelect} disabled={isLoading} />
          </div>

          <div className="mt-3 flex items-center justify-between gap-4 text-xs text-zinc-400">
            <p>
              Center: <span className="font-semibold text-zinc-100">{tree?.centerTitle ?? "Loading..."}</span>
            </p>
            <p>Scroll to zoom. Drag to orbit.</p>
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-red-600/50 bg-red-900/30 px-3 py-2 text-sm text-red-200">{error}</p>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 bg-black/20">
          <div className="absolute right-3 top-3 rounded-full border border-zinc-700 bg-zinc-950/80 px-3 py-1 text-xs text-zinc-300 sm:right-6 sm:top-6">
            Building branches...
          </div>
        </div>
      )}
    </section>
  );
}
