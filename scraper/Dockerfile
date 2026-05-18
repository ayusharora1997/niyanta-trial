FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
