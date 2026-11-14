FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public

# Run as the built-in non-root user
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
