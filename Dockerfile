FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/verify/package.json packages/verify/package.json
COPY web/package.json web/package.json
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/web
RUN npx next build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV ARAXIA_RP_ID=localhost
COPY --from=build /app /app
EXPOSE 3000
WORKDIR /app/web
CMD ["npx", "next", "start", "-p", "3000"]
