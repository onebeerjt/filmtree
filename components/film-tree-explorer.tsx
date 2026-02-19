"use client";

import { useEffect, useState } from "react";
import { FilmTreeGraph } from "@/components/film-tree-graph";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { MovieSearch } from "@/components/movie-search";
import { FilmTreeResponse, MovieSummary } from "@/lib/types";

type CacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

const TREE_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

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
    const cacheKey = `film-tree:tree:${movieId}`;
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
    <section className="space-y-4">
      <MovieSearch onMovieSelect={handleSearchSelect} disabled={isLoading} />

      {error && <p className="rounded-lg border border-red-600/50 bg-red-900/30 px-3 py-2 text-sm text-red-200">{error}</p>}

      {isLoading && !tree ? (
        <LoadingSkeleton />
      ) : tree ? (
        <>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3">
            <p className="text-sm text-zinc-200">
              Center movie: <span className="font-semibold text-white">{tree.centerTitle}</span>
            </p>
            <p className="text-xs text-zinc-500">Tap or click a movie node to re-center the tree.</p>
          </div>
          <FilmTreeGraph nodes={tree.nodes} links={tree.links} onMovieClick={fetchTree} />
        </>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 text-sm text-zinc-400">
          Search a movie title to generate a connection graph.
        </div>
      )}
    </section>
  );
}
