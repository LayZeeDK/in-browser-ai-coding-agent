# Research: macOS GitHub Actions Runner Memory Optimization

**Researched:** 2026-03-20
**Overall confidence:** HIGH (official GitHub docs, runner-images issues, community reports, Apple documentation)

---

## Executive Summary

The fundamental problem is that GitHub-hosted macOS ARM runners (`macos-latest`) are virtual machines running via Apple's Virtualization Framework with only **7 GB total RAM** and **severely restricted GPU memory** (~1 GB MPS cap). The Phi-4-mini model requires 5.5 GB of GPU VRAM, but on Apple Silicon the GPU shares system RAM. Even with aggressive process cleanup, freeing 5+ GB on a 7 GB VM is physically impossible -- the OS kernel, runner agent, and essential services consume at minimum 1.5-2 GB. Furthermore, GPU memory allocation on these VMs is hard-capped by the hypervisor at approximately 1 GB, regardless of free system RAM.

**The conclusion is unambiguous: standard `macos-latest` (M1 ARM, 7 GB) runners cannot run Phi-4-mini. The Intel macOS runners (`macos-15-intel`, `macos-26-intel`) with 14 GB RAM are the minimum viable option, and even those are marginal.**

---

## 1. macOS Runner Specifications

**Confidence:** HIGH (official GitHub documentation)

### Standard Runners (Free Tier)

| Runner Label                             | Architecture | CPU     | RAM       | Storage   | GPU                         | Free? |
| ---------------------------------------- | ------------ | ------- | --------- | --------- | --------------------------- | ----- |
| `macos-latest` / `macos-15` / `macos-26` | ARM64 (M1)   | 3 vCPU  | **7 GB**  | 14 GB SSD | Paravirtualized (~1 GB cap) | Yes   |
| `macos-15-intel` / `macos-26-intel`      | Intel x64    | 4 cores | **14 GB** | 14 GB SSD | Unknown/no discrete GPU     | Yes   |

### Larger Runners (Paid, GitHub Team/Enterprise Only)

| Runner Label                   | Architecture | CPU      | RAM       | Storage   | GPU                          | Cost      |
| ------------------------------ | ------------ | -------- | --------- | --------- | ---------------------------- | --------- |
| `macos-latest-xlarge` (M2 Pro) | ARM64        | 5-core   | **14 GB** | 14 GB SSD | 8-core GPU (paravirtualized) | $0.16/min |
| `macos-latest-large` (Intel)   | Intel x64    | 12 cores | **30 GB** | 14 GB SSD | Unknown                      | Paid      |

