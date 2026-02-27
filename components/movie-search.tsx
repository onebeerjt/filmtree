"use client";

import { useEffect, useRef, useState } from "react";
import { MovieSummary, PersonSummary } from "@/lib/types";

type Props = {
  onMovieSelect: (movie: MovieSummary) => void;
  onPersonSelect?: (person: PersonSummary) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
};

type CacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

const SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const SEARCH_CACHE_VERSION = "v2";

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

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function MovieSearch({
  onMovieSelect,
  onPersonSelect,
  disabled = false,
  isLoading = false,
  placeholder = "Search any film..."
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieSummary[]>([]);
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
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
    const personSearchEnabled = Boolean(onPersonSelect);

    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      setPeople([]);
      setSearchError(null);
      return;
    }

    const timeout = setTimeout(async () => {
      const moviesKey = `film-tree:search:movies:${SEARCH_CACHE_VERSION}:${trimmed.toLowerCase()}`;
      const peopleKey = `film-tree:search:people:${SEARCH_CACHE_VERSION}:${trimmed.toLowerCase()}`;
      const cachedMovies = getCache<MovieSummary[]>(moviesKey);
      const cachedPeople = getCache<PersonSummary[]>(peopleKey);

      if (cachedMovies && (!personSearchEnabled || cachedPeople)) {
        setResults(cachedMovies);
        setPeople(personSearchEnabled ? cachedPeople ?? [] : []);
        setSearchError(null);
        return;
      }

      setIsSearching(true);
      try {
        const movieResponse = await fetch(`/api/tmdb/search?query=${encodeURIComponent(trimmed)}`);
        const moviePayload = await movieResponse.json();
        if (!movieResponse.ok) {
          throw new Error(moviePayload.error ?? "Movie search failed");
        }

        const movieResults = ((moviePayload.results ?? []) as MovieSummary[]).slice(0, 6);
        setResults(movieResults);
        setSearchError(null);
        setCache(moviesKey, movieResults, SEARCH_CACHE_TTL_MS);

        if (personSearchEnabled) {
          try {
            const personResponse = await fetch(`/api/tmdb/person-search?query=${encodeURIComponent(trimmed)}`);
            const personPayload = await personResponse.json();
            if (personResponse.ok) {
              const personResults = ((personPayload.results ?? []) as PersonSummary[]).slice(0, 6);
              setPeople(personResults);
              setCache(peopleKey, personResults, SEARCH_CACHE_TTL_MS);
            } else {
              setPeople([]);
            }
          } catch {
            setPeople([]);
          }
        } else {
          setPeople([]);
        }
      } catch {
        setResults([]);
        setPeople([]);
        setSearchError("Search is unavailable right now.");
      } finally {
        setIsSearching(false);
      }
    }, 320);

    return () => clearTimeout(timeout);
  }, [onPersonSelect, query]);

  function selectMovie(movie: MovieSummary) {
    const year = movie.release_date?.slice(0, 4) || "N/A";
    onMovieSelect(movie);
    setQuery(`${movie.title} (${year})`);
    setShowList(false);
  }

  function selectPerson(person: PersonSummary) {
    if (!onPersonSelect) return;
    onPersonSelect(person);
    setQuery(person.name);
    setShowList(false);
  }

  function pickBestMovieMatch(input: string, movies: MovieSummary[]) {
    const normalizedInput = normalize(input);
    const exact = movies.find((movie) => normalize(movie.title) === normalizedInput);
    if (exact) return exact;

    const startsWith = movies.find((movie) => normalize(movie.title).startsWith(normalizedInput));
    return startsWith ?? movies[0] ?? null;
  }

  function pickBestPersonMatch(input: string, persons: PersonSummary[]) {
    const normalizedInput = normalize(input);
    const exact = persons.find((person) => normalize(person.name) === normalizedInput);
    if (exact) return exact;

    const startsWith = persons.find((person) => normalize(person.name).startsWith(normalizedInput));
    return startsWith ?? persons[0] ?? null;
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
            if (isSearching || (results.length === 0 && people.length === 0)) return;

            event.preventDefault();
            const movieMatch = pickBestMovieMatch(query, results);
            const personMatch = pickBestPersonMatch(query, people);

            // Always prefer movie selection over people for same/similar text.
            if (movieMatch) {
              selectMovie(movieMatch);
              return;
            }
            if (personMatch && onPersonSelect) {
              selectPerson(personMatch);
            }
          }}
          disabled={disabled}
          className="h-12 w-full rounded-full border border-zinc-600/70 bg-zinc-950/55 px-5 pr-12 text-sm text-white outline-none transition focus:border-[#c9a84c] focus:bg-zinc-900/65"
          placeholder={placeholder}
          aria-label="Search for a movie or person"
        />
        {isLoading && (
          <span className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-zinc-600 border-t-[#c9a84c] animate-spin" />
        )}
      </div>

      {showList && (query.trim().length >= 2 || isSearching) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[52vh] w-full overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl">
          {isSearching && <p className="px-3 py-3 text-sm text-zinc-400">Searching...</p>}

          {!isSearching && searchError && (
            <p className="px-3 py-3 text-sm text-red-300">{searchError}</p>
          )}

          {!isSearching && !searchError && results.length === 0 && people.length === 0 && (
            <p className="px-3 py-3 text-sm text-zinc-500">No results found.</p>
          )}

          {!isSearching &&
            results.map((movie) => {
              const year = movie.release_date?.slice(0, 4) || "N/A";
              const poster = movie.poster_path ? `https://image.tmdb.org/t/p/w92${movie.poster_path}` : null;
              return (
                <button
                  key={`movie-${movie.id}`}
                  type="button"
                  onClick={() => selectMovie(movie)}
                  className="flex w-full items-center gap-3 border-b border-zinc-800 px-3 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-zinc-900"
                >
                  <div className="h-10 w-7 overflow-hidden rounded bg-zinc-800">
                    {poster ? <img src={poster} alt={movie.title} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-zinc-100">{movie.title}</p>
                    <p className="text-xs text-zinc-500">{year}</p>
                  </div>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">Movie</span>
                </button>
              );
            })}

          {!isSearching &&
            people.map((person) => {
              const profile = person.profile_path ? `https://image.tmdb.org/t/p/w92${person.profile_path}` : null;
              return (
                <button
                  key={`person-${person.id}`}
                  type="button"
                  onClick={() => selectPerson(person)}
                  className="flex w-full items-center gap-3 border-b border-zinc-800 px-3 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-zinc-900"
                >
                  <div className="h-9 w-9 overflow-hidden rounded-full bg-zinc-800">
                    {profile ? <img src={profile} alt={person.name} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-zinc-100">{person.name}</p>
                    <p className="text-xs text-zinc-500">{person.known_for_department ?? "Person"}</p>
                  </div>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">Person</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
