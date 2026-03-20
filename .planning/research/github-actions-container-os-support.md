# Research: GitHub Actions `container:` Job Support on Windows and macOS Runners

**Researched:** 2026-03-20
**Overall confidence:** HIGH (well-documented limitation backed by source code analysis, official docs, and issue tracker history)

---

## Executive Summary

GitHub Actions' `container:` job directive is **Linux-only**. This is not a missing feature that might silently work -- it is enforced by a hardcoded `NotSupportedException` in the Actions runner source code (`ContainerOperationProvider.cs`). Windows and macOS runners both reject `container:` jobs at the runner level before Docker is even invoked. This has been the case since the feature launched and remains unchanged as of March 2026.

Docker itself _is_ available on Windows runners (`windows-2025` ships with Docker Engine 29.x), so you can use `docker run` in workflow steps as a workaround. macOS runners have **no Docker** pre-installed due to licensing (Docker Desktop) and nested virtualization constraints (Apple Silicon), requiring Colima-based workarounds that only work reliably on Intel macOS runners.

For this project's Playwright + Edge Dev + Phi-4-mini testing needs, the practical path is running directly on a bare `windows-latest` or `macos-latest` runner without containers, or using the `docker run` workaround on Windows for service containers.

---

## 1. Current State (March 2026)

### The `container:` YAML Directive

| Runner OS                                          | `container:` support | Error                                                      |
| -------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `ubuntu-latest` (all Linux)                        | **Supported**        | N/A                                                        |
| `windows-latest` / `windows-2025` / `windows-2022` | **Not supported**    | `Container operations are only supported on Linux runners` |
| `macos-latest` / `macos-15` / `macos-15-xlarge`    | **Not supported**    | `Container operations are only supported on Linux runners` |

**Confidence:** HIGH -- verified in runner source code.

