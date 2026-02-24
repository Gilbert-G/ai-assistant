#!/bin/bash
set -e

# LNA Local Development Setup Script (macOS)
# Run from the project root: ./setup-local.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_step() { echo -e "\n${GREEN}==> $1${NC}"; }
print_warn() { echo -e "${YELLOW}    $1${NC}"; }
print_error() { echo -e "${RED}ERROR: $1${NC}"; }

# ── Pre-flight checks ───────────────────────────────────────────────

print_step "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Install it with: brew install node"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    print_warn "Node.js v20+ is recommended. You have $(node -v)."
fi

if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Install it with: brew install --cask docker"
    exit 1
fi

if ! docker info &> /dev/null; then
    print_error "Docker is not running. Please start Docker Desktop first."
    exit 1
fi

echo "  Node.js $(node -v) OK"
echo "  npm $(npm -v) OK"
echo "  Docker OK"

# ── Start Docker services ───────────────────────────────────────────

print_step "Starting Docker services (PostgreSQL, Redis, MinIO)..."
docker compose up -d

echo "  Waiting for services to be healthy..."
sleep 5

# Check each service
for service in postgres redis minio; do
    if docker compose ps "$service" | grep -q "running"; then
        echo "  $service: running"
    else
        print_warn "$service may not be ready yet. Check with: docker compose ps"
    fi
done

# ── Backend setup ────────────────────────────────────────────────────

print_step "Setting up backend..."
cd backend

echo "  Installing dependencies..."
npm install

if [ ! -f .env ]; then
    echo "  Creating .env from .env.example..."
    cp .env.example .env
    print_warn "Edit backend/.env and set your GEMINI_API_KEY before running the backend."
else
    echo "  .env already exists, skipping."
fi

echo "  Generating Prisma client..."
npx prisma generate

echo "  Pushing database schema..."
npx prisma db push

cd ..

# ── Frontend setup ───────────────────────────────────────────────────

print_step "Setting up frontend..."

echo "  Installing dependencies..."
npm install

if [ ! -f .env.local ]; then
    echo "  Creating .env.local from .env.example..."
    cp .env.example .env.local
    print_warn "Edit .env.local and set your VITE_GEMINI_API_KEY before running the frontend."
else
    echo "  .env.local already exists, skipping."
fi

# ── Done ─────────────────────────────────────────────────────────────

print_step "Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Add your Gemini API key to both:"
echo "     - backend/.env       (GEMINI_API_KEY=...)"
echo "     - .env.local         (VITE_GEMINI_API_KEY=...)"
echo ""
echo "  2. Start the backend (terminal 1):"
echo "     cd backend && npm run start:dev"
echo ""
echo "  3. Start the frontend (terminal 2):"
echo "     npm run dev"
echo ""
echo "  4. Open http://localhost:3001 in your browser"
echo ""
