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

FROM base AS msedge-dev
ARG PLAYWRIGHT_VERSION
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install msedge-dev && \
    rm -rf /root/.npm/