The restriction is implemented in [`src/Runner.Worker/ContainerOperationProvider.cs`](https://github.com/actions/runner/blob/main/src/Runner.Worker/ContainerOperationProvider.cs):

```csharp
if (!Constants.Runner.Platform.Equals(Constants.OSPlatform.Linux))
{
    throw new NotSupportedException("Container operations are only supported on Linux runners");
}
```

This check runs before any Docker interaction. It applies to:

- `jobs.<job_id>.container` (running the entire job in a container)
- `jobs.<job_id>.services` (service containers)
- Docker-based Actions (`uses: docker://...`)

### Docker Availability on Runners

| Runner             | Docker pre-installed | Docker type        | Notes                                       |
| ------------------ | -------------------- | ------------------ | ------------------------------------------- |
| `ubuntu-latest`    | Yes                  | Docker Engine      | Full Linux container support                |
| `windows-2025`     | Yes                  | Docker Engine 29.x | Windows containers only (process isolation) |
| `windows-2022`     | Yes                  | Docker Engine      | Windows containers only                     |
| `macos-15` (ARM)   | **No**               | N/A                | Apple Silicon, no nested virtualization     |
| `macos-13` (Intel) | **No**               | N/A                | Removed due to Docker Desktop licensing     |

**Confidence:** HIGH -- verified via [runner-images Windows2025-Readme.md](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md) and [macOS Docker removal issue](https://github.com/actions/runner-images/issues/4399).

---

## 2. Windows Containers Specifically

### Can You Run Windows Docker Containers on Windows Runners?

**Yes, but only via `docker run` in workflow steps, NOT via `container:` YAML.**

Windows runners (`windows-2025`, `windows-2022`) have Docker Engine pre-installed and configured for Windows containers. You can execute `docker build`, `docker run`, `docker pull`, etc. directly in PowerShell or Bash steps.

Example from the [Ansys Actions workflow](https://github.com/ansys/actions/blob/main/.github/workflows/ci_cd_pr.yml):

```yaml
jobs:
  test:
    runs-on: windows-latest
    steps:
      - name: Pull and launch service
        shell: bash
        run: |
          docker pull ghcr.io/my-org/my-image:core-windows-latest
          docker run --detach --name my-service -p 700:50051 ghcr.io/my-org/my-image:core-windows-latest
      # ... run tests against the service ...
      - name: Stop service
        if: always()
        run: docker stop my-service && docker rm my-service
```

### Windows Container Constraints

| Constraint                | Detail                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Isolation mode**        | Process isolation only (no Hyper-V on GitHub runners -- VMs are already nested)                                                                                 |
| **OS version matching**   | Container base image must be compatible with host OS. `windows-2025` runners use Windows Server 2025 (build 10.0.26100). Older `ltsc2019` images will fail.     |
| **Container portability** | Windows Server 2025 added "Container Portability" allowing slightly mismatched container/host versions (e.g., LTSC2022 images on 2025 hosts work in some cases) |
| **No cached images**      | `windows-2025` runners have no pre-cached Docker images (unlike `windows-2022`), so every `docker pull` downloads from scratch                                  |
| **No Linux containers**   | Docker on Windows runners is configured for Windows containers, not Linux. No WSL2 backend enabled by default.                                                  |

**Confidence:** HIGH for the constraints. The OS version matching requirement is well-documented in [actions/runner#904 comments](https://github.com/actions/runner/issues/904).

### Clarification on User Reports of `container:` Working

In October 2025, users [@moe-ad and @RobPasMue reported on issue #904](https://github.com/actions/runner/issues/904) that "this seems to be working now" on `windows-2025` runners. **This is misleading.** Examination of the referenced [Ansys workflow](https://github.com/ansys/actions/blob/main/.github/workflows/ci_cd_pr.yml) shows they are using `docker run` in regular steps, NOT the `container:` YAML key. The runner source code still contains the hardcoded Linux-only check with no conditional override for `windows-2025`.

**Confidence:** HIGH -- verified by reading both the source code and the referenced workflow.

---

## 3. Historical Context

### Timeline

| Date    | Event                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2020-11 | GitHub Actions launches with `container:` support for Linux only                                                                                                                                                                                |
| 2021-01 | [Issue #904](https://github.com/actions/runner/issues/904) opened: "Support container operations on Windows runners"                                                                                                                            |
| 2021-06 | [Issue #1402](https://github.com/actions/runner/issues/1402) opened: "Support Windows Containers"                                                                                                                                               |
| 2021-12 | GitHub staff ([@ethomson](https://github.com/ethomson)) responds: "inconsistencies in container support across different versions of Windows make this very difficult. We don't have any plans to enable Windows containers." Labeled `future`. |
| 2022-04 | [PR #1801](https://github.com/actions/runner/pull/1801) submitted by community: "Enable running jobs in windows docker containers." **Still open, never merged.**                                                                               |
| 2023-11 | Community member asks for reconsideration given Windows Server improvements. No GitHub response.                                                                                                                                                |
| 2024-09 | Issue #1402 closed as duplicate of #904                                                                                                                                                                                                         |
| 2025-10 | Users report `docker run` workaround working on `windows-2025` (confused with `container:` support)                                                                                                                                             |
| 2026-03 | Issue #904 remains open. No GitHub staff engagement since 2021.                                                                                                                                                                                 |

### Was It Ever Supported?

**No.** The `container:` directive was Linux-only from day one. The hardcoded check has been present since the initial implementation of container job support.

### Open Issues / PRs

| Issue/PR                                                             | Status                | Last GitHub Staff Activity     |
| -------------------------------------------------------------------- | --------------------- | ------------------------------ |
| [actions/runner#904](https://github.com/actions/runner/issues/904)   | Open                  | 2021 (no response since)       |
| [actions/runner#1402](https://github.com/actions/runner/issues/1402) | Closed (dupe of #904) | 2021-12 (labeled `future`)     |
| [actions/runner#1801](https://github.com/actions/runner/pull/1801)   | Open PR               | Never reviewed by GitHub staff |
| [actions/runner#1456](https://github.com/actions/runner/issues/1456) | Closed                | Docker on Mac runners          |

**Assessment:** GitHub has shown no appetite for implementing Windows container support in the runner. The feature is labeled `future` (lowest priority), the community PR sits unreviewed for 4 years, and there has been zero staff engagement since December 2021.

**Confidence:** HIGH -- issue tracker history is public record.

---

## 4. macOS Specifics

### Docker on macOS Runners

Docker is **not pre-installed** on any GitHub-hosted macOS runner due to Docker Desktop licensing restrictions. GitHub removed Docker from macOS images and replaced it with Colima (an open-source alternative).

### Colima Workaround

```yaml
- name: Setup Docker on macOS
  if: runner.os == 'macos'
  run: |
    brew install docker
    colima start
    sudo ln -sf $HOME/.colima/default/docker.sock /var/run/docker.sock
```

Or use the community action:

```yaml
- uses: douglascamata/setup-docker-macos-action@v1.0.1
```

### Colima Limitations

| Limitation                                       | Detail                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ARM runners (`macos-14`, `macos-15`)**         | M-series processors lack nested virtualization support. Colima cannot start its Linux VM. **Docker is effectively unavailable on ARM macOS runners.** |
| **Intel runners (`macos-13`, `macos-15-intel`)** | Works. Setup takes ~80 seconds.                                                                                                                       |
| **macOS 15+ networking**                         | Apple's Local Network Privacy (LNP) blocks access to the Colima VM's IP from non-root processes. Use `sudo` or `127.0.0.1` with port forwarding.      |
| **No macOS container images**                    | macOS cannot be containerized. Docker on macOS runs Linux containers in a VM.                                                                         |
| **`container:` still blocked**                   | Even with Docker available via Colima, the runner's Linux-only check blocks `container:` jobs.                                                        |
| **macOS 13 retirement**                          | Intel `macos-13` runners retired December 2025. `macos-15-intel` available for larger runners only.                                                   |

**Confidence:** HIGH -- well-documented across [setup-docker-macos-action](https://github.com/douglascamata/setup-docker-macos-action), [Colima issues](https://github.com/abiosoft/colima/issues/1427), and [runner-images#4399](https://github.com/actions/runner-images/issues/4399).

---

## 5. Workarounds

### Workaround A: `docker run` in Steps (Windows)

**Best workaround for Windows.** Run Docker commands manually in workflow steps instead of using `container:`.

```yaml
jobs:
  test:
    runs-on: windows-2025
    steps:
      - uses: actions/checkout@v5
      - name: Run tests in Windows container
        run: |
          docker pull mcr.microsoft.com/windows/server:ltsc2025
          docker run --rm -v ${PWD}:C:\app -w C:\app mcr.microsoft.com/windows/server:ltsc2025 cmd /c "your-test-command"
```

**Pros:**

- Docker is pre-installed on Windows runners
- Windows containers with process isolation work
- No nested virtualization needed

**Cons:**

- No automatic workspace mounting (must handle volumes manually)
- No service container integration (`services:` YAML)
- No automatic network setup between job and container
- Container base image must match host OS version

### Workaround B: WSL2 + Docker on Windows 2025 (Linux Containers on Windows)

Install WSL2 and Docker inside it to run Linux containers on a Windows runner. [Documented by dwozny.com](https://dwozny.com/posts/windows-2025-docker-wsl2/).

```yaml
- name: Install WSL2 and Docker
  run: |
    wsl --install Ubuntu  # ~40 seconds
    wsl -d Ubuntu --exec dbus-launch true  # prevent auto-shutdown
    # Install Docker in WSL (~40 seconds)
    wsl -d Ubuntu -- bash -c "curl -fsSL https://get.docker.com | sh"
```

**Pros:**

- Enables Linux containers on Windows runners
- Enables running _both_ Linux and Windows containers side by side

**Cons:**

- ~2 minutes setup overhead per job
- Localhost networking quirks (use `127.0.0.1` not `localhost`)
- Not officially supported by Microsoft for production
- Complex multi-platform Docker daemon management

### Workaround C: Colima on Intel macOS

See Section 4. Only works on Intel-based macOS runners. ARM runners cannot use this workaround.

### Workaround D: Skip Containers Entirely

Install dependencies directly on the runner OS. For Playwright:

```yaml
jobs:
  test-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
      - run: npm ci
      - run: npx playwright install --with-deps msedge-dev
      - run: npx playwright test --project=msedge-dev
```

**This is the recommended approach for Playwright on Windows/macOS** per [Playwright's own CI documentation](https://playwright.dev/docs/ci): "For Windows or macOS agents, no additional configuration is required -- just install Playwright and run your tests."

### Workaround E: Self-Hosted Runner with Full Container Support

Run a self-hosted Windows runner with Docker configured for your exact needs. This bypasses GitHub-hosted runner limitations but requires infrastructure management.

---

## 6. Playwright on Windows Containers: Known Issues

Even if you could use `container:` on Windows, Playwright in Windows containers has serious unresolved problems:

| Issue                                                                                            | Status     | Link                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------- |
| Playwright fails to launch browsers in Windows Server Core containers                            | Open       | [microsoft/playwright#37161](https://github.com/microsoft/playwright/issues/37161)                    |
| Cannot install Microsoft Edge channel in Windows Docker containers                               | Open       | [microsoft/playwright#21495](https://github.com/microsoft/playwright/issues/21495)                    |
| Firefox does not launch in Windows Containers                                                    | Open       | [microsoft/playwright#13679](https://github.com/microsoft/playwright/issues/13679)                    |
| Must use `mcr.microsoft.com/windows` or `/windows/server` base, NOT `servercore` or `nanoserver` | Documented | [mxschmitt/playwright-windows-containers](https://github.com/mxschmitt/playwright-windows-containers) |

The `playwright-windows-containers` reference project by Playwright maintainer Max Schmitt has only 5 commits and was last updated in 2022. It is essentially unmaintained.

**Bottom line:** Even with Docker available, running Playwright with Edge Dev inside a Windows container is not a viable path today due to browser installation failures and missing OS dependencies.

**Confidence:** HIGH -- verified via multiple open Playwright issues.

---

## 7. Implications for This Project

### Context

This project needs Edge Dev + Phi-4-mini for in-browser AI testing. The current CI strategy uses `container:` with custom Playwright Docker images on `ubuntu-latest`, which works for Linux-based browsers. But Edge Dev (Windows/macOS only for dev channel) and Phi-4-mini (requires specific browser APIs) need Windows or macOS.

### Recommended Approach

**Use bare runners without containers:**

```yaml
jobs:
  e2e-edge-dev:
    runs-on: windows-latest # or macos-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
      - run: npm ci
      - run: npx playwright install --with-deps msedge-dev
      - run: npx playwright test --project=msedge-dev
```

**Why not Windows containers:**

1. `container:` is blocked at the runner level (hardcoded Linux-only check)
2. Even with `docker run` workaround, Playwright cannot install Edge in Windows containers (issue #21495)
3. The `playwright-windows-containers` project is unmaintained
4. Browser launch failures in Server Core (issue #37161)

**Why not macOS containers:**

1. `container:` is blocked at the runner level
2. Docker is not pre-installed on macOS runners
3. ARM macOS runners cannot run Docker at all (no nested virtualization)
4. No macOS container images exist

**The bare runner approach is officially recommended by Playwright** and avoids all container-related issues. Edge Dev installs cleanly on Windows and macOS runners via `npx playwright install msedge-dev`.

---

## 8. Decision Matrix

| Approach                     | Works?                     | Edge Dev?                             | Container isolation? | Setup complexity |
| ---------------------------- | -------------------------- | ------------------------------------- | -------------------- | ---------------- |
| `container:` on Linux        | Yes                        | No (Edge Dev not available on Linux)  | Yes                  | Low              |
| `container:` on Windows      | **No** (blocked by runner) | N/A                                   | N/A                  | N/A              |
| `container:` on macOS        | **No** (blocked by runner) | N/A                                   | N/A                  | N/A              |
| `docker run` on Windows      | Partially                  | No (Edge install fails in containers) | Manual               | High             |
| Bare `windows-latest`        | Yes                        | **Yes**                               | No                   | Low              |
| Bare `macos-latest`          | Yes                        | **Yes**                               | No                   | Low              |
| Self-hosted Windows + Docker | Theoretically              | Unverified                            | Full control         | Very High        |

---

## Sources

### Official Documentation

- [GitHub Docs: Running jobs in a container](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container)
- [GitHub Docs: GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Runner source: ContainerOperationProvider.cs](https://github.com/actions/runner/blob/main/src/Runner.Worker/ContainerOperationProvider.cs)
- [Runner images: Windows2025-Readme.md](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
- [Playwright CI documentation](https://playwright.dev/docs/ci)
- [Playwright Docker documentation](https://playwright.dev/docs/docker)

### GitHub Issues and PRs

- [actions/runner#904: Support container operations on Windows runners](https://github.com/actions/runner/issues/904) (open since Jan 2021)
- [actions/runner#1402: Support Windows Containers](https://github.com/actions/runner/issues/1402) (closed, dupe of #904)
- [actions/runner#1801: Enable running jobs in windows docker containers](https://github.com/actions/runner/pull/1801) (open PR, unreviewed)
- [actions/runner#1456: Install Docker on Mac runners](https://github.com/actions/runner/issues/1456) (closed)
- [actions/runner-images#4399: Add docker to mac images](https://github.com/actions/runner-images/issues/4399)
- [microsoft/playwright#37161: Playwright fails to launch browser in Windows Server Core container](https://github.com/microsoft/playwright/issues/37161)
- [microsoft/playwright#21495: Can't install Edge channel in Windows Docker container](https://github.com/microsoft/playwright/issues/21495)
- [microsoft/playwright#13679: Firefox doesn't launch in Windows Containers](https://github.com/microsoft/playwright/issues/13679)

### Community Resources

- [WSL2 + Docker on Windows 2025 GitHub Actions runners](https://dwozny.com/posts/windows-2025-docker-wsl2/)
- [setup-docker-macos-action](https://github.com/douglascamata/setup-docker-macos-action)
- [mxschmitt/playwright-windows-containers](https://github.com/mxschmitt/playwright-windows-containers)
- [Docker on GitHub Actions macOS Runners (2022)](https://blog.netnerds.net/2022/11/docker-macos-github-actions/)
