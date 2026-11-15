# Retrospective

Accident narratives belong here. Keep only recurring project rules in `AGENTS.md`; cross-project lessons belong in global rules and deterministic checks in hooks/tests.

No accident narratives have been recorded yet.

## 2026-11-15 · pre-commit snapshot 门槛在 macOS /var symlink 下失效（basalt 3.3.6 升级时发现）

- 现象：`pre-commit-l1.sh` 快照（`mktemp $TMPDIR` → `/var/folders/...`）内，vitest `coverage-summary.json` 键是实路径 `/private/var/...`；`check-dashboard-coverage.sh` 因 `path.relative` 越界直接报错，`check-l1-ts-four-metrics.sh` 则静默 `continue` 跳过全部文件——后者是假绿（0/0 按满分通过）。
- 修复：两个脚本的 `REPO_ROOT` 改为 `pwd -P`（物理路径）。已用 /var symlink 快照模拟验证两门槛真实计数。
- 预防：任何“把绝对路径 key 相对仓根”的脚本必须用物理路径比对；跳过分支应视为可疑信号。

## 2026-11-15 · golangci-lint v2.12.2 读不了 Go 1.27 stdlib export data

- 现象：本机 Homebrew Go 升到 1.27.3 后，`pnpm daemon:lint`（`go run golangci-lint@v2.12.2`）报 “export data version 5 is greater than maximum supported version 4”。
- 处置：用模块声明的工具链跑同一版本 linter：`GOTOOLCHAIN=go1.26.10 pnpm daemon:lint`（0 issues）。升级 golangci-lint 或钉住 CI Go 版本前，提交时携带该环境变量。
- 预防：lint 工具链与 stdlib 版本必须同代；升级本机 Go 后先跑一次 `daemon:lint` 再提交。
