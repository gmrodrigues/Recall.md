FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS web-build
WORKDIR /app
COPY package.json package-lock.json vite.config.js ./
RUN npm ci --ignore-scripts
COPY web/flow ./web/flow
RUN npm run build

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/gmrodrigues/Recall.md" \
      org.opencontainers.image.description="Recall.md: aprendizagem em etapas com CLI, TUI, quizzes e flashcards" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY web ./web
COPY --from=web-build /app/web/build ./web/build
COPY docs/agents.md ./docs/agents.md
COPY examples ./examples
RUN mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
EXPOSE 6421
ENTRYPOINT ["node", "/app/bin/recall.js"]
CMD ["browser", "--host", "0.0.0.0"]
