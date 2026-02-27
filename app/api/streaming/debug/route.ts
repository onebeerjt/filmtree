import { NextRequest, NextResponse } from "next/server";
import { normalizeProviderToPlatformKey } from "@/lib/streaming";
import type { StreamingAvailability } from "@/lib/types";

const WATCHMODE_BASE_URL = "https://api.watchmode.com/v1";

type WatchmodeSearchResponse = {
  title_results?: WatchmodeSearchTitle[];
};

type WatchmodeSearchTitle = {
  id: number;
  title?: string;
  name?: string;
  year?: number;
  release_year?: number;
  tmdb_id?: number;
};

type WatchmodeSource = {
  name?: string;
  type?: string;
  web_url?: string;
  ios_url?: string;
  android_url?: string;
};

type SearchAttempt = {
  strategy: string;
  status: number;
  resultCount: number;
  errorBody?: string;
};

function emptyAvailability(tmdbId: number): StreamingAvailability {
  return {
    tmdbId,
    subscription: [],
    rent: [],
    buy: [],
    all: []
  };
}

function parseSources(tmdbId: number, sources: WatchmodeSource[]): StreamingAvailability {
  const subscription = new Set<StreamingAvailability["subscription"][number]>();
  const rent = new Set<StreamingAvailability["rent"][number]>();
  const buy = new Set<StreamingAvailability["buy"][number]>();

  for (const source of sources) {
    if (!source.name) continue;
    const key = normalizeProviderToPlatformKey(source.name);
    if (!key) continue;

    const type = (source.type ?? "").toLowerCase();
    if (type.includes("sub") || type.includes("free")) subscription.add(key);
    else if (type.includes("rent")) rent.add(key);
    else if (type.includes("buy") || type.includes("purchase")) buy.add(key);
    else subscription.add(key);
  }

  const all = new Set([...subscription, ...rent, ...buy]);
  return {
    tmdbId,
    subscription: [...subscription],
    rent: [...rent],
    buy: [...buy],
    all: [...all]
  };
}

