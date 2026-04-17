FROM node:20-slim

# build-essential provides gcc/g++/make (required by node-gyp for better-sqlite3).
# python3 + python-is-python3 ensure node-gyp finds a usable python binary.
RUN apt-get update && \
    apt-get install -y build-essential python3 python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Ensure /data exists at build time so the app starts even before the Railway
# volume is attached. Railway overlays this directory when the volume is mounted.
RUN mkdir -p /data

# Paths are relative to the repo root (Railway build context).
# If Railway is configured with Root Directory = backend/, change these to:
#   COPY package.json ./  /  COPY src/ ./src/  /  COPY scripts/ ./scripts/
COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/src/ ./src/
COPY backend/scripts/ ./scripts/

# /data is the Railway persistent volume mount point.
# Set DB_PATH=/data/nova.db in Railway environment variables.

EXPOSE 3001

CMD ["node", "src/index.js"]
