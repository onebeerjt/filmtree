import { NextRequest, NextResponse } from "next/server";
import { getPersonSeedMovie } from "@/lib/tmdb";

export async function GET(request: NextRequest) {
  try {
    const personId = Number(request.nextUrl.searchParams.get("personId"));
    if (!Number.isFinite(personId) || personId <= 0) {
      return NextResponse.json({ error: "Invalid personId" }, { status: 400 });
    }

    const movie = await getPersonSeedMovie(personId);
    if (!movie) {
      return NextResponse.json({ error: "No notable movies found for person" }, { status: 404 });
    }

    return NextResponse.json({ movie });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
