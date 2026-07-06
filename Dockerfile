# Stage 1: Build & install dependencies
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Production runtime image
FROM node:22-alpine
WORKDIR /app

# Copy dependencies and source code
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY bonario-server ./bonario-server
COPY bonario-frontend ./bonario-frontend

# Set production environment
ENV NODE_ENV=production
ENV BONARIO_PORT=3001

# Expose port
EXPOSE 3001

# Start server
CMD ["node", "bonario-server/index.js"]
