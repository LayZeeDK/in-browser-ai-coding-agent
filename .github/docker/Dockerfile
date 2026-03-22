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

# Bootstrap Gemini Nano model into a profile that CI copies to .playwright-profiles/.
# Seeds chrome://flags, launches Chrome with xvfb to trigger model download, and
# stores the profile at /home/pwuser/.ai-model-profile/chrome-beta.
# The retry loop handles Chrome's flaky "Browser window not found" in containers.
RUN npm install -g playwright@${PLAYWRIGHT_VERSION} && \
    mkdir -p /home/pwuser/.ai-model-profile/chrome-beta && \
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
      console.log("[INFO] Seeded Local State flags"); \
    ' && \
    for attempt in 1 2 3 4 5; do \
      xvfb-run --auto-servernum node -e ' \
        const { chromium } = require("playwright"); \
        (async () => { \
          const ctx = await chromium.launchPersistentContext( \
            "/home/pwuser/.ai-model-profile/chrome-beta", \
            { channel: "chrome-beta", headless: false, \
              args: ["--no-first-run", "--disable-gpu", \
                "--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano", \
                "--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument"], \
              ignoreDefaultArgs: [ \
                "--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints", \
                "--disable-field-trial-config", "--disable-background-networking", "--disable-component-update"], \
              timeout: 60000 }); \
          const page = ctx.pages()[0] || await ctx.newPage(); \
          await page.goto("chrome://gpu"); \
          const avail = await page.evaluate(async () => { \
            if (typeof LanguageModel === "undefined") return "no-api"; \
            return LanguageModel.availability(); \
          }); \
          console.log("[INFO] LanguageModel.availability() =", avail); \
          if (avail === "downloadable" || avail === "downloading") { \
            console.log("[INFO] Triggering model download..."); \
            await page.evaluate(async () => { \
              const s = await LanguageModel.create({ \
                monitor: m => m.addEventListener("downloadprogress", e => { \
                  const pct = ((e.loaded / e.total) * 100).toFixed(1); \
                  console.log("Download:", pct + "%"); \
                }) \
              }); \
              s.destroy(); \
            }); \
          } else if (avail === "available") { \
            console.log("[INFO] Model already available"); \
          } \
          await ctx.close(); \
          console.log("[OK] Bootstrap complete"); \
        })().catch(e => { console.error("[ERROR]", e.message); process.exit(1); }); \
      ' && break || { echo "[WARN] Attempt $attempt failed, retrying..."; sleep 2; }; \
    done && \
    chown -R 1001:1001 /home/pwuser/.ai-model-profile && \
    npm uninstall -g playwright && \
    rm -rf /root/.npm/

FROM base AS msedge-dev
ARG PLAYWRIGHT_VERSION
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install msedge-dev && \
    rm -rf /root/.npm/
