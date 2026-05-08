FROM node:20-slim

# build-essential provides gcc/g++/make (required by node-gyp for better-sqlite3).
# python3 + python-is-python3 ensure node-gyp finds a usable python binary.
RUN apt-get update && \
    apt-get install -y build-essential python3 python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# /data is the Railway persistent volume mount point.
# Set DB_PATH=/data/nova.db in Railway environment variables.
RUN mkdir -p /data

# Copy backend package files and install dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Force rebuild - timestamp: 2026-05-08T03:00
ARG CACHEBUST=1
COPY backend/src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
