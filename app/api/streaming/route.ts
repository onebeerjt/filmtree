import { NextRequest, NextResponse } from "next/server";
import type { StreamingAvailability } from "@/lib/types";
import { normalizeProviderToPlatformKey } from "@/lib/streaming";

const WATCHMODE_BASE_URL = "https://api.watchmode.com/v1";

type WatchmodeSearchResponse = {
  title_results?: Array<{ id: number }>;
};

type WatchmodeSource = {
  name?: string;
  type?: string;
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
  try {
    const tmdbId = Number(request.nextUrl.searchParams.get("tmdbId"));
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return NextResponse.json({ error: "Invalid tmdbId parameter" }, { status: 400 });
    }

    const watchmodeKey = process.env.WATCHMODE_API_KEY;
    if (!watchmodeKey) {
      return NextResponse.json(emptyAvailability(tmdbId), { status: 200 });
    }

    const region = request.nextUrl.searchParams.get("region") ?? "US";

    const searchUrl = new URL(`${WATCHMODE_BASE_URL}/search/`);
    searchUrl.searchParams.set("apiKey", watchmodeKey);
    searchUrl.searchParams.set("search_field", "tmdb_id");
    searchUrl.searchParams.set("search_value", String(tmdbId));
    searchUrl.searchParams.set("types", "movie");

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 12 }
    });

    if (!searchResponse.ok) {
      return NextResponse.json(emptyAvailability(tmdbId), { status: 200 });
    }

    const searchPayload = (await searchResponse.json()) as WatchmodeSearchResponse;
    const titleId = searchPayload.title_results?.[0]?.id;
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
