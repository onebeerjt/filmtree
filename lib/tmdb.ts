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

function getYear(releaseDate?: string) {
  return releaseDate && releaseDate.length >= 4 ? releaseDate.slice(0, 4) : "N/A";
}

function pickCorePeople(credits: CreditsResponse): PersonCredit[] {
  const people = new Map<number, PersonCredit>();

  const topCast = [...credits.cast].sort((a, b) => a.order - b.order).slice(0, 5);
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

  const nodes: FilmTreeResponse["nodes"] = [
    {
      id: `movie-${centerMovie.id}`,
      tmdbId: centerMovie.id,
      type: "movie",
      title: centerMovie.title,
      year: getYear(centerMovie.release_date),
      rating: Number(centerMovie.vote_average.toFixed(1)),
      posterPath: centerMovie.poster_path,
      isCenter: true
    }
  ];

  const links: FilmTreeResponse["links"] = [];
  const movieIdsAdded = new Set<number>([centerMovie.id]);

  const relatedMoviesByPerson = await Promise.all(
    corePeople.map(async (person) => {
      const movieCredits = await getPersonMovieCredits(person.id);
      const merged = [...movieCredits.cast, ...movieCredits.crew];
      return {
        person,
        relatedMovies: selectNotableMovies(merged, centerMovie.id, 4)
      };
    })
  );

  for (const { person, relatedMovies } of relatedMoviesByPerson) {
    const personNodeId = `person-${person.id}`;

    nodes.push({
      id: personNodeId,
      tmdbId: person.id,
      type: "person",
      name: person.name,
      role: person.role
    });

    links.push({
      source: `movie-${centerMovie.id}`,
      target: personNodeId
    });

    for (const movie of relatedMovies) {
      if (!movieIdsAdded.has(movie.id)) {
        nodes.push({
          id: `movie-${movie.id}`,
          tmdbId: movie.id,
          type: "movie",
          title: movie.title,
          year: getYear(movie.release_date),
          rating: Number((movie.vote_average ?? 0).toFixed(1)),
          posterPath: movie.poster_path,
          isCenter: false
        });
        movieIdsAdded.add(movie.id);
      }

      links.push({
        source: personNodeId,
        target: `movie-${movie.id}`
      });
    }
  }

  return {
    centerMovieId: centerMovie.id,
    centerTitle: centerMovie.title,
    nodes,
    links
  };
}
