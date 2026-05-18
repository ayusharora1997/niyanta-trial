FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY scraper/package*.json ./
RUN npm ci

COPY scraper/ ./

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
