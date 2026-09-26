# ---- build ----
FROM node:20-alpine AS builder

RUN npm i -g pnpm@11.13.0

WORKDIR /usr/src/app

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm build

# ---- run ----
FROM node:20-alpine AS runner

RUN npm i -g pnpm@11.13.0

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package.json ./package.json
COPY --from=builder /usr/src/app/pnpm-lock.yaml ./pnpm-lock.yaml

EXPOSE 3000

CMD ["node", "dist/backend/src/index.js"]
