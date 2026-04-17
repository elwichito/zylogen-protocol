FROM node:20-slim

# build-essential provides gcc/g++/make (required by node-gyp for better-sqlite3).
# python3 + python-is-python3 ensure node-gyp finds a usable python binary.
# cache-bust: v4 -- flattened structure, src/ at repo root
RUN apt-get update && \
    apt-get install -y build-essential python3 python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# /data is the Railway persistent volume mount point.
# Set DB_PATH=/data/nova.db in Railway environment variables.
RUN mkdir -p /data

COPY package*.json ./
RUN npm ci --omit=dev

# src/ is now at the repo root (flattened from backend/src/)
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
