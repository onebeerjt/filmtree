export type MovieSummary = {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  vote_average: number;
  popularity?: number;
  vote_count?: number;
};

export type PersonSummary = {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department?: string;
};

export type PersonCredit = {
  id: number;
  name: string;
  role: string;
  profilePath?: string | null;
};

export type GraphNode = {
  id: string;
  tmdbId: number;
  type: "movie" | "person";
  ring?: 0 | 1 | 2;
  title?: string;
  name?: string;
  role?: string;
  year?: string;
  rating?: number;
  posterPath?: string | null;
  profilePath?: string | null;
  isCenter?: boolean;
  x?: number;
  y?: number;
};

export type GraphLink = {
  source: string;
  target: string;
};

export type FilmTreeResponse = {
  centerMovieId: number;
  centerTitle: string;
  nodes: GraphNode[];
  links: GraphLink[];
};

export type StreamingPlatformKey =
  | "netflix"
  | "hulu"
  | "max"
  | "disney"
  | "prime"
  | "peacock"
  | "paramount"
  | "tubi"
  | "plex";

export type StreamingAvailability = {
  tmdbId: number;
  subscription: StreamingPlatformKey[];
  rent: StreamingPlatformKey[];
  buy: StreamingPlatformKey[];
  all: StreamingPlatformKey[];
};
