"use client";

import { useEffect, useRef, useState } from "react";
import { MovieSummary } from "@/lib/types";

type Props = {
  onMovieSelect: (movie: MovieSummary) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
};

type CacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

const SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

function getCache<T>(key: string): T | null {
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

function setCache<T>(key: string, value: T, ttlMs: number) {
  if (typeof window === "undefined") return;
  const envelope: CacheEnvelope<T> = {
    expiresAt: Date.now() + ttlMs,
    value
  };
  localStorage.setItem(key, JSON.stringify(envelope));
}

export function MovieSearch({
  onMovieSelect,
  disabled = false,
  isLoading = false,
  placeholder = "Search any film..."
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showList, setShowList] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setShowList(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      const cacheKey = `film-tree:search:${trimmed.toLowerCase()}`;
      const cached = getCache<MovieSummary[]>(cacheKey);
      if (cached) {
        setResults(cached);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(`/api/tmdb/search?query=${encodeURIComponent(trimmed)}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Search request failed");
        }

        const movies = (payload.results ?? []) as MovieSummary[];
        setResults(movies.slice(0, 6));
        setCache(cacheKey, movies.slice(0, 6), SEARCH_CACHE_TTL_MS);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 320);

    return () => clearTimeout(timeout);
  }, [query]);

  function normalizeTitle(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function selectMovie(movie: MovieSummary) {
    const year = movie.release_date?.slice(0, 4) || "N/A";
    onMovieSelect(movie);
    setQuery(`${movie.title} (${year})`);
    setShowList(false);
  }

  function pickBestMatch(input: string, movies: MovieSummary[]) {
    const normalizedInput = normalizeTitle(input);
    const exact = movies.find((movie) => normalizeTitle(movie.title) === normalizedInput);
    if (exact) return exact;

    const startsWith = movies.find((movie) => normalizeTitle(movie.title).startsWith(normalizedInput));
    return startsWith ?? movies[0] ?? null;
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setShowList(true);
          }}
          onFocus={() => setShowList(true)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (isSearching || results.length === 0) return;

            event.preventDefault();
            const match = pickBestMatch(query, results);
            if (match) {
              selectMovie(match);
            }
          }}
          disabled={disabled}
          className="h-12 w-full rounded-full border border-zinc-600/70 bg-zinc-950/55 px-5 pr-12 text-sm text-white outline-none transition focus:border-[#c9a84c] focus:bg-zinc-900/65"
          placeholder={placeholder}
          aria-label="Search for a movie"
        />
        {isLoading && (
          <span className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-zinc-600 border-t-[#c9a84c] animate-spin" />
        )}
      </div>

      {showList && (query.trim().length >= 2 || isSearching) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[52vh] w-full overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl">
          {isSearching && <p className="px-3 py-3 text-sm text-zinc-400">Searching...</p>}

          {!isSearching && results.length === 0 && (
            <p className="px-3 py-3 text-sm text-zinc-500">No movies found.</p>
          )}

          {!isSearching &&
            results.map((movie) => {
              const year = movie.release_date?.slice(0, 4) || "N/A";
              return (
                <button
                  key={movie.id}
                  type="button"
                  onClick={() => selectMovie(movie)}
                  className="flex w-full items-center justify-between border-b border-zinc-800 px-3 py-3 text-left text-sm transition last:border-b-0 hover:bg-zinc-900"
                >
                  <span className="text-zinc-100">{movie.title}</span>
                  <span className="text-zinc-500">{year}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
