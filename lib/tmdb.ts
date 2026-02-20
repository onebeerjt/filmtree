import { FilmTreeResponse, MovieSummary, PersonCredit } from "@/lib/types";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type MovieDetails = MovieSummary & {
  overview: string;
};

type CreditsResponse = {
  cast: Array<{ id: number; name: string; order: number }>;
  crew: Array<{ id: number; name: string; job: string; department: string }>;
};

type PersonMovieCreditsResponse = {
  cast: MovieSummary[];
  crew: MovieSummary[];
};

type PersonDetails = {
  id: number;
  profile_path: string | null;
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

export async function searchMovies(query: string) {
  const data = await tmdbFetch<{ results: MovieSummary[] }>("/search/movie", {
    query,
    include_adult: "false",
    language: "en-US",
    page: "1"
  });

  return data.results.slice(0, 10);
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

async function getPersonDetails(personId: number) {
  return tmdbFetch<PersonDetails>(`/person/${personId}`, {
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
      role: "Actor"
    });
  }

  const director = credits.crew.find((crewMember) => crewMember.job === "Director");
  if (director && !people.has(director.id)) {
    people.set(director.id, {
      id: director.id,
      name: director.name,
      role: "Director"
    });
  }

  const writer = credits.crew.find((crewMember) => {
    return crewMember.department === "Writing" || crewMember.job === "Writer" || crewMember.job === "Screenplay";
  });

  if (writer && !people.has(writer.id)) {
    people.set(writer.id, {
      id: writer.id,
      name: writer.name,
      role: "Writer"
    });
  }

  const producer = credits.crew.find((crewMember) => crewMember.job === "Producer");
  if (producer && !people.has(producer.id)) {
    people.set(producer.id, {
      id: producer.id,
      name: producer.name,
      role: "Producer"
    });
  }

  return [...people.values()];
}

function selectNotableMovies(movies: MovieSummary[], centerMovieId: number, limit = 4) {
  const seen = new Set<number>();

  return movies
    .filter((movie) => movie.id !== centerMovieId && movie.title)
    .filter((movie) => {
      if (seen.has(movie.id)) return false;
      seen.add(movie.id);
      return true;
    })
    .sort((a, b) => {
      const scoreA = (a.popularity ?? 0) + (a.vote_count ?? 0) * 0.01;
      const scoreB = (b.popularity ?? 0) + (b.vote_count ?? 0) * 0.01;
      return scoreB - scoreA;
    })
    .slice(0, limit);
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
      const [movieCredits, personDetails] = await Promise.all([
        getPersonMovieCredits(person.id),
        getPersonDetails(person.id)
      ]);
      const merged = [...movieCredits.cast, ...movieCredits.crew];
      const perPersonLimit = person.role === "Actor" ? 6 : 8;
      return {
        person,
        profilePath: personDetails.profile_path,
        relatedMovies: selectNotableMovies(merged, centerMovie.id, perPersonLimit)
      };
    })
  );

  const peopleCount = relatedMoviesByPerson.length || 1;
  const personRingRadius = 420;
  const personNodes: FilmTreeResponse["nodes"] = [];
  const movieNodeById = new Map<number, FilmTreeResponse["nodes"][number]>();

  for (const [personIndex, { person, profilePath, relatedMovies }] of relatedMoviesByPerson.entries()) {
    const personNodeId = `person-${person.id}`;
    const angle = (Math.PI * 2 * personIndex) / peopleCount - Math.PI / 2;

    personNodes.push({
      id: personNodeId,
      tmdbId: person.id,
      type: "person",
      ring: 1,
      name: person.name,
      role: person.role,
      profilePath,
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
