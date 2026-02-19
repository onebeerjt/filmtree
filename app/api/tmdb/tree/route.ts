import { NextRequest, NextResponse } from "next/server";
import { buildFilmTree } from "@/lib/tmdb";

export async function GET(request: NextRequest) {
  try {
    const movieIdParam = request.nextUrl.searchParams.get("movieId");
    const movieId = Number(movieIdParam);

    if (!movieIdParam || Number.isNaN(movieId)) {
      return NextResponse.json({ error: "movieId must be a valid number" }, { status: 400 });
    }

    const tree = await buildFilmTree(movieId);
    return NextResponse.json(tree);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
