FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3000
ENV WS_PATH=/api/ws

EXPOSE 3000

USER node

CMD ["node", "server.js"]
