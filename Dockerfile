FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run compile

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/mikeygnyc/SunoTrackExporter"
LABEL org.opencontainers.image.title="suno-export"
LABEL org.opencontainers.image.description="Suno export runtime image for CLI, API, workers, librarian, and Kubernetes operator"

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/bin ./bin
COPY --from=build /app/man ./man
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docker/entrypoint.sh /usr/local/bin/suno-export-entrypoint

RUN chmod +x /usr/local/bin/suno-export-entrypoint \
  && groupadd --system --gid 999 sunoexport \
  && useradd --system --uid 999 --gid 999 --create-home --shell /usr/sbin/nologin sunoexport \
  && mkdir -p /app/data /var/lib/suno-export/data /var/lib/suno-export/logs /tmp/suno-export \
  && chown -R sunoexport:sunoexport /app /var/lib/suno-export /tmp/suno-export

USER sunoexport
ENTRYPOINT ["/usr/local/bin/suno-export-entrypoint"]
CMD ["--help"]
