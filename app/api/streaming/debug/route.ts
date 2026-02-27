import { NextRequest, NextResponse } from "next/server";
import { normalizeProviderToPlatformKey } from "@/lib/streaming";
import type { StreamingAvailability } from "@/lib/types";

const WATCHMODE_BASE_URL = "https://api.watchmode.com/v1";

type WatchmodeSearchResponse = {
  title_results?: Array<{ id: number }>;
};

type WatchmodeSource = {
  name?: string;
  type?: string;
  web_url?: string;
  ios_url?: string;
  android_url?: string;
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

export async function GET(request: NextRequest) {
  const tmdbId = Number(request.nextUrl.searchParams.get("tmdbId"));
  const region = request.nextUrl.searchParams.get("region") ?? "US";

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
    const searchUrl = new URL(`${WATCHMODE_BASE_URL}/search/`);
    searchUrl.searchParams.set("apiKey", watchmodeKey);
    searchUrl.searchParams.set("search_field", "tmdb_id");
    searchUrl.searchParams.set("search_value", String(tmdbId));
    searchUrl.searchParams.set("types", "movie");

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    const searchPayload = searchResponse.ok ? ((await searchResponse.json()) as WatchmodeSearchResponse) : null;
    const titleId = searchPayload?.title_results?.[0]?.id ?? null;

    if (!searchResponse.ok || !titleId) {
      return NextResponse.json({
        service: "watchmode",
        hasApiKey: true,
        tmdbId,
        region,
        searchStatus: searchResponse.status,
        titleId,
        sourceStatus: null,
        rawSourceCount: 0,
        normalized: emptyAvailability(tmdbId),
        message: !titleId ? "No Watchmode title match found for this TMDB movie id." : "Watchmode search failed."
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
      region,
      searchStatus: searchResponse.status,
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

