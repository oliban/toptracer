# Toptracer Range Analyzer — production image.
# Uses the Playwright base image so headless Chromium (for the Toptracer OAuth login) is present.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Build toolchain for better-sqlite3 native module.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install workspace deps (dev deps needed for the build).
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

# Build server (tsc) + web (vite).
COPY . .
RUN npm run build
# Ensure the Chromium build matching the installed Playwright is present.
RUN npx playwright install chromium

ENV NODE_ENV=production \
    WEB_DIST=/app/packages/web/dist \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
CMD ["node", "packages/server/dist/index.js"]
