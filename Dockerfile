# Bionic B2B — üretim imajı (Node 24, yerleşik SQLite).
FROM node:26.12.1-slim

WORKDIR /app
ENV NODE_ENV=production

# Önce bağımlılıklar (katman önbelleği için)
COPY package*.json ./
RUN npm ci --omit=dev

# Uygulama
COPY . .

# Kalıcı veri (volume bağlayın)
ENV DATA_DIR=/data UPLOAD_DIR=/data/uploads PORT=3000
RUN mkdir -p /data/uploads
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