**Source:** [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

### Key Observation

The CI workflow uses `macos-latest` (7 GB) and `macos-26-intel`. The `macos-26-intel` label resolves to the Intel standard runner with 14 GB RAM and 4 cores. This is the more viable option, but 14 GB is still tight for a 5.5 GB GPU VRAM requirement when the OS, runner agent, Node.js, npm, and Playwright are also running.

---

## 2. The GPU Memory Problem on Virtualized macOS

**Confidence:** HIGH (confirmed by GitHub staff on runner-images issue #9918)

### Apple Silicon Runners: MPS Hard-Capped at ~1 GB

GitHub-hosted macOS ARM runners run inside Apple's Virtualization Framework. GPU memory (via Metal Performance Shaders / MPS) is **paravirtualized, not passed through**, and is **hard-capped at approximately 1 GB**. This is not a configuration issue -- it is a hypervisor-level restriction.

**Official confirmation:** Erik Bershel from GitHub confirmed on [actions/runner-images#9918](https://github.com/actions/runner-images/issues/9918) that this is **"expected behaviour for macOS arm64 runners"** and the team is waiting for changes to Apple's Virtualization Framework before MPS can function properly.

**Evidence:**

- PyTorch MPS allocations fail with: `MPS backend out of memory (MPS allocated: 1024.00 MB). Tried to allocate 256 bytes on shared pool.`
- Even allocating 256 bytes fails after the ~1 GB cap is reached
- `torch.backends.mps.is_available()` returns `true` (false positive) but allocations fail
- See [community discussion #155306](https://github.com/orgs/community/discussions/155306) and [runner-images#11899](https://github.com/actions/runner-images/issues/11899)

### What This Means for Phi-4-mini

Edge's Phi-4-mini requires 5.5 GB GPU VRAM. On Apple Silicon GitHub runners:

- Total system RAM: 7 GB (shared between CPU and GPU)
- GPU allocation cap: ~1 GB (hard limit set by hypervisor)
- **Gap: 4.5 GB short of the minimum requirement**

Even Edge's performance override flag (`edge-llm-on-device-model-performance-param@3`) cannot bypass a hypervisor-level memory restriction. The model simply cannot be loaded into GPU memory.

### Intel Runners: No Discrete GPU, But Different Memory Model

Intel macOS runners (`macos-15-intel`, `macos-26-intel`) have 14 GB RAM but **no Apple Silicon GPU**. They have an Intel integrated GPU (likely Intel UHD or Iris). The question is whether Edge Dev on Intel macOS can:

1. Use the Intel integrated GPU for Phi-4-mini inference
2. Fall back to CPU-based inference
3. Simply refuse to load the model

**Confidence:** LOW -- this has not been tested publicly. Microsoft's docs say "5.5 GB VRAM" as a requirement, but the performance override flag is designed to bypass hardware checks. Whether the Intel iGPU in these VMs has sufficient accessible VRAM is unknown.

---

## 3. What Consumes Memory on macOS GitHub Runners?

**Confidence:** MEDIUM (based on macOS CI optimization guides and runner-images discussions)

### System Processes (Estimated Memory Impact)

| Process / Service                 | Purpose                     | Estimated RAM   | Killable?                  |
| --------------------------------- | --------------------------- | --------------- | -------------------------- |
| `kernel_task`                     | macOS kernel                | 800 MB - 1.5 GB | No                         |
| `mds` / `mds_stores` / `mdworker` | Spotlight indexing          | 100-400 MB      | Yes (via `mdutil`)         |
| `softwareupdated`                 | Software update daemon      | 50-150 MB       | Yes (via `launchctl`)      |
| `siriactionsd` / `siriknowledged` | Siri services               | 50-100 MB       | Partially (via `pkill`)    |
| `corespeechd`                     | Speech recognition (Siri)   | 30-80 MB        | Yes (via `pkill`)          |
| `nsurlsessiond`                   | Background network requests | 30-60 MB        | Risky                      |
| `WindowServer`                    | Display server              | 100-300 MB      | No (kills GUI)             |
| `runner` (Actions agent)          | GitHub Actions runner       | 50-100 MB       | No                         |
| `node` (npm ci result)            | Node.js + deps in memory    | 200-500 MB      | Not before we need it      |
| `msedge-dev` (Playwright)         | The browser under test      | 500 MB - 2 GB+  | No (it is the test target) |

### Realistic Memory Budget (7 GB ARM Runner)

| Category                          | Estimated Usage |
| --------------------------------- | --------------- |
| macOS kernel + essential services | ~2.0 GB         |
| Spotlight + Siri + softwareupdate | ~0.5 GB         |
| GitHub Actions runner agent       | ~0.1 GB         |
| Node.js (after `npm ci`)          | ~0.3 GB         |
| Playwright + browser overhead     | ~0.5 GB         |
| Edge Dev process (without model)  | ~0.8 GB         |
| **Remaining for GPU/model**       | **~2.8 GB**     |
| **Required for Phi-4-mini**       | **5.5 GB**      |
| **Deficit**                       | **-2.7 GB**     |

Even after killing Spotlight, Siri, and softwareupdate (~0.5 GB), the maximum reclaimable is ~3.3 GB -- still 2.2 GB short. And this ignores the ~1 GB MPS hard cap.

### Realistic Memory Budget (14 GB Intel Runner)

| Category                          | Estimated Usage |
| --------------------------------- | --------------- |
| macOS kernel + essential services | ~2.5 GB         |
| Spotlight + Siri + softwareupdate | ~0.5 GB         |
| GitHub Actions runner agent       | ~0.1 GB         |
| Node.js (after `npm ci`)          | ~0.3 GB         |
| Playwright + browser overhead     | ~0.5 GB         |
| Edge Dev process (without model)  | ~1.0 GB         |
| **Remaining for GPU/model**       | **~9.1 GB**     |
| **Required for Phi-4-mini**       | **5.5 GB**      |
| **Surplus**                       | **+3.6 GB**     |

After aggressive cleanup (killing ~0.5 GB of services), the Intel runner has ~9.6 GB available. **This is theoretically sufficient** if Edge can use the Intel GPU or fall back to CPU inference.

---

## 4. Memory Optimization Techniques

### 4a. Kill Background Processes

**Confidence:** HIGH (well-documented macOS commands, passwordless sudo available on runners)

These commands can be added as a workflow step before the memory-intensive bootstrap:

```yaml
- name: Free memory (macOS)
  if: runner.os == 'macOS'
  run: |
    echo "=== Memory before cleanup ==="
    vm_stat
    top -l 1 -s 0 | head -20

    # Disable Spotlight indexing (frees 100-400 MB + reduces I/O)
    sudo mdutil -a -i off

    # Kill Spotlight processes
    sudo pkill -f mds_stores || true
    sudo pkill -f mdworker || true

    # Kill Siri services
    sudo pkill -f siriactionsd || true
    sudo pkill -f siriknowledged || true
    sudo pkill -f corespeechd || true
    sudo pkill -f assistantd || true

    # Disable software update daemon
    sudo pkill -f softwareupdated || true

    # Kill other non-essential services
    sudo pkill -f suggestd || true
    sudo pkill -f rapportd || true
    sudo pkill -f cloudd || true
    sudo pkill -f knowledge-agent || true

    # Purge disk cache (frees inactive memory pages)
    sudo purge

    echo "=== Memory after cleanup ==="
    vm_stat
    top -l 1 -s 0 | head -20
```

**Expected savings:** 300-800 MB, depending on what is running.

**Caveats:**

- `launchd` may respawn some killed daemons. Using `pkill` is a one-shot approach; `launchctl bootout` is more permanent but requires knowing the exact service labels which vary by macOS version.
- `sudo purge` flushes the I/O cache but has minimal effect on active allocations. On modern macOS with compressed memory, the benefit is debatable.
- Spotlight and some services may behave differently on macOS 26 vs. macOS 15.

**Source:** [MacStadium: Simple Optimizations for macOS Build Agents](https://macstadium.com/blog/simple-optimizations-for-macos-and-ios-build-agents), [Disable Big Sur/Monterey services gist](https://gist.github.com/gopsmith/bf4d3a8203cd0792c9f8702cc76c8525)

### 4b. Reduce npm ci Memory Footprint

**Confidence:** MEDIUM

`npm ci` on a fresh runner downloads and extracts all `node_modules`. On a project with Angular 21, Nx, Playwright, and Vitest, this can consume 300-500 MB of RAM during installation.

Options:

- **Cache node_modules:** Already done in the CI (`actions/setup-node` with `cache: 'npm'`). This caches the npm cache directory (`~/.npm`), reducing download time but not the extraction/linking RAM.
- **Set `NODE_OPTIONS=--max-old-space-size=2048`** to limit Node.js heap if a later step (like `nx test`) uses too much.
- **Separate the install and test jobs:** Run `npm ci` + `playwright install` in one job, cache the result, then run the model bootstrap in a separate job with a clean memory state. However, this adds complexity and time.

### 4c. `sudo purge` (Flush File System Cache)

**Confidence:** MEDIUM (works but limited benefit)

`sudo purge` flushes the unified buffer cache (file system read cache). This frees "inactive" memory pages that macOS reports as used.

**Key nuance:** Node.js `os.freemem()` (used in the bootstrap script) reports only truly free pages, not reclaimable cache. So the "0.6 GB free" reported in the bootstrap might be misleading -- there could be 2-3 GB of reclaimable cached memory that macOS would release under memory pressure. However, `sudo purge` forces this release proactively.

Before purge: "5.64 GB used" -> After purge: "3.17 GB used" (from Apple Community reports on 8 GB Macs).

**Recommendation:** Worth including but not a silver bullet. The real constraint is the GPU memory cap, not file system cache.

### 4d. Adjust Swap/Memory Pressure

**Confidence:** HIGH (macOS does not support `vm.swappiness`)

macOS does **not** have a `vm.swappiness` sysctl parameter (that is Linux-only). macOS manages swap automatically and dynamically using compressed memory and the `dynamic_pager` daemon.

You **cannot** meaningfully influence macOS swap behavior:

- No equivalent of Linux's `vm.swappiness` tuning
- `dynamic_pager` is a protected system service
- Disabling swap entirely (`sudo launchctl unload /System/Library/LaunchDaemons/com.apple.dynamic_pager.plist`) is dangerous and may crash the VM
- Swap changes are temporary (reset on reboot) and not recommended

**What you can do:** Increase available disk space so macOS has room for swap. The 14 GB SSD on runners is tight. Removing preinstalled software (Xcode simulators, SDKs) frees disk space for swap.

---

## 5. Are There Equivalent "Free Memory" Actions for macOS?

**Confidence:** HIGH (no such action exists)

### The Landscape

| Action                                     | Platform     | Focus      | macOS Support                                                              |
| ------------------------------------------ | ------------ | ---------- | -------------------------------------------------------------------------- |
| `jlumbroso/free-disk-space`                | Ubuntu only  | Disk space | No                                                                         |
| `endersonmenezes/free-disk-space`          | Ubuntu only  | Disk space | No                                                                         |
| `insightsengineering/disk-space-reclaimer` | Ubuntu only  | Disk space | No                                                                         |
| `instructlab/ci-actions/free-disk-space`   | Ubuntu + EC2 | Disk space | [Open issue #2171](https://github.com/instructlab/instructlab/issues/2171) |

**No action exists for freeing RAM on macOS runners.** All existing "free space" actions target Ubuntu and focus on disk space, not memory. InstructLab has an open issue to extend their action to macOS, but it is not implemented.

**The gap exists because:** (1) most macOS CI workloads (iOS builds) are CPU-bound, not memory-bound; (2) macOS's memory management (compressed memory, automatic swap) makes explicit memory freeing less necessary for typical builds; (3) the specific use case of running a 5.5 GB GPU model on a 7 GB CI VM is extremely unusual.

---

## 6. What Do Other Projects Do?

**Confidence:** MEDIUM (limited public examples of this specific use case)

### PyTorch MPS on GitHub Actions

Multiple projects have tried and failed to use GPU acceleration on macOS runners:

- [actions/runner-images#9918](https://github.com/actions/runner-images/issues/9918): MPS reported as available but fails with OOM at 0 bytes allocated, max allowed 7.93 GB
- [community#155306](https://github.com/orgs/community/discussions/155306): MPS hard-capped at 1.03 GB on `macos-15` runners
- [PyTorch Forums](https://discuss.pytorch.org/t/mps-back-end-out-of-memory-on-github-action/189773): Inconsistent failures, max allowed reported as 1.70 GB

**Outcome:** No project has successfully run GPU-intensive ML workloads on standard GitHub-hosted macOS runners. The universal recommendation is self-hosted runners.

### Self-Hosted macOS Runners

[Whatnot Engineering](https://medium.com/whatnot-engineering/migrating-ios-github-actions-to-self-hosted-m1-macs-runners-f75fbb00ab1b) migrated from GitHub-hosted runners to self-hosted Mac Mini M2 with full hardware access, reducing build times from 50+ minutes to ~12 minutes. Full GPU and unified memory access eliminated the VM-level restrictions.

### MacStadium / Anka / Tart

CI infrastructure providers like MacStadium, Cirrus Labs (Tart), and Veertu (Anka) offer macOS VMs with configurable GPU passthrough. This is the path for projects that need real GPU access in CI. However, this requires a paid infrastructure account.

---

## 7. Is 7 GB Simply Not Enough?

**Confidence:** HIGH

### The Arithmetic

| Requirement                         | 7 GB ARM Runner | 14 GB Intel Runner |
| ----------------------------------- | --------------- | ------------------ |
| macOS kernel + services             | -2.0 GB         | -2.5 GB            |
| Runner agent + Node.js + Playwright | -1.2 GB         | -1.2 GB            |
| Edge Dev process (no model)         | -0.8 GB         | -1.0 GB            |
| Available for model                 | **3.0 GB**      | **9.3 GB**         |
| Phi-4-mini requirement              | 5.5 GB          | 5.5 GB             |
| **Feasible?**                       | **NO**          | **MAYBE**          |

### Additional Constraints

1. **GPU memory cap (~1 GB on ARM):** Even if 3 GB of system RAM were free, the GPU can only allocate ~1 GB. The model needs 5.5 GB of GPU memory specifically.

2. **Performance override flag:** Edge's `edge-llm-on-device-model-performance-param@3` bypasses the browser's hardware check, but it cannot override the hypervisor's GPU memory allocation limit.

3. **CPU fallback unknown:** Chrome's Gemini Nano supports CPU fallback (requires 16 GB RAM + 4 cores). Whether Edge's Phi-4-mini supports CPU inference is undocumented. If it does, the 14 GB Intel runner becomes more viable.

### Verdict

| Runner                                | Can Run Phi-4-mini? | Reason                                        |
| ------------------------------------- | ------------------- | --------------------------------------------- |
| `macos-latest` (M1 ARM, 7 GB)         | **NO**              | 7 GB total is too little, GPU capped at ~1 GB |
| `macos-26-intel` (Intel, 14 GB)       | **MAYBE**           | Enough RAM, but Intel GPU capability unknown  |
| `macos-latest-xlarge` (M2 Pro, 14 GB) | **UNLIKELY**        | More RAM but same MPS cap issue on ARM VMs    |
| `macos-latest-large` (Intel, 30 GB)   | **PROBABLY**        | Plenty of RAM, paid only (Team/Enterprise)    |
| Self-hosted Mac Mini M4 (32+ GB)      | **YES**             | Full hardware access, no VM restrictions      |

---

## 8. Recommended Actions

### Immediate: Add Memory Diagnostics

Add a step before the bootstrap to log actual memory state:

```yaml
- name: Memory diagnostics
  if: runner.os == 'macOS'
  run: |
    echo "=== System Memory ==="
    sysctl hw.memsize
    vm_stat
    memory_pressure
    echo "=== Top processes by memory ==="
    ps aux --sort=-%mem | head -20
    echo "=== GPU info ==="
    system_profiler SPDisplaysDataType 2>/dev/null || true
```

This will tell us: (1) actual free memory after `npm ci` + `playwright install`, (2) memory pressure level, (3) what GPU is available and how much VRAM it reports, (4) which processes are consuming the most memory.

### Immediate: Add Memory Cleanup Step

Before the model bootstrap, add the process cleanup from Section 4a. Even if it does not solve the GPU memory cap, it provides more headroom for the browser process:

```yaml
- name: Free memory for model bootstrap
  if: runner.os == 'macOS'
  run: |
    sudo mdutil -a -i off
    sudo pkill -f mds_stores || true
    sudo pkill -f mdworker || true
    sudo pkill -f siriactionsd || true
    sudo pkill -f siriknowledged || true
    sudo pkill -f corespeechd || true
    sudo pkill -f softwareupdated || true
    sudo pkill -f suggestd || true
    sudo purge
```

### Short-term: Drop `macos-latest` for Edge Dev

Remove the `macos-latest` (ARM, 7 GB) entry from the CI matrix for Edge Dev + Phi-4-mini. It will never work due to the GPU memory cap. Keep `macos-26-intel` (14 GB) as the macOS test runner.

### Short-term: Investigate Intel GPU Capabilities

Run a diagnostic workflow on `macos-26-intel` to determine:

1. What GPU is available (`system_profiler SPDisplaysDataType`)
2. Whether Edge's `edge://gpu` page reports adequate GPU capabilities
3. Whether the performance override flag allows the model to load despite hardware limitations
4. Whether Edge falls back to CPU inference on Intel Macs

### Medium-term: Consider Larger Runners or Self-Hosted

If `macos-26-intel` fails, the options are:

- **`macos-latest-large` (Intel, 30 GB, paid):** Most likely to work, but requires GitHub Team/Enterprise plan
- **Self-hosted Mac Mini:** Full hardware access, ~$500-800 one-time cost for a Mac Mini M4 with 32 GB
- **Accept macOS CI as aspirational:** Test Edge Dev + Phi-4-mini only on Windows runners (which have discrete GPUs and more RAM) and run macOS testing locally

### Long-term: Monitor Apple Virtualization Framework Changes

GitHub staff confirmed they are waiting for Apple to improve GPU support in the Virtualization Framework. When this happens, the MPS memory cap may be lifted, making ARM runners viable for GPU workloads.

---

## 9. The `os.freemem()` Misleading Reporting Issue

**Confidence:** HIGH

A critical detail: the bootstrap script uses `os.freemem()` which on macOS returns only truly free pages. macOS aggressively uses free RAM for file system caching, reporting very little as "free" even when memory is available. A Mac with 7 GB might report 0.6 GB "free" while having 2-3 GB of reclaimable cache.

The `InvalidStateError: The device is unable to create a session to run the model` error is likely NOT caused by insufficient system RAM per se, but by the **GPU memory allocation failing** at the Metal/MPS level due to the hypervisor cap.

Recommendation: update the bootstrap diagnostics to use `vm_stat` and `memory_pressure` instead of `os.freemem()` for more accurate reporting:

```javascript
// Better memory reporting for macOS
if (platform() === 'darwin') {
  try {
    const vmStat = execSync('vm_stat', { encoding: 'utf8', timeout: 5000 });
    console.log(
      `  vm_stat:\n${vmStat
        .trim()
        .split('\n')
        .map((l) => '    ' + l)
        .join('\n')}`,
    );

    const pressure = execSync('memory_pressure', { encoding: 'utf8', timeout: 5000 });
    console.log(`  memory_pressure: ${pressure.trim()}`);
  } catch {
    /* ignore */
  }
}
```

---

## Sources

### Official GitHub Documentation (HIGH confidence)

- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) -- Runner specs table
- [Larger runners reference](https://docs.github.com/en/actions/reference/runners/larger-runners) -- Paid runner specs
- [macOS 26 GA announcement](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/)
- [M2 Pro runner announcement](https://github.blog/changelog/2025-07-16-github-actions-now-offers-m2-pro-powered-hosted-runners-in-public-preview/)

### GitHub Issues (HIGH confidence)

- [actions/runner-images#9918: Mac OS runner not capable of running MPS](https://github.com/actions/runner-images/issues/9918) -- GitHub staff confirmed MPS limitation
- [actions/runner-images#11899: Apple M1 MPS Out-of-Memory on macos-15](https://github.com/actions/runner-images/issues/11899) -- Hard cap confirmed at ~1 GB
- [community#155306: MPS Out-of-Memory issues on macos-15](https://github.com/orgs/community/discussions/155306) -- Community reproduction
- [actions/runner-images discussions#5032: Spotlight on macos-latest runners](https://github.com/actions/runner-images/discussions/5032) -- Spotlight CPU impact
- [actions/runner-images#13637: macOS 26 Intel public beta](https://github.com/actions/runner-images/issues/13637) -- Intel runner availability
- [instructlab/instructlab#2171: Free disk space for macOS](https://github.com/instructlab/instructlab/issues/2171) -- No macOS memory action exists

### CI Optimization Guides (MEDIUM confidence)

- [MacStadium: Simple Optimizations for macOS Build Agents](https://macstadium.com/blog/simple-optimizations-for-macos-and-ios-build-agents) -- Spotlight, Siri disabling
- [Disable Big Sur/Monterey services (GitHub Gist)](https://gist.github.com/gopsmith/bf4d3a8203cd0792c9f8702cc76c8525) -- Comprehensive launchctl script
- [Eclectic Light: Can you disable Spotlight and Siri in macOS Tahoe?](https://eclecticlight.co/2026/01/16/can-you-disable-spotlight-and-siri-in-macos-tahoe/) -- macOS 26 service management

### Apple & macOS Documentation (HIGH confidence)

- [Apple: Paravirtualized Graphics](https://developer.apple.com/documentation/paravirtualizedgraphics) -- GPU in VMs
- [PyTorch Forums: MPS backend out of memory on GitHub Actions](https://discuss.pytorch.org/t/mps-back-end-out-of-memory-on-github-action/189773) -- Community MPS testing

### Edge Dev Documentation (HIGH confidence)

- [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- 5.5 GB VRAM requirement
- [MSEdgeExplainers#1224: 9216 token context window](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1224) -- Model constraints
