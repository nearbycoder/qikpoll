# QikPoll

Anonymous polls that just work.

![QikPoll home screen](./public/readme-preview.svg)

## Overview

QikPoll is a StrawPoll-style app for fast, no-signup polling. Anyone can create a poll, share a link, and watch results update live.

## Features

- Create polls in seconds with 2-8 options
- Public or private visibility
  - `public`: appears in the recent polls feed
  - `private`: unlisted, direct-link only
- Anonymous voting with anti-repeat protections
  - hashed IP checks
  - browser fingerprint signals
  - anonymous visitor cookie
  - vote-attempt rate limiting
- Live updates over WebSockets
  - poll result cards update instantly after votes
  - recent public polls feed updates when public polls are created or voted
- Redis-backed persistence with automatic expiration (TTL)
- No account required

## Stack

- TanStack Start (React + server routes)
- Redis
- Bun + Vite
- TypeScript

## Local setup

1. Install dependencies:

```bash
bun install
```

2. Start Redis locally (if not running already):

```bash
redis-server
```

3. Create `.env`:

```bash
REDIS_URL=redis://localhost:6379
POLL_TTL_SECONDS=604800
POLL_FINGERPRINT_SALT=change-me-in-production
```

4. Start dev server:

```bash
bun --bun run dev
```

App runs at [http://localhost:3000](http://localhost:3000).

## API endpoints

- `POST /api/polls` create poll
- `GET /api/polls?id=<pollId>` fetch poll details
- `GET /api/polls?limit=<n>` list recent public polls
- `POST /api/polls/vote` submit vote
- `GET /api/live?pollId=<pollId>` websocket stream for per-poll updates
- `GET /api/live?stream=public` websocket stream for recent public poll list updates

## Build

```bash
bun --bun run build
```

## Notes

- Raw IP addresses are not stored in Redis.
- Vote writes are atomic via Redis Lua script.
- Poll and vote keys expire automatically based on TTL.
