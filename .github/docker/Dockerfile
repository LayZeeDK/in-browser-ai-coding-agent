ARG PLAYWRIGHT_VERSION=1.58.2
ARG NODE_VERSION=24

FROM ubuntu:24.04 AS base
ARG PLAYWRIGHT_VERSION
ARG NODE_VERSION
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Install Node.js via NodeSource with verified GPG key
# (adapted from the official Playwright image — avoids piping setup script to bash)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl gpg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | \
      gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" \
      >> /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get install -y --no-install-recommends git xvfb && \
    rm -rf /var/lib/apt/lists/*

# Install Chromium system dependencies — shared by Chrome Beta and Edge Dev.
# Uses the same dependency manifest as the official Playwright image.
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install-deps chromium && \
    rm -rf /var/lib/apt/lists/* /root/.npm/

# Create non-root user matching GitHub Actions runner UID (1001)
RUN useradd --uid 1001 --create-home pwuser

FROM base AS chrome-beta
ARG PLAYWRIGHT_VERSION
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install chrome-beta && \
    rm -rf /root/.npm/

# Seed Local State flags so Chrome enables the LanguageModel API on first launch.
# The model download happens at runtime via docker run --ipc=host (not during build)
# because Chrome needs shared memory IPC that isn't available in docker build.
RUN mkdir -p /home/pwuser/.ai-model-profile/chrome-beta && \
    node -e ' \
      const fs = require("fs"); \
      const path = require("path"); \
      const profileDir = "/home/pwuser/.ai-model-profile/chrome-beta"; \
      const localState = { \
        browser: { enabled_labs_experiments: [ \
          "optimization-guide-on-device-model@1", \
          "prompt-api-for-gemini-nano@1" \
        ]}, \
        internal_only_uis_enabled: true \
      }; \
      fs.writeFileSync(path.join(profileDir, "Local State"), JSON.stringify(localState, null, 2)); \
    ' && \
    chown -R 1001:1001 /home/pwuser/.ai-model-profile

# Install playwright globally and copy bootstrap script for runtime model download.
# The model download runs via `docker run --ipc=host` (not during build) because
# Chrome needs shared memory IPC that isn't available in docker build.
RUN npm install -g playwright@${PLAYWRIGHT_VERSION} && \
    rm -rf /root/.npm/
COPY bootstrap-model.mjs /opt/bootstrap-model.mjs
