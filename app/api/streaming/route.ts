import { NextRequest, NextResponse } from "next/server";
import type { StreamingAvailability } from "@/lib/types";
import { normalizeProviderToPlatformKey } from "@/lib/streaming";

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
};

type TitleLookupResult = {
  titleId: number | null;
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

async function lookupTitleByTmdbId(apiKey: string, tmdbId: number): Promise<TitleLookupResult> {
  const searchUrl = new URL(`${WATCHMODE_BASE_URL}/search/`);
  searchUrl.searchParams.set("apiKey", apiKey);
  searchUrl.searchParams.set("search_field", "tmdb_id");
  searchUrl.searchParams.set("search_value", String(tmdbId));
  searchUrl.searchParams.set("types", "movie");

  const searchResponse = await fetch(searchUrl.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 * 60 * 12 }
  });
  if (!searchResponse.ok) return { titleId: null };

  const payload = (await searchResponse.json()) as WatchmodeSearchResponse;
  return { titleId: payload.title_results?.[0]?.id ?? null };
}

async function lookupTitleByName(
  apiKey: string,
  title: string,
  year?: number | null
): Promise<TitleLookupResult> {
  const fields = ["name", "title"];

  for (const field of fields) {
    const searchUrl = new URL(`${WATCHMODE_BASE_URL}/search/`);
    searchUrl.searchParams.set("apiKey", apiKey);
    searchUrl.searchParams.set("search_field", field);
    searchUrl.searchParams.set("search_value", title);
    searchUrl.searchParams.set("types", "movie");

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 12 }
    });
    if (!searchResponse.ok) continue;

    const payload = (await searchResponse.json()) as WatchmodeSearchResponse;
    const results = payload.title_results ?? [];
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

    if (best?.id) return { titleId: best.id };
  }

  return { titleId: null };
}

export async function GET(request: NextRequest) {
  try {
    const tmdbId = Number(request.nextUrl.searchParams.get("tmdbId"));
    const title = request.nextUrl.searchParams.get("title")?.trim();
    const yearParam = request.nextUrl.searchParams.get("year")?.trim();
    const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return NextResponse.json({ error: "Invalid tmdbId parameter" }, { status: 400 });
    }

    const watchmodeKey = process.env.WATCHMODE_API_KEY;
    if (!watchmodeKey) {
      return NextResponse.json(emptyAvailability(tmdbId), { status: 200 });
    }

    const region = request.nextUrl.searchParams.get("region") ?? "US";

    const byTmdb = await lookupTitleByTmdbId(watchmodeKey, tmdbId);
    const byName = byTmdb.titleId ? { titleId: byTmdb.titleId } : title ? await lookupTitleByName(watchmodeKey, title, year) : { titleId: null };
    const titleId = byName.titleId;
    if (!titleId) {
      return NextResponse.json(emptyAvailability(tmdbId), { status: 200 });
    }

    const sourcesUrl = new URL(`${WATCHMODE_BASE_URL}/title/${titleId}/sources/`);
    sourcesUrl.searchParams.set("apiKey", watchmodeKey);
    sourcesUrl.searchParams.set("regions", region);

    const sourcesResponse = await fetch(sourcesUrl.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 12 }
    });

    if (!sourcesResponse.ok) {
      return NextResponse.json(emptyAvailability(tmdbId), { status: 200 });
    }

    const sourcesPayload = (await sourcesResponse.json()) as WatchmodeSource[];
    return NextResponse.json(parseSources(tmdbId, Array.isArray(sourcesPayload) ? sourcesPayload : []));
  } catch {
    return NextResponse.json({ error: "Failed to fetch streaming availability" }, { status: 500 });
  }
}