function normalizeTitle(value?: string | null) {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleFromResult(result: WatchmodeSearchTitle) {
  return (result.title ?? result.name ?? "").trim();
}

function yearFromResult(result: WatchmodeSearchTitle) {
  return result.year ?? result.release_year ?? null;
}

function scoreTitleCandidate(candidate: WatchmodeSearchTitle, requestedTitle: string, requestedYear?: number | null) {
  const candidateTitle = normalizeTitle(titleFromResult(candidate));
  const wantedTitle = normalizeTitle(requestedTitle);

  let score = 0;
  if (candidateTitle === wantedTitle) score += 300;
  else if (candidateTitle.startsWith(wantedTitle)) score += 170;
  else if (candidateTitle.includes(wantedTitle)) score += 100;

  const candidateYear = yearFromResult(candidate);
  if (requestedYear && candidateYear) {
    if (candidateYear === requestedYear) score += 140;
    else if (Math.abs(candidateYear - requestedYear) === 1) score += 60;
    else if (Math.abs(candidateYear - requestedYear) <= 3) score += 20;
  }

  return score;
}

async function runSearch(
  apiKey: string,
  endpoint: string,
  params: Record<string, string>,
  strategy: string,
  attempts: SearchAttempt[]
): Promise<WatchmodeSearchTitle[]> {
  const searchUrl = new URL(`${WATCHMODE_BASE_URL}${endpoint}`);
  searchUrl.searchParams.set("apiKey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    searchUrl.searchParams.set(key, value);
  }

  const searchResponse = await fetch(searchUrl.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!searchResponse.ok) {
    const errorBody = (await searchResponse.text()).slice(0, 300);
    attempts.push({ strategy, status: searchResponse.status, resultCount: 0, errorBody });
    return [];
  }

  const payload = (await searchResponse.json()) as WatchmodeSearchResponse & { results?: WatchmodeSearchTitle[] };
  const results = Array.isArray(payload.title_results)
    ? payload.title_results
    : Array.isArray(payload.results)
      ? payload.results
      : [];
  attempts.push({ strategy, status: searchResponse.status, resultCount: results.length });
  return results;
}

export async function GET(request: NextRequest) {
  const tmdbId = Number(request.nextUrl.searchParams.get("tmdbId"));
  const region = request.nextUrl.searchParams.get("region") ?? "US";
  const title = request.nextUrl.searchParams.get("title")?.trim();
  const yearParam = request.nextUrl.searchParams.get("year")?.trim();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "Invalid tmdbId parameter" }, { status: 400 });
  }

  const watchmodeKey = process.env.WATCHMODE_API_KEY;
  if (!watchmodeKey) {
    return NextResponse.json({
      service: "watchmode",
      hasApiKey: false,
      tmdbId,
      region,
      normalized: emptyAvailability(tmdbId),
      message: "WATCHMODE_API_KEY is not set."
    });
  }

  try {
    const attempts: SearchAttempt[] = [];

    const byTmdb = await runSearch(
      watchmodeKey,
      "/search/",
      { search_field: "tmdb_id", search_value: String(tmdbId), types: "movie" },
      "search:tmdb_id",
      attempts
    );
    let picked: WatchmodeSearchTitle | null = byTmdb[0] ?? null;
    let lookupStrategy = "tmdb_id";

    if (!picked && title) {
      const searchPlans: Array<{ endpoint: string; params: Record<string, string>; strategy: string }> = [
        { endpoint: "/search/", params: { search_field: "name", search_value: title, types: "movie" }, strategy: "search:name+types" },
        { endpoint: "/search/", params: { search_field: "name", search_value: title }, strategy: "search:name" },
        { endpoint: "/search/", params: { search_value: title }, strategy: "search:generic" },
        { endpoint: "/autocomplete-search/", params: { search_value: title, search_type: "3" }, strategy: "autocomplete-search" },
        { endpoint: "/search-title/", params: { search_value: title }, strategy: "search-title" }
      ];

      for (const plan of searchPlans) {
        const results = await runSearch(watchmodeKey, plan.endpoint, plan.params, plan.strategy, attempts);
        if (results.length === 0) continue;
        let best: WatchmodeSearchTitle | null = null;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const result of results) {
          const score = scoreTitleCandidate(result, title, year);
          if (score > bestScore) {
            best = result;
            bestScore = score;
          }
        }
        if (best) {
          picked = best;
          lookupStrategy = plan.strategy;
          break;
        }
      }
    }

    const titleId = picked?.id ?? null;
    if (!titleId) {
      return NextResponse.json({
        service: "watchmode",
        hasApiKey: true,
        tmdbId,
        requestTitle: title ?? null,
        requestYear: year ?? null,
        region,
        attempts,
        searchStatus: attempts[0]?.status ?? null,
        titleId,
        sourceStatus: null,
        rawSourceCount: 0,
        normalized: emptyAvailability(tmdbId),
        message: "No Watchmode title match found via tmdb_id or title fallback."
      });
    }

    const sourcesUrl = new URL(`${WATCHMODE_BASE_URL}/title/${titleId}/sources/`);
    sourcesUrl.searchParams.set("apiKey", watchmodeKey);
    sourcesUrl.searchParams.set("regions", region);

    const sourcesResponse = await fetch(sourcesUrl.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    const rawSources = sourcesResponse.ok ? ((await sourcesResponse.json()) as WatchmodeSource[]) : [];
    const normalized = parseSources(tmdbId, Array.isArray(rawSources) ? rawSources : []);

    return NextResponse.json({
      service: "watchmode",
      hasApiKey: true,
      tmdbId,
      requestTitle: title ?? null,
      requestYear: year ?? null,
      region,
      attempts,
      lookupStrategy,
      searchStatus: attempts[0]?.status ?? null,
      titleId,
      sourceStatus: sourcesResponse.status,
      rawSourceCount: rawSources.length,
      normalized,
      rawSources: rawSources.slice(0, 20)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        service: "watchmode",
        hasApiKey: true,
        tmdbId,
        region,
        normalized: emptyAvailability(tmdbId),
        message
      },
      { status: 500 }
    );
  }
}
