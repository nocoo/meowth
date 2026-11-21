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

## 2026-11-22 · L4 session-transcript 嵌套折叠首次点击未生效（Run 44806068645）

- CI 观察：`session transcript light 390px` 中 `tool.click()` 正常返回、无任何报错；其前的 `aria-expanded='false'`、`'the layout'` 可见断言都通过；随后 `toContainText(TOOL_OUTPUT)` 在 5s 超时内未找到 `locator('[data-bubble-kind="tool-result"]')`。同代码在 PR run 上绿、在 main push 上红；本地 300+ 次重放（含 8x CPU 节流、主线程打满、冷 dep 缓存）未再出现。
- 本地验证：用一次性 click 事件拦截在本地复现同形态的“点击未生效”观测，并验证 `setDisclosure` 能检测到 `aria-expanded` 未翻转、重发同一动作后恢复正常。
- 未证实机理：首次点击未生效的根因未定论。候选假说包括外层 disclosure 动画 `overflow:hidden` 容器 mount/unmount 重排内层 trigger 命中盒、进而触发 Playwright 命中目标拦截器在动作性检查与鼠标派发之间取消 mousedown/mouseup 等；本地未捕获到该时序窗口，一律按假说对待，不作定论。
- 修复：`session-transcript.spec.ts` 引入 `setDisclosure(trigger, expanded)`——点击后断言 `aria-expanded` 达到目标态，未达则重发同一动作；新增外层键盘展开后的 `aria-expanded='true'` 断言。所有内容断言（全文、无 img、无截断）原样保留。
- 预防：对折叠/弹层类交互，E2E 只断言“点击成功”不够——必须断言应用状态翻转（`aria-expanded`）再断言内容；纯 “element(s) not found” 报错优先怀疑动作未生效而非内容缺失。
