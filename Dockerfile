FROM node:20-alpine

WORKDIR /app

# No build step by design — plain JS/HTML/CSS client, nothing to compile.
COPY package.json package-lock.json* ./
RUN npm install --production

COPY server.js ./
COPY games ./games
COPY public ./public

EXPOSE 3000

CMD ["node", "server.js"]
