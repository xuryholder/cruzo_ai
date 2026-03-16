FROM node:24-alpine AS deps

WORKDIR /app

COPY apps/web/package.json ./package.json
RUN npm install

FROM deps AS build

COPY apps/web/next.config.ts ./next.config.ts
COPY apps/web/tsconfig.json ./tsconfig.json
COPY apps/web/next-env.d.ts ./next-env.d.ts
COPY apps/web/src ./src
COPY apps/web/public ./public

RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
