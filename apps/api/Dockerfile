FROM node:24-alpine AS deps

WORKDIR /app

ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cruzo_ai"

COPY apps/api/package.json ./package.json
COPY apps/api/prisma.config.ts ./prisma.config.ts
COPY apps/api/tsconfig.json ./tsconfig.json
COPY apps/api/tsconfig.build.json ./tsconfig.build.json
COPY apps/api/prisma ./prisma

RUN npm install && npx prisma generate

FROM deps AS build

COPY apps/api/src ./src
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=deps /app/prisma ./prisma
COPY apps/api/prisma.config.ts ./prisma.config.ts
COPY apps/api/package.json ./package.json

EXPOSE 4000

CMD ["node", "dist/main.js"]
