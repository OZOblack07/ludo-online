# Ludo Online — React + Express + Socket.IO + PostgreSQL

A complete starter production deployment for an online Ludo game.

## Included

- Email/password signup and login
- Password hashing with bcrypt
- JWT authentication
- 2-player rooms
- 4-player rooms
- Human vs computer mode
- Room codes
- Server-authoritative dice rolls and token moves
- Safe spaces, captures, home entry and winning condition
- Real-time Socket.IO synchronization
- PostgreSQL persistence for users and game snapshots
- Responsive React UI
- Render Blueprint (`render.yaml`)
- Health endpoint

## Important game-model note

The server is authoritative: clients never decide dice results or whether a move is legal. The server validates whose turn it is, validates dice state, validates token indexes, applies movement/captures, and broadcasts the resulting state.

The board renderer is intentionally lightweight so the project is easy to customize. The game engine is separated in `server/game.js`, making it straightforward to replace the visual board with a more detailed traditional Ludo board later.

## Run locally

Requirements: Node.js 20+ and PostgreSQL.

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to your local PostgreSQL URL.
3. Set a long random `JWT_SECRET`.
4. Install dependencies:

```bash
npm install
```

5. Create/update the database:

```bash
npm run db:push
```

6. Start both client and server:

```bash
npm run dev
```

Open `http://localhost:5173`.

## Production build

```bash
npm run build
npm start
```

The Express server serves the Vite build and the Socket.IO endpoint from the same origin.

## Render deployment

The repository contains `render.yaml`. You can deploy the Blueprint from Render after pushing the project to GitHub.

The Blueprint creates:

- one Node web service
- one Render Postgres database
- generated `JWT_SECRET`
- database migration command
- `/health` health check

For a Render web service, the server must listen on `0.0.0.0`; this project does that.

After creating the service, update `CLIENT_URL` in the Render environment variables to your actual service URL, for example:

`https://your-ludo-service.onrender.com`

Then redeploy.

### Manual Render settings

If you prefer manual setup:

Build command:

```bash
npm ci && npm run build
```

Pre-deploy command:

```bash
npm run db:migrate
```

Start command:

```bash
npm start
```

Environment variables:

```text
NODE_ENV=production
DATABASE_URL=<Render Postgres internal connection string>
JWT_SECRET=<long random secret>
CLIENT_URL=https://your-service.onrender.com
```

Use the Render Postgres internal connection string when the database and web service are in the same Render region.

## Multiplayer scaling

This implementation is designed for a single Render web service instance, which is appropriate for an initial production deployment. Socket.IO room state is kept in the process memory and persisted to PostgreSQL after authoritative game actions.

If you later run multiple web instances, add a shared Socket.IO adapter (commonly Redis) and move live room state to a shared store so players connected to different instances see the same events.

## Security hardening for a public launch

Before a high-traffic launch, consider adding:

- rate limiting for login/signup and socket actions
- email verification
- password reset
- refresh-token/session rotation
- CAPTCHA/abuse protection
- Redis Socket.IO adapter for horizontal scaling
- structured logging and monitoring
- automated tests for every Ludo rule
- reconnect/resume tokens
- abandoned-room cleanup
- stricter CORS configuration
- HTTPS-only production cookies if moving JWT from localStorage to secure HttpOnly cookies

## Project structure

```text
ludo-render/
├── client/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       └── styles.css
├── server/
│   ├── ai.js
│   ├── auth.js
│   ├── db.js
│   ├── game.js
│   └── index.js
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── .env.example
├── .gitignore
├── package.json
├── render.yaml
└── README.md
```
