FROM node:20-slim

# Build tools required for better-sqlite3 native module
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci

# Build client
COPY client/ ./client/
RUN cd client && npm run build

# Build server
COPY server/ ./server/
RUN cd server && npm run build

# Create data directories
RUN mkdir -p /app/server/data/avatars /app/server/data/attachments

EXPOSE 3000

# Run from server dir so `join(cwd, '..', 'client', 'dist')` resolves correctly
WORKDIR /app/server
CMD ["node", "dist/index.js"]
