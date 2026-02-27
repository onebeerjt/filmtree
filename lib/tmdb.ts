import { FilmTreeResponse, MovieSummary, PersonCredit, PersonSummary } from "@/lib/types";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type MovieDetails = MovieSummary & {
  overview: string;
};

type CreditsResponse = {
  cast: Array<{ id: number; name: string; order: number; profile_path: string | null }>;
  crew: Array<{ id: number; name: string; job: string; department: string; profile_path: string | null }>;
};

type PersonMovieCreditsResponse = {
  cast: Array<MovieSummary & { character?: string }>;
  crew: Array<MovieSummary & { department?: string; job?: string }>;
};

function getApiKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    throw new Error("Missing TMDB_API_KEY environment variable");
  }
  return key;
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = getApiKey();
  const url = new URL(`${TMDB_BASE_URL}${path}`);

  url.searchParams.set("api_key", apiKey);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 * 60 * 12 }
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed (${response.status}): ${path}`);
  }

  return response.json() as Promise<T>;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

function scoreMovieResult(query: string, movie: MovieSummary) {
  const normalizedQuery = normalize(query);
  const normalizedTitle = normalize(movie.title ?? "");
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);

  let textScore = 0;
  if (normalizedTitle === normalizedQuery) textScore += 10000;
  else if (normalizedTitle.startsWith(normalizedQuery)) textScore += 7000;
  else if (normalizedTitle.includes(normalizedQuery)) textScore += 4500;

  const tokenMatches = queryTokens.reduce((count, token) => count + (normalizedTitle.includes(token) ? 1 : 0), 0);
  textScore += tokenMatches * 450;

  const popularityScore = (movie.popularity ?? 0) * 2.2;
  const voteCountScore = Math.min(4000, (movie.vote_count ?? 0) * 0.04);
  const ratingScore = (movie.vote_average ?? 0) * 55;
  const posterBoost = movie.poster_path ? 260 : 0;
  const yearBoost = movie.release_date ? 140 : 0;

  return textScore + popularityScore + voteCountScore + ratingScore + posterBoost + yearBoost;
}

export async function searchMovies(query: string) {
  const data = await tmdbFetch<{ results: MovieSummary[] }>("/search/movie", {
    query,
    include_adult: "false",
    language: "en-US",
    page: "1"
  });

  return [...data.results]
    .sort((a, b) => scoreMovieResult(query, b) - scoreMovieResult(query, a))
    .slice(0, 12);
}

export async function searchPeople(query: string) {
  const data = await tmdbFetch<{ results: PersonSummary[] }>("/search/person", {
    query,
    include_adult: "false",
    language: "en-US",
    page: "1"
  });

  return data.results.slice(0, 8);
}

async function getMovieDetails(movieId: number) {
  return tmdbFetch<MovieDetails>(`/movie/${movieId}`, {
    language: "en-US"
  });
}

async function getMovieCredits(movieId: number) {
  return tmdbFetch<CreditsResponse>(`/movie/${movieId}/credits`, {
    language: "en-US"
  });
}

async function getPersonMovieCredits(personId: number) {
  return tmdbFetch<PersonMovieCreditsResponse>(`/person/${personId}/movie_credits`, {
    language: "en-US"
  });
}

function getYear(releaseDate?: string) {
  return releaseDate && releaseDate.length >= 4 ? releaseDate.slice(0, 4) : "N/A";
}

function pickCorePeople(credits: CreditsResponse): PersonCredit[] {
  const people = new Map<number, PersonCredit>();

  const topCast = [...credits.cast].sort((a, b) => a.order - b.order).slice(0, 7);
  for (const cast of topCast) {
    people.set(cast.id, {
      id: cast.id,
      name: cast.name,
      role: "Actor",
      profilePath: cast.profile_path
    });
  }

  const director = credits.crew.find((crewMember) => crewMember.job === "Director");
  if (director && !people.has(director.id)) {
    people.set(director.id, {
      id: director.id,
      name: director.name,
      role: "Director",
      profilePath: director.profile_path
    });
  }

  const writer = credits.crew.find((crewMember) => {
    return crewMember.department === "Writing" || crewMember.job === "Writer" || crewMember.job === "Screenplay";
  });

  if (writer && !people.has(writer.id)) {
    people.set(writer.id, {
      id: writer.id,
      name: writer.name,
      role: "Writer",
      profilePath: writer.profile_path
    });
  }

  const producer = credits.crew.find((crewMember) => crewMember.job === "Producer");
  if (producer && !people.has(producer.id)) {
    people.set(producer.id, {
      id: producer.id,
      name: producer.name,
      role: "Producer",
      profilePath: producer.profile_path
    });
  }

  return [...people.values()];
}

function selectNotableMovies(movies: MovieSummary[], centerMovieId: number, limit = 4) {
  const seen = new Set<number>();

  function movieScore(movie: MovieSummary) {
    const rating = movie.vote_average ?? 0;
    const voteCount = movie.vote_count ?? 0;
    const popularity = movie.popularity ?? 0;
    const year = Number((movie.release_date ?? "").slice(0, 4));
    const recencyBonus = Number.isFinite(year) && year >= 1980 ? Math.min(24, (year - 1980) * 0.35) : 0;

    // Balance critical signal + audience signal + popularity.
    return rating * 26 + Math.log10(voteCount + 1) * 180 + popularity * 1.1 + recencyBonus;
  }

  return movies
    .filter((movie) => movie.id !== centerMovieId && movie.title)
    .filter((movie) => {
      if (seen.has(movie.id)) return false;
      seen.add(movie.id);
      return true;
    })
    .sort((a, b) => movieScore(b) - movieScore(a))
    .slice(0, limit);
}

export async function getPersonSeedMovie(personId: number) {
  const credits = await getPersonMovieCredits(personId);
  const prioritized = [...credits.crew.filter((m) => m.job === "Director"), ...credits.cast, ...credits.crew];
  const candidate = selectNotableMovies(prioritized, -1, 1)[0];
  return candidate ?? null;
}

export async function buildFilmTree(movieId: number): Promise<FilmTreeResponse> {
  const [centerMovie, credits] = await Promise.all([getMovieDetails(movieId), getMovieCredits(movieId)]);
  const corePeople = pickCorePeople(credits);

  const centerNodeId = `movie-${centerMovie.id}`;
  const nodes: FilmTreeResponse["nodes"] = [
    {
      id: centerNodeId,
      tmdbId: centerMovie.id,
      type: "movie",
      ring: 0,
      title: centerMovie.title,
      year: getYear(centerMovie.release_date),
      rating: Number(centerMovie.vote_average.toFixed(1)),
      posterPath: centerMovie.poster_path,
      isCenter: true,
      x: 0,
      y: 0
    }
  ];

  const links: FilmTreeResponse["links"] = [];
  const relatedMoviesByPerson = await Promise.all(
    corePeople.map(async (person) => {
      const movieCredits = await getPersonMovieCredits(person.id);
      const merged =
        person.role === "Director"
          ? [...movieCredits.crew.filter((m) => m.job === "Director"), ...movieCredits.cast, ...movieCredits.crew]
          : [...movieCredits.cast, ...movieCredits.crew];

      const perPersonLimit = person.role === "Actor" ? 12 : person.role === "Director" ? 22 : 16;
      return {
        person,
        relatedMovies: selectNotableMovies(merged, centerMovie.id, perPersonLimit)
      };
    })
  );

  const peopleCount = relatedMoviesByPerson.length || 1;
  const personRingRadius = 420;
  const personNodes: FilmTreeResponse["nodes"] = [];
  const movieNodeById = new Map<number, FilmTreeResponse["nodes"][number]>();

  for (const [personIndex, { person, relatedMovies }] of relatedMoviesByPerson.entries()) {
    const personNodeId = `person-${person.id}`;
    const angle = (Math.PI * 2 * personIndex) / peopleCount - Math.PI / 2;

    personNodes.push({
      id: personNodeId,
      tmdbId: person.id,
      type: "person",
      ring: 1,
      name: person.name,
      role: person.role,
      profilePath: person.profilePath,
      x: Math.cos(angle) * personRingRadius,
      y: Math.sin(angle) * personRingRadius
    });

    links.push({
      source: centerNodeId,
      target: personNodeId
    });

    for (const movie of relatedMovies) {
      if (!movieNodeById.has(movie.id)) {
        movieNodeById.set(movie.id, {
          id: `movie-${movie.id}`,
          tmdbId: movie.id,
          type: "movie",
          ring: 2,
          title: movie.title,
          year: getYear(movie.release_date),
          rating: Number((movie.vote_average ?? 0).toFixed(1)),
          posterPath: movie.poster_path,
          isCenter: false
        });
      }

      links.push({
        source: personNodeId,
        target: `movie-${movie.id}`
      });
    }
  }

  const secondRingMovies = [...movieNodeById.values()];
  const movieCount = secondRingMovies.length || 1;
  const movieRingRadius = Math.max(980, movieCount * 52);

  for (const [movieIndex, movieNode] of secondRingMovies.entries()) {
    const angle = (Math.PI * 2 * movieIndex) / movieCount - Math.PI / 2;
    movieNode.x = Math.cos(angle) * movieRingRadius;
    movieNode.y = Math.sin(angle) * movieRingRadius;
  }

  nodes.push(...personNodes, ...secondRingMovies);

  return {
    centerMovieId: centerMovie.id,
    centerTitle: centerMovie.title,
    nodes,
    links
  };
}
