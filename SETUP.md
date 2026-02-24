# LNA — Local Development Setup (macOS)

Complete guide to set up LNA on a fresh Mac (Apple Silicon / Intel).

## Architecture Overview

| Component       | Tech               | Port  |
|-----------------|--------------------|-------|
| Frontend        | React + Vite       | 3001  |
| Backend API     | NestJS             | 3000  |
| Database        | PostgreSQL 16      | 5433  |
| Cache / Queue   | Redis 7            | 6379  |
| Object Storage  | MinIO              | 9000 (API) / 9001 (Console) |

---

## Prerequisites

### 1. Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After installation, follow the instructions printed in the terminal to add Homebrew to your PATH (especially important on Apple Silicon Macs where the path is `/opt/homebrew`).

### 2. Node.js (v20+)

```bash
brew install node
```

Verify: `node -v` should print v20 or higher.

### 3. Docker Desktop

```bash
brew install --cask docker
```

Open **Docker Desktop** from Applications and complete the onboarding. Docker must be running before you start the services.

### 4. Git

```bash
brew install git
```

---

## Setup Steps

### 1. Clone the repository

```bash
git clone https://github.com/Gilbert-G/LNA.git
cd LNA
```

### 2. Start infrastructure services

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, and MinIO. Verify they're running:

```bash
docker compose ps
```

All three services should show as "running" and "healthy".

### 3. Backend setup

```bash
cd backend
npm install
```

Create the environment file:

```bash
cp .env.example .env
```

Edit `backend/.env` and set your Gemini API key:

```
GEMINI_API_KEY=your-actual-gemini-api-key
```

All other values in `.env` are pre-configured for local development.

Generate the Prisma client and set up the database:

```bash
npx prisma generate
npx prisma db push
```

Start the backend in watch mode:

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000`.

### 4. Frontend setup (open a new terminal)

```bash
cd LNA  # project root
npm install
```

Create the environment file:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set your Gemini API key:

```
VITE_GEMINI_API_KEY=your-actual-gemini-api-key
```

Start the dev server:

```bash
npm run dev
```

The app will be available at `http://localhost:3001`.

---

## Getting a Gemini API Key

1. Go to https://ai.google.dev/
2. Click "Get API key"
3. Create a key in a new or existing Google Cloud project
4. Copy the key into both `backend/.env` and `.env.local`

---

## Useful Commands

### Frontend (from project root)

| Command              | Description                  |
|----------------------|------------------------------|
| `npm run dev`        | Start Vite dev server        |
| `npm run build`      | TypeScript check + build     |
| `npm run lint`       | Run ESLint                   |
| `npm run lint:fix`   | Run ESLint with auto-fix     |
| `npm run format`     | Format code with Prettier    |
| `npm run typecheck`  | TypeScript type checking     |

### Backend (from `backend/`)

| Command                    | Description                     |
|----------------------------|---------------------------------|
| `npm run start:dev`        | Start in watch mode             |
| `npm run start:debug`      | Start with debugger             |
| `npm run build`            | Compile TypeScript              |
| `npm run test`             | Run unit tests                  |
| `npm run test:e2e`         | Run end-to-end tests            |
| `npm run lint`             | Run ESLint with auto-fix        |
| `npx prisma studio`       | Open Prisma database browser    |
| `npx prisma db push`      | Push schema changes to database |
| `npx prisma migrate dev`  | Create and run migrations       |

### Docker

| Command                  | Description                |
|--------------------------|----------------------------|
| `docker compose up -d`   | Start all services         |
| `docker compose down`    | Stop all services          |
| `docker compose ps`      | Check service status       |
| `docker compose logs -f` | Follow service logs        |

---

## MinIO Console

Access the MinIO web console at `http://localhost:9001`:
- **Username:** `minioadmin`
- **Password:** `minioadmin`

---

## Troubleshooting

### Port conflicts

If ports 5433, 6379, 9000, or 9001 are already in use, stop the conflicting service or edit `docker-compose.yml` to change the host port mapping.

### Prisma client issues

If you get Prisma-related errors, regenerate the client:

```bash
cd backend
rm -rf node_modules/.prisma
npx prisma generate
```

### Database connection refused

Make sure Docker Desktop is running and the PostgreSQL container is healthy:

```bash
docker compose ps
docker compose logs postgres
```

### Apple Silicon (M1/M2/M3/M4) Docker issues

If MinIO or other containers fail to start, ensure Docker Desktop has Rosetta emulation enabled (Settings → General → "Use Rosetta for x86_64/amd64 emulation on Apple Silicon").
