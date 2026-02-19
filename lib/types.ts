export type MovieSummary = {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  vote_average: number;
  popularity?: number;
  vote_count?: number;
};

export type PersonCredit = {
  id: number;
  name: string;
  role: string;
};

export type GraphNode = {
  id: string;
  tmdbId: number;
  type: "movie" | "person";
  title?: string;
  name?: string;
  role?: string;
  year?: string;
  rating?: number;
  posterPath?: string | null;
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
