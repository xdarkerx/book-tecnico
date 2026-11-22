# ═══ Book Técnico — imagem do container ═══
# Node 22 já traz o servidor HTTP, crypto e SQLite; dependências opcionais: MongoDB, SAML e FTP (backup).
FROM docker.io/library/node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173 \
    BOOK_DATA_DIR=/data \
    TZ=America/Sao_Paulo

# app (o servidor monta o index.html com as partes de html/)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY tools ./tools
COPY index.html book-tecnico.html ./
COPY html ./html
COPY css ./css
COPY js ./js
COPY assets ./assets

# dados persistentes (banco SQLite, settings.json) ficam no volume /data
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5173/api/health >/dev/null || exit 1

CMD ["node", "server/index.js"]
