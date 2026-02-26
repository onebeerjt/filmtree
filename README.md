# Film Tree

Film Tree is a Next.js 14 app that visualizes how films connect through shared cast and crew using the TMDB API.

## Features

- Search any movie title.
- Search movie titles and people (actors/directors/writers/producers).
- Interactive force graph centered on the selected movie.
- First ring includes top 5 cast + director + writer.
- Second ring includes up to 4 notable films for each person.
- Click any movie node to recenter and expand from that film.
- Movie nodes show poster, title, year, and TMDB rating.
- Streaming platform filter bar (Netflix, Hulu, HBO Max, Disney+, Prime Video, Apple TV+, Peacock, Paramount+).
- Watchmode streaming availability integration with per-movie localStorage caching.
- "Where to Watch" movie tooltip with stream/rent/buy sections.
- LocalStorage caching for search and tree responses.
- Loading skeleton while network requests are in-flight.
- Mobile-responsive dark UI with film-grain look.

## Tech Stack

- Next.js 14 (App Router)
- Tailwind CSS
- react-force-graph-2d
- TMDB REST API
- Watchmode API

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create local environment file:

```bash
cp .env.example .env.local
```

3. Add your API keys to `.env.local`:

```env
TMDB_API_KEY=your_tmdb_api_key_here
WATCHMODE_API_KEY=your_watchmode_api_key_here
```

4. Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Getting a Free TMDB API Key

1. Create an account at [TMDB](https://www.themoviedb.org/).
2. Go to your account settings and open the API section.
3. Request an API key (Developer / free tier).
4. Copy the key into `TMDB_API_KEY`.

Official docs: [TMDB API Documentation](https://developer.themoviedb.org/docs/getting-started)

## Deploying to Vercel

1. Push this project to GitHub.
2. Import the repository into [Vercel](https://vercel.com/).
3. Add environment variables `TMDB_API_KEY` and `WATCHMODE_API_KEY` in Vercel project settings.
4. Deploy.

`vercel.json` is included with the Next.js framework setting.

## Endpoints Used

- `/search/movie`
- `/movie/{id}/credits`
- `/person/{id}/movie_credits`
- `/search/person`
- Watchmode `/search` (TMDB ID lookup)
- Watchmode `/title/{id}/sources`
