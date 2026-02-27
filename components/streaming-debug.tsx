"use client";

import { useMemo, useState } from "react";
import { PLATFORM_ORDER } from "@/lib/streaming";
import type { FilmTreeResponse, MovieSummary, StreamingAvailability } from "@/lib/types";

type DebugRow = {
  tmdbId: number;
  title: string;
  year: string;
  hasApiKey: boolean;
  titleId: number | null;
  searchStatus?: number;
  sourceStatus?: number;
  rawSourceCount?: number;
  normalized: StreamingAvailability;
  message?: string;
};

function platformList(value: string[]) {
  return value.length > 0 ? value.join(", ") : "none";
}

export function StreamingDebug() {
  const [query, setQuery] = useState("Goodfellas");
  const [results, setResults] = useState<MovieSummary[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<MovieSummary | null>(null);
  const [rows, setRows] = useState<DebugRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(PLATFORM_ORDER.map((p) => [p, 0]));
    for (const row of rows) {
      for (const platform of row.normalized.all) counts[platform] += 1;
    }
    return counts;
  }, [rows]);

  async function runSearch() {
    setIsSearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/tmdb/search?query=${encodeURIComponent(query)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Search failed");
      const nextResults = (payload.results ?? []) as MovieSummary[];
      setResults(nextResults.slice(0, 10));
      if (nextResults.length > 0) setSelectedMovie(nextResults[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  }

  async function inspectMovie(movie: MovieSummary) {
    setSelectedMovie(movie);
    setIsLoading(true);
    setError(null);
    setRows([]);

    try {
      const treeResponse = await fetch(`/api/tmdb/tree?movieId=${movie.id}`);
      const treePayload = (await treeResponse.json()) as FilmTreeResponse & { error?: string };
      if (!treeResponse.ok) throw new Error(treePayload.error ?? "Tree request failed");

      const movies = treePayload.nodes
        .filter((node) => node.type === "movie")
        .map((node) => ({
          tmdbId: node.tmdbId,
          title: node.title ?? "Untitled",
          year: node.year ?? "N/A"
        }));

      const uniqueMovies = Array.from(new Map(movies.map((m) => [m.tmdbId, m])).values());
      const debugRows = await Promise.all(
        uniqueMovies.map(async (m) => {
          const params = new URLSearchParams({ tmdbId: String(m.tmdbId) });
          if (m.title) params.set("title", m.title);
          if (m.year && /^\d{4}$/.test(m.year)) params.set("year", m.year);
          const response = await fetch(`/api/streaming/debug?${params.toString()}`);
          const payload = await response.json();
          return {
            tmdbId: m.tmdbId,
            title: m.title,
            year: m.year,
            hasApiKey: Boolean(payload.hasApiKey),
            titleId: typeof payload.titleId === "number" ? payload.titleId : null,
            searchStatus: payload.searchStatus,
            sourceStatus: payload.sourceStatus,
            rawSourceCount: payload.rawSourceCount,
            normalized: payload.normalized as StreamingAvailability,
            message: payload.message as string | undefined
          } satisfies DebugRow;
        })
      );

      setRows(debugRows.sort((a, b) => b.normalized.all.length - a.normalized.all.length));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inspect failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">Streaming Debug (Watchmode)</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Verifies raw streaming availability per movie node from <code>/api/streaming/debug</code>.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            className="w-[360px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-[#c9a84c]"
            placeholder="Search movie title"
          />
          <button
            onClick={() => {
              void runSearch();
            }}
            className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm hover:border-[#c9a84c]"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
          <button
            disabled={!selectedMovie || isLoading}
            onClick={() => {
              if (selectedMovie) void inspectMovie(selectedMovie);
            }}
            className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm hover:border-[#c9a84c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Inspecting..." : "Inspect Tree Streaming"}
          </button>
        </div>

        {results.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {results.map((movie) => (
              <button
                key={movie.id}
                onClick={() => setSelectedMovie(movie)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  selectedMovie?.id === movie.id
                    ? "border-[#c9a84c] bg-[#c9a84c]/20 text-white"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300"
                }`}
              >
                {movie.title} ({movie.release_date?.slice(0, 4) || "N/A"})
              </button>
            ))}
          </div>
        )}

        {selectedMovie && (
          <p className="mt-4 text-sm text-zinc-300">
            Selected: <span className="font-semibold text-white">{selectedMovie.title}</span> (tmdb:{selectedMovie.id})
          </p>
        )}

        {error && <p className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}

        {rows.length > 0 && (
          <>
            <div className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900/60 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">Platform Match Counts</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PLATFORM_ORDER.map((platform) => (
                  <div key={platform} className="rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs">
                    <div className="text-zinc-400">{platform}</div>
                    <div className="text-lg font-semibold text-white">{platformCounts[platform]}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-900/60">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-zinc-700 bg-zinc-950/70 text-zinc-300">
                  <tr>
                    <th className="px-3 py-2">Movie</th>
                    <th className="px-3 py-2">TMDB</th>
                    <th className="px-3 py-2">Watchmode titleId</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">All</th>
                    <th className="px-3 py-2">Subscription</th>
                    <th className="px-3 py-2">Rent</th>
                    <th className="px-3 py-2">Buy</th>
                    <th className="px-3 py-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.tmdbId} className="border-b border-zinc-800/70 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium text-white">{row.title}</div>
                        <div className="text-zinc-400">{row.year}</div>
                      </td>
                      <td className="px-3 py-2 text-zinc-300">{row.tmdbId}</td>
                      <td className="px-3 py-2 text-zinc-300">{row.titleId ?? "none"}</td>
                      <td className="px-3 py-2 text-zinc-300">
                        key:{row.hasApiKey ? "yes" : "no"} s:{row.searchStatus ?? "n/a"} src:{row.sourceStatus ?? "n/a"} n:
                        {row.rawSourceCount ?? 0}
                      </td>
                      <td className="px-3 py-2 text-zinc-200">{platformList(row.normalized.all)}</td>
                      <td className="px-3 py-2 text-zinc-300">{platformList(row.normalized.subscription)}</td>
                      <td className="px-3 py-2 text-zinc-300">{platformList(row.normalized.rent)}</td>
                      <td className="px-3 py-2 text-zinc-300">{platformList(row.normalized.buy)}</td>
                      <td className="px-3 py-2 text-zinc-400">{row.message ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
