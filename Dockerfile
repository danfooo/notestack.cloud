FROM node:20-slim

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci --workspace=server --workspace=client

# Build client
COPY client/ ./client/
RUN cd client && npm run build

# Build server
COPY server/ ./server/
RUN cd server && npm run build

# Create data directory
RUN mkdir -p /app/server/data/avatars /app/server/data/attachments

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
