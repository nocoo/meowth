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

## 2026-11-22 · L4 session-transcript 嵌套折叠点击被 Playwright 静默吞掉（Run 44806068645）

- 现象：`session transcript light 390px` 在 `toContainText(TOOL_OUTPUT)` 处以 “element(s) not found” 超时；其前的 `aria-expanded='false'`、`'the layout'` 可见断言都通过，`tool.click()` 本身无报错。同代码在 PR run 上绿、在 main push 上红（本地 300+ 次无法复现）。
- 根因：嵌套 tool 折叠的 trigger 位于外层 disclosure 的动画 `overflow:hidden` 容器内；外层内容 mount/unmount 会让内层 trigger 的命中盒在 Playwright 动作性检查与鼠标派发之间移动，命中目标拦截器随即 `preventDefault + stopImmediatePropagation` 取消 mousedown/mouseup——`click()` 正常返回但 React 收不到事件，内层 disclosure 不展开，`[data-bubble-kind="tool-result"]` 从未进 DOM。已用一次性 click 拦截注入复现“点击丢失”观测并验证恢复逻辑。
- 修复：`session-transcript.spec.ts` 引入 `setDisclosure(trigger, expanded)`——点击后断言 `aria-expanded` 达到目标态，未达则重发同一动作；新增外层键盘展开后的 `aria-expanded='true'` 断言。所有内容断言（全文、无 img、无截断）原样保留。
- 预防：对折叠/弹层类交互，E2E 只断言“点击成功”不够——必须断言应用状态翻转（`aria-expanded`）再断言内容；纯 “element(s) not found” 报错优先怀疑动作未生效而非内容缺失。
