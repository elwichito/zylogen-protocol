FROM node:20-slim

# build-essential provides gcc/g++/make (required by node-gyp for better-sqlite3).
# python3 + python-is-python3 ensure node-gyp finds a usable python binary.
RUN apt-get update && \
    apt-get install -y build-essential python3 python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY scripts/ ./scripts/

# /data is the Railway persistent volume mount point.
# Set DB_PATH=/data/nova.db in Railway environment variables.
# Without the volume, nova.db is ephemeral and lost on restart.
VOLUME ["/data"]

EXPOSE 3001

CMD ["node", "src/index.js"]
