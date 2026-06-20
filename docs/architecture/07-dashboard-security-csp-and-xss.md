# Architecture · 07 · Dashboard security — CSP & XSS

> **更新规则**：本文档定义 dashboard 端 XSS 防御、daemon 注入的 CSP / 安全 header、secret 显示 UX、日志脱敏。
> 任何 CSP 指令、Biome 规则、untrusted content 渲染路线 / sanitizer 例外路径、secret modal 行为的改动，必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/architecture/07-dashboard-security-csp-and-xss.md`。

> 上层依据：[`docs/01-project-overview.md`](../01-project-overview.md) §7.9、§9.2 Phase 3.10 / 3.15 / 3.16 / 3.24。
> 本文档**不涉及**：
> - HTTP wire / middleware chain 位置（→ [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md) §12；本文档只**定义** security headers 的内容，挂载位置在 02）
> - token 表 / argon2id / bearer auth 算法（→ [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md)）
> - `/bootstrap/mint` 自身的 drive-by lockout / source gate（→ [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md) §6.6；本文档**不**重新定义 04 的 Origin / Fetch-Metadata 规则）
> - dashboard 目录拓扑 / MVVM 分层 / basalt source-copy / `/setup` 决策树（→ [`06-dashboard-mvvm-and-basalt.md`](06-dashboard-mvvm-and-basalt.md)）
> - 6DQ hook 接线（→ `08-6dq-hooks-wiring.md`）

---

## 1. 范围

本文档管：

- daemon 在 dashboard HTML / 静态资源响应里注入的 **CSP** 与其它安全 headers 的完整内容
- dashboard 渲染 untrusted content（agent stdout/stderr/messages）的**统一路线**
- ANSI 转 React 节点的算法约定
- Biome 规则禁用 `dangerouslySetInnerHTML`（G1 阻断）
- 构建产物（`apps/dashboard/dist/`）的 dist scan 规则（G1 + build check）
- secret 显示 UX：`SecretReveal` 组件契约、clipboard 行为、modal 关闭即清
- 日志 / error / toast 的 redactor 规则（任何文本输出都不能漏 secret）
- 第三方依赖审查策略（osv-scanner / `eval` 禁用 / gitleaks）
- 与 6DQ 各层的测试映射

本文档不管：

- daemon `Authorization: Bearer` 校验（→ 03）
- daemon `/bootstrap/mint` 的 `Origin` / `Sec-Fetch-Site` 检查（→ 04）
- dashboard MVVM 边界、`/setup` 决策树（→ 06）
- L1 / L3 工具链具体版本（→ 08）

---

## 2. 设计原则（XSS 防御的总体策略）

1. **零 HTML 字符串拼接**：dashboard **永远不**用 `innerHTML` / `dangerouslySetInnerHTML` / `document.write` 把 untrusted 字符串塞进 DOM。所有 untrusted content（含 agent 输出）走 React 文本节点或结构化 React 节点路径
2. **零远程脚本**：所有 JS / CSS / fonts 从 same-origin 加载，无 CDN 引用、无 `<script src="https://...">`、无 `@import url("https://...")`、无 `<link rel="stylesheet" href="https://...">`
3. **CSP 用最严指令直接禁止上述行为**（§4）
4. **secret 仅在用户显式 reveal / copy 时存在于 plaintext 形态**（§7）；任何 logging / toast / error 路径**永远不**写 secret 字面值（§8）
5. **本文档约束 dashboard 与 daemon embed 的 production response**；dev 模式（Vite dev server）的 CSP 不在 v1 强约束中（§4.4）

---

## 3. Untrusted content 的统一渲染路线（强制）

dashboard 显示的 untrusted 文本来源：

- agent envelope `payload.content`（[`02`](02-daemon-http-protocol.md) §5.3 message type=text/error/log 等）
- agent `payload.output`（tool-result）
- agent `payload.tool` / `payload.input` 字段（tool-use 显示）
- `agent.Result.Output` 累积输出
- problem+json 的 `title` / `detail` / `instance`（[`02`](02-daemon-http-protocol.md) §10）
- token `name` 字段（用户自定义；不进 secret 范围，但仍 untrusted）

### 3.1 默认路线：text + ANSI → React nodes

**所有** untrusted 文本默认走以下路径：

```
untrusted string → ansiToReactNodes(s) → React.Fragment<span ...>{textChunks}</span>
```

`src/lib/ansi.ts` 实现：

```ts
// 输入：含 ANSI escape sequences 的字符串
// 输出：React node 数组，每个 node 是 <span> 带 className（如 'text-red-500' / 'font-bold'）
// 算法：
//   1. 按 CSI 序列正则切分（\x1b\[[\d;]*m）
//   2. 维护一个 styleState（前景色 / 背景色 / 粗体 / 下划线）
//   3. 每个非 CSI 段：生成 <span className={cn(...computeClasses(styleState))}>{text}</span>
//   4. CSI 段：更新 styleState
//   5. CSI 之外的 ANSI 序列（光标移动 / 屏幕清除等）：直接丢弃，不影响输出
//   6. 数组返回；调用方 React.Children.toArray 渲染
//
// 严格不使用：innerHTML / dangerouslySetInnerHTML / document.createElement 后 setAttribute
// 严格不使用：eval / new Function / Function constructor
```

UI 层调用方：

```tsx
import { ansiToReactNodes } from '@/lib/ansi';

function MessageText({ content }: { content: string }) {
  return <pre className="font-mono text-sm whitespace-pre-wrap">{ansiToReactNodes(content)}</pre>;
}
```

React 自动转义 `{text}` 中的 `<` / `>` / `&` 等字符，攻击者无法通过 `<script>` 注入。

### 3.2 唯一允许的 sanitized HTML 例外

v1 **不**开放此例外；即默认 dashboard **完全不存在**任何 `dangerouslySetInnerHTML` 调用点。

若后续某页面（如显示远程 changelog / agent 输出的 Markdown 注释块）确实需要渲染 HTML，必须满足**全部**以下条件，且单独立项：

- 新增唯一 wrapper 组件 `src/components/SanitizedHtml.tsx`，内部唯一调用 `dangerouslySetInnerHTML`；该文件加 Biome 行内 suppression `// biome-ignore lint/security/noDangerouslySetInnerHtml: see docs/architecture/07 §3.2`
- 输入字符串先过 `DOMPurify.sanitize(input, profile)`，`profile` 在本文档新增小节里锁定。两种 profile 互斥选其一，**取决于该例外是否允许链接**：
  - **profile A（禁链接）**：完全拒绝 `<a>` / `href` / 任何 URI 属性；`FORBID_TAGS=['script','style','iframe','object','embed','link','meta','a']`、`FORBID_ATTR=['srcdoc','formaction','href','onerror','onload','onclick','onmouseover','onfocus','onblur']`、不设 `ALLOWED_URI_REGEXP`
  - **profile B（允许同源 + http(s) 链接）**：`FORBID_TAGS=['script','style','iframe','object','embed','link','meta']`、`FORBID_ATTR=['srcdoc','formaction','onerror','onload','onclick','onmouseover','onfocus','onblur']`（**不**禁 `href`）、`ALLOWED_URI_REGEXP=/^(https?:|#)/i`、`ADD_ATTR=['target','rel']`（强制 `rel="noopener noreferrer"`、`target="_blank"` 由调用方添加）

  立项时必须明确选 A 还是 B 并写入本文档。**禁止**同时禁 `href` 又设 `ALLOWED_URI_REGEXP`（语义矛盾）。
- 输入输出 L1 测试覆盖 ≥ 10 种 XSS payload（OWASP cheatsheet 常见集）
- L3 playwright 注入实测断言显示为文本节点
- 任何**直接**使用 `dangerouslySetInnerHTML`（不通过 `SanitizedHtml`）的 PR 必须 G1 红

**v1 现状**：上述例外**不**触发。本文档**不**在 §3 之外列出任何 sanitized HTML 路径；Biome 规则按 §5 严格阻断。

### 3.3 Markdown 不在 v1 渲染范围

agent 输出**不**作为 Markdown 渲染（只显示原文 + ANSI）。理由：

- v1 用例足够：ANSI 着色 + monospace 已足够展示 CLI agent 输出
- 默认禁 Markdown 渲染等于砍掉一整条 XSS 攻击面（链接协议白名单 / inline HTML / 图片 src 等都不存在）

若未来引入 Markdown：

- 走 AST → React node 路径（不走 HTML string），实现库选 `react-markdown` 配合严格 plugin 配置（禁 raw HTML / 链接协议白名单 `http`/`https`/`#` / 禁 `javascript:` `data:` event handler）
- 单独立项扩展本文档；v1 文本里**禁止**用任何 Markdown 库

### 3.4 token `name` 字段

用户在 `POST /v1/tokens` body 自填的 `name`（1..64 字符）也作为 untrusted 显示。dashboard 把它作为 React `{name}` 文本节点渲染，React 自动转义；不需要 sanitize、不需要 ANSI 转换（`name` 不应含 ANSI escape，但即使含也只是无害文字）。

---

## 4. CSP 与安全 headers（daemon 注入）

### 4.1 注入位置

安全 header 分**两类**挂载，避免与 [`02`](02-daemon-http-protocol.md) §12 的 `security_headers` middleware 冲突：

**A. Document-level headers**（仅在返回 HTML 的响应注入；02 §12 `security_headers` 范围；详 §4.2）：

- `GET /` 与所有 SPA fallback 响应（任何返回 `index.html` 的请求；含 deep link 如 `/overview` / `/setup`，由 daemon embed 路由把未匹配静态资源的请求 fallback 到 `index.html`）
- `GET /index.html`
- 注入：`Content-Security-Policy`、`Referrer-Policy`、`Cross-Origin-Opener-Policy`、`Cross-Origin-Resource-Policy`、`Permissions-Policy`

> `Cross-Origin-Resource-Policy` 同时属于 A（HTML response）与 B（asset response）的 resource isolation 范畴——HTML / asset 都要带，但 HTML 还要带其它 document-level header；asset 只带 CORP + nosniff + Cache-Control。

**B. Resource-level headers**（除 HTML 外的静态资源；详 §4.3）：

- `GET /assets/*` 等静态资源（JS / CSS / fonts / images）
- 注入：`Cross-Origin-Resource-Policy`、`Cache-Control`、合适的 `Content-Type`
- **不**注入 `CSP` / `Referrer-Policy` / `COOP` / `Permissions-Policy`（这些是 document-level header）

**C. 全局 nosniff middleware**（独立于 A / B，挂在所有路径前面）：

- 路径覆盖：`GET /` / `GET /index.html` / `GET /assets/*` / `/v1/*` / `/healthz` / `/bootstrap/*` —— **所有响应**
- 仅注入：`X-Content-Type-Options: nosniff`
- 这是一个**独立的 tiny middleware**，不与 §4.2 `security_headers` 同层；02 §12 middleware chain 应在 `recover` 之后、`body_limit` 之前增加一层 `nosniff` middleware

**对 02 的同步要求**：[`02`](02-daemon-http-protocol.md) §12 当前把 `security_headers` 限定在 HTML/静态资源；本文档把 `nosniff` 提升为全局 middleware（API JSON 响应也要带）。02 §12 需要在落地 Phase 3.10 时同步扩展为两层：

- `nosniff` middleware（所有路径）
- `security_headers` middleware（仅 HTML / SPA fallback；按 §4.2 注入）

记入 §13 未决问题 #5 提醒 02 后续勘误。

**v1 端点（`/v1/*` / `/healthz` / `/bootstrap/*`）只**带 `nosniff`；它们返回 JSON / NDJSON，浏览器从 dashboard HTML 加载后续 API 时由 dashboard `index.html` 的 CSP 控制 `connect-src`，不需要 API 响应自带 CSP。

### 4.2 HTML response（`index.html` 及 SPA fallback）固定 header

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
```

**指令选择理由**（在测试里逐条断言，在代码里不要写成注释——CSP header 是一行字面值）：

| 指令 | 值 | 理由 |
|------|---|------|
| `default-src 'self'` | 兜底：所有未列出的 fetch destination 都仅 same-origin | 防意外引入新 destination 类型时漏配 |
| `script-src 'self'` | **不含** `'unsafe-inline'` / `'unsafe-eval'` | dashboard 用 Vite production build，所有 JS 来自 `apps/dashboard/dist/assets/*.js`；无内联 `<script>`；无 `eval` |
| `style-src 'self'` | 先尝试**不含** `'unsafe-inline'`；L3 验证通过后保留 | 若 Radix 某些组件需要 inline `style=""` 属性（注：HTML `style` 属性属于 `style-src-attr` 派生；CSP3 默认归 `style-src`），L3 playwright 测试发现实际违反时再最小放开（写在本文档 §13 未决问题） |
| `img-src 'self' data:` | 允许内联 `data:` 用于小图标 | basalt source-copy 可能用 `data:image/svg+xml,...` 内联 icon；不放 `https:` 避免远程图片 |
| `font-src 'self'` | dashboard 自带字体（如 system stack 或本地 woff） | **不**加 `data:`（v1 没有 base64 字体子集需求） |
| `connect-src 'self'` | 锁死 fetch/XHR/WebSocket 目标到同源 | 阻止任何外联（telemetry / CDN API）。dashboard 只跟 daemon 通信，全 same-origin |
| `object-src 'none'` | 禁 Flash / `<object>` / `<embed>` | 老 plugin 攻击面 |
| `base-uri 'none'` | 禁 `<base href>` 改基址 | 防注入 base 标签把后续相对 URL 重定向 |
| `frame-ancestors 'none'` | 禁任何站点 iframe 嵌入 dashboard | clickjacking / UI redress 防御 |
| `form-action 'self'` | `<form action>` 目标只能同源 | dashboard v1 不用原生 form 提交，但兜底 |

**与 06 §3.4 production zero-CORS 一致**：`connect-src 'self'` 配合 daemon 不返回 `Access-Control-Allow-Origin`，无论 mode（[`05`](05-remote-access-modes.md)）如何都保持 same-origin。

### 4.3 静态 asset response header

`GET /assets/*.js` / `*.css` / `*.woff2` 等：

```
Content-Type: <按文件类型>
X-Content-Type-Options: nosniff
Cross-Origin-Resource-Policy: same-origin
Cache-Control: public, max-age=31536000, immutable      # Vite 输出含 hash 文件名
```

- **不**注入 `Content-Security-Policy`（CSP 是 HTML document 的属性；resource 受 HTML 的 CSP 控制）
- **不**注入 `Referrer-Policy` / `COOP` / `Permissions-Policy`（这些属于 document-level header）
- `Cache-Control immutable` 利用 Vite hash 文件名做永久缓存（不影响安全，但是性能上必须）
- **`index.html` 与 SPA fallback** 用 `Cache-Control: no-cache`（避免老 hash 残留），与 assets 区分

### 4.4 dev 模式 CSP（不在 v1 强约束）

Vite dev server 自己注入 HMR 需要的 inline script / inline style；这与 production CSP 严格指令冲突。v1 选定方案：

- **production embed**（daemon `go:embed apps/dashboard/dist` 后通过 daemon 提供）**强制**全部 §4.2 / §4.3 header
- **Vite dev server**（`vite` 命令本地启动）**不**注入 §4.2 严格 CSP；可信任 dev 环境
- L3 playwright 只在 production embed 形态下断言 header；dev 下不算回归

**重要一致性**：dev 下 CSP 宽松**不**反向放宽 production CSP。production CSP 永远以 §4.2 为权威，dev 环境只是工程便利。

---

## 5. React / Biome 端的强制约束

### 5.1 Biome 规则

`apps/dashboard/biome.json`（继承 root + 局部 override）必含：

```json
{
  "linter": {
    "rules": {
      "security": {
        "noDangerouslySetInnerHtml": "error"
      },
      "suspicious": {
        "noGlobalEval": "error",
        "noEmptyBlockStatements": "error"
      },
      "correctness": {
        "noUnusedVariables": "error"
      }
    }
  }
}
```

- `noDangerouslySetInnerHtml: error` → G1 阻断；任何 `<X dangerouslySetInnerHTML={...} />` 编译期红（[`docs/01-project-overview.md`](../01-project-overview.md) §7.9 #3 一致）
- `noGlobalEval: error` → 禁 `eval('...')` / `window.eval(...)`
- `Function` constructor（`new Function('...')`）由 Biome 通用规则覆盖，**额外** §6.1 dist scan 把守

若未来引入 ESLint（v1 不引入），同步开 `react/no-danger`、`no-eval`、`no-new-func`。

### 5.2 源码层 grep 兜底

CI 跑（[`08`](08-6dq-hooks-wiring.md) G1），`scripts/check-dashboard-source.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SRC="apps/dashboard/src"
HTML="apps/dashboard/index.html"

fail() {
  echo "::error::$1"
  exit 1
}

check_pattern() {
  local pattern="$1" desc="$2"
  shift 2
  if rg -n "$pattern" "$@" >/dev/null 2>&1; then
    rg -n "$pattern" "$@"
    fail "$desc"
  fi
}

# 禁止源码引入远程脚本/样式/字体
check_pattern 'src=["'\'']https?://' 'remote <script src=> in source' "$SRC" "$HTML"
check_pattern 'href=["'\'']https?://' 'remote <link href=> in source' "$SRC" "$HTML"
check_pattern '@import\s+url\(["'\'']https?:' 'remote @import url() in source' "$SRC"

# 禁止 eval / new Function（即使 Biome 漏过）
check_pattern 'eval\s*\(' 'eval() in source' "$SRC"
check_pattern 'new\s+Function\s*\(' 'new Function() in source' "$SRC"

# 禁止 dangerouslySetInnerHTML（Biome 已查，rg 兜底）
check_pattern 'dangerouslySetInnerHTML' 'dangerouslySetInnerHTML in source' "$SRC"

echo "dashboard source scan: OK"
```

任一命令命中即 G1 红。脚本封装成 `check_pattern` 函数确保 `set -e` 友好（不依赖 `&& exit 1` AND-list 风格）。

---

## 6. 构建产物 dist scan（build check）

源码规则不能保证最终 `apps/dashboard/dist/` 干净（第三方包可能引入远程引用 / `eval` polyfill）。CI 在 `pnpm --filter @meowth/dashboard build` 之后跑：

### 6.1 dist scan 脚本

`scripts/check-dashboard-dist.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

DIST="apps/dashboard/dist"

# 1. index.html 不含远程 script/style/font
if grep -E '<script[^>]+src="https?://' "$DIST/index.html" >/dev/null 2>&1; then
  echo "::error::$DIST/index.html contains remote <script src=>"
  exit 1
fi
if grep -E '<link[^>]+href="https?://' "$DIST/index.html" >/dev/null 2>&1; then
  echo "::error::$DIST/index.html contains remote <link href=>"
  exit 1
fi

# 2. 所有 JS / CSS chunk 不含 eval / new Function / 任何远程 URL
# 远程 URL 默认全禁；如有合法引用（fixture / mock / 用户配置域名），列入 allowlist:
#   ALLOW_REMOTE_URL_RE 环境变量是一个 ERE，匹配的 URL 跳过 dist scan
# 例：ALLOW_REMOTE_URL_RE='^https://meowth\.example\.com/'
ALLOW_RE="${ALLOW_REMOTE_URL_RE:-}"

find "$DIST" \( -name '*.js' -o -name '*.css' \) -print0 | while IFS= read -r -d '' f; do
  if grep -E '\beval\s*\(' "$f" >/dev/null 2>&1; then
    echo "::error::$f contains eval()"
    exit 1
  fi
  if grep -E '\bnew\s+Function\s*\(' "$f" >/dev/null 2>&1; then
    echo "::error::$f contains new Function()"
    exit 1
  fi
  # 提取所有 http(s) URL，逐个核对 allowlist
  if remote_hits=$(grep -oE 'https?://[^"'\''[:space:],)]+' "$f"); then
    while IFS= read -r url; do
      [ -z "$url" ] && continue
      if [ -n "$ALLOW_RE" ] && echo "$url" | grep -E "$ALLOW_RE" >/dev/null 2>&1; then
        continue
      fi
      echo "::error::$f references remote URL: $url"
      exit 1
    done <<< "$remote_hits"
  fi
done

echo "dashboard dist scan: OK"
```

挂在 G1 pipeline，pre-push / CI 跑（[`08`](08-6dq-hooks-wiring.md)）。

### 6.2 dist scan 的允许例外

- **`data:` URI**：`data:image/svg+xml,...` / `data:font/woff,...` 内联资源不属于 `https?://` 范围，scan 默认通过；CSP `img-src 'self' data:` 控制最终允许
- **远程 URL allowlist**：通过 `ALLOW_REMOTE_URL_RE` 环境变量传入 ERE 正则；v1 production build **应该为空**（dashboard 完全 same-origin）；仅在测试 fixture / 用户自定义域名场景下设置
- **v1 不引入 `// skip-scan` 行内豁免机制**：避免单点豁免逃逸到 production；如发现需要豁免的具体场景（极少），先在本文档新增 §6.3 小节展开规则再实现

---

## 7. Secret 显示 UX

### 7.1 `SecretReveal` 组件契约

`apps/dashboard/src/components/SecretReveal.tsx`（meowth-local，[`06`](06-dashboard-mvvm-and-basalt.md) §4.1.3）：

```tsx
type SecretRevealProps = {
  secret: string;                  // 当前明文 secret；调用方负责短生命周期持有
  label?: string;                  // a11y 标签
  onCopy?: () => void;             // 复制成功回调
  initiallyMasked?: boolean;       // 默认 true
  revealRestoreMs?: number;        // 复制后多少 ms 自动恢复 masked；默认 3000
};
```

**行为契约**：

1. **默认 masked**：组件初次渲染显示 `mwt_••••••••...` 一类遮罩字符串（按 secret 长度生成）；plaintext **不**进入 DOM（不放入 `<input value>`、不放入 textContent）
2. **Reveal 按钮**：用户点击 → state 翻转 → 显示 plaintext；按钮文案变 "Hide"
3. **Copy 按钮**：点击 → `await navigator.clipboard.writeText(secret)` → 调 `onCopy?.()` → state 短时保持 reveal（默认 3s）→ 自动 restore masked；不需要先 reveal 即可 copy（直接读 `secret` prop）
4. **失焦自动 mask（可选）**：组件 `useEffect` 监听 `document.visibilitychange`；标签页切走时 force mask；切回不自动 reveal
5. **modal 关闭时**：调用方负责把 React state 里的 `secret` 设为 `null`/空；`SecretReveal` 自己不持有外部 state

**plaintext 暴露的诚实表述**：

- "secret 永不进入 DOM" 不是绝对承诺。reveal 时 plaintext 必然在 DOM textContent 短时存在；copy 时 plaintext 进 OS clipboard（Meowth 不能控制 clipboard 后续生命周期）
- 实际安全边界 = **默认 masked + 显式 reveal + clipboard 是用户主动行为**；不是 "DOM 永不见到 plaintext"

### 7.2 创建 token 的 modal 流程

`pages/Tokens/TokensPage.tsx` + Dialog（[`06`](06-dashboard-mvvm-and-basalt.md) §7.4）：

1. 用户点 "Create token" → Dialog 打开 → 输入 `name`
2. 提交 → `POST /v1/tokens` → 拿到响应 `{ id, prefix, secret, ... }`
3. Dialog 切换到 "secret reveal" 视图：用 `<SecretReveal secret={resp.secret} />`
4. 用户复制后关闭 Dialog
5. Dialog close handler 在 viewmodel 里：`setCreatedSecret(null)`（清 React state）
6. **不**写 localStorage、**不**进 zustand store / context

### 7.3 `/setup` 路径 B 的 mint 响应

`pages/Setup/SetupPage.tsx`（mint 表单 production embed 路径）：

1. 用户输入 setup-code → 提交 → `POST /bootstrap/mint` → 拿到响应 `{ secret }`
2. `setStoredToken(resp.secret)` → 跳 `/overview`
3. **不**单独显示 secret 给用户（mint 拿到的是 root token，自动入 localStorage 就够；用户后续在 `Tokens` 页可见 prefix）

这是路径 B 与路径 A（手输入框）的不同：路径 A 用户自己粘 token，dashboard 不再显示；路径 B mint 之后**直接静默**入 localStorage，避免 secret 再多一次屏幕暴露。

---

## 8. 日志 / error / toast 脱敏（redactor）

### 8.1 Redactor 规则

`src/lib/redact.ts`：

```ts
const PATTERNS: RegExp[] = [
  /Authorization:\s*Bearer\s+mwt_[A-Z0-9]+/gi,   // 完整 header
  /\bmwt_[A-Z0-9]{30,}\b/g,                       // 裸 token（39+ chars 后接前缀）
  /\bmws_[A-Z0-9]{30,}\b/g,                       // setup-code
];

export function redact(s: string): string {
  let out = s;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => {
      // 保留 prefix 让人类识别 token 类型，其余 redacted
      if (/^mwt_/.test(m)) return 'mwt_<redacted>';
      if (/^mws_/.test(m)) return 'mws_<redacted>';
      if (/^Authorization/i.test(m)) return 'Authorization: Bearer mwt_<redacted>';
      return '<redacted>';
    });
  }
  return out;
}
```

### 8.2 强制走 redactor 的路径

任何文本最终落到以下出口前**必须**过 `redact()`：

- `console.error` / `console.warn` / `console.log`（dashboard 全部三方 console 调用走 wrapper）
- React `ErrorBoundary` 的 `componentDidCatch` 日志
- Toast / Snackbar 显示文本
- `apiFetch` / `apiStream` 抛出的 `ApiError.problem.detail` / `.title` / `.instance`（[`06`](06-dashboard-mvvm-and-basalt.md) §8.1 ApiError）
- 任何送到 telemetry / 远程监控的字符串（v1 不接，但兜底）

实现：

- `src/lib/logger.ts` 暴露 `info` / `warn` / `error` 函数，内部对每个 string arg 跑 `redact`，再调原生 `console.*`
- 全 dashboard 源码**只**用 `logger.*`，**不**直接调 `console.*`（G1 grep 规则把守：`rg 'console\.(error|warn|log)\(' apps/dashboard/src/` 应只命中 `src/lib/logger.ts` 内部）

### 8.3 reflect 测试

L1 在 `src/lib/redact.test.ts` 跑：

- 喂任意 token / setup-code / Authorization header 的字符串组合 → 输出**只**含 prefix 或 `<redacted>`
- 跑 fuzz：随机生成含 token 模式的字符串 100 次，每次输出过 regex 反查不含 `[A-Z0-9]{30,}` 残留（除前缀）
- 跑 problem+json 模板（mock API error）→ redactor 包裹后送 toast，断言 toast 文本只含 prefix

---

## 9. 第三方依赖审查

### 9.1 osv-scanner（G2）

`apps/dashboard/osv-scanner.toml`：

```toml
# 全量扫描；首版不允许任何 critical/high vulnerability
# medium/low 见 G2 阈值（详 → 08）
```

CI 在 pre-push / GitHub Actions 跑 `osv-scanner --lockfile pnpm-lock.yaml apps/dashboard/`；找到 critical/high → G2 红。

### 9.2 gitleaks（G1 / secret-scan）

`gitleaks protect --staged` 在 pre-commit hook（[`08`](08-6dq-hooks-wiring.md)）；catches commit-time secret leak（包括 `mwt_...` / `mws_...` token 字面值被误 commit）。

定位为 **G1 / secret-scan** 层（不与 osv-scanner / 软件供应链漏洞混淆）。

### 9.3 runtime eval 包审查

dashboard **不**引入会动态求值用户输入的库：

- 禁 `lodash.template`、`handlebars` 等含 `new Function` 的模板引擎
- 禁 `vm-browserify`
- 任何新增 dep 提 PR 时由 reviewer（你）核对其是否 ship 含 `eval` 的代码（grep `node_modules/<dep>/dist/`）

---

## 10. 与 04 的边界（明确不重复定义）

[`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md) §6.6 已经定义了 `/bootstrap/mint` 端点自身的浏览器来源门（`Origin` + `Sec-Fetch-Site`），用于防 drive-by lockout。这是 **bootstrap endpoint 层** 的防御。

本文档（07）管的是 **dashboard 客户端层** 的 XSS / CSP / secret UX / 日志脱敏。

两者**不互相重复定义**：

- 07 **不**重新规定 `Sec-Fetch-Site` / `Origin` 检查（那是 04 endpoint handler 的事）
- 04 **不**规定 dashboard `dangerouslySetInnerHTML` / CSP / sanitizer（那是 07 客户端的事）
- 两者**唯一交叉**：07 §4.2 `connect-src 'self'` + [`02`](02-daemon-http-protocol.md) §2.4 production zero-CORS 共同保证 dashboard 只与 daemon 通信；04 source gate 与此独立

---

## 11. 测试落点（与 6DQ 的映射）

> 详 → 08；本节列每条约束属于哪一层 + 期望覆盖。

| 层 | 覆盖什么 |
|----|---------|
| **G1 / static** | (a) Biome `noDangerouslySetInnerHtml=error` 跑通；(b) `rg` 兜底脚本（远程脚本 / `eval` / `new Function` / `dangerouslySetInnerHTML` 各一次断言）；(c) `console.*` 直接调用只允许出现在 `src/lib/logger.ts` 内部 |
| **G1 / secret-scan** | `gitleaks protect --staged` 在 pre-commit；fixture 加一段含 `mwt_` 字面量的文件，断言 commit 被拒 |
| **G2 / supply-chain** | `osv-scanner` 在 pre-push / CI；首版 critical/high 0；medium/low 按 [`08`](08-6dq-hooks-wiring.md) 阈值 |
| **Build check / dist scan** | `scripts/check-dashboard-dist.sh` 在 build 后跑；fixture：故意注入 `eval(` 到 mock chunk，断言 CI 红；正常 build 通过 |
| **L1 / unit** | (a) `ansiToReactNodes` 单测：normal text / CSI 颜色 / CSI bold / 非 CSI ANSI 丢弃 / 不可解析序列；(b) `SecretReveal` 行为：默认 masked / reveal 翻转 / copy 调 `navigator.clipboard.writeText` mock / 失焦 mask / unmount 后 DOM 不含 secret 字面值；(c) Tokens viewmodel test：模拟 modal close → 断言 `createdSecret === null` + 重新渲染后 DOM textContent 不含 secret；(d) `redact` 反射测试 + fuzz 100；(e) `logger.error` 自动 redact；(f) 任何含 `<script>` 字符串通过 `MessageText` 渲染后 DOM 中不存在 `script` 元素，只有 React 转义文本 |
| **L3 / playwright** | (a) production embed 响应 header 含 §4.2 全部 CSP 指令（断言每条 token 出现）+ nosniff（**所有路径**：HTML / assets / `/v1/agents` / `/healthz` 都断言）+ Referrer-Policy / COOP / CORP / Permissions-Policy（仅 HTML response）；(b) `Sessions` 详情页：mock daemon 发 envelope `payload.content = "<script>alert(1)</script>...ANSI..."` → dashboard 渲染为转义文本 + 不弹 alert；(c) Tokens 页 happy path：创建后 SecretReveal 默认 masked → 点 Reveal 后 page DOM 含 plaintext → 关闭 Dialog → 断言 page DOM、localStorage、toast 面板**均不含** secret 字面值（不依赖 React internal state；只看用户视角可观察的 DOM / storage / 屏幕文本） |

---

## 12. 原子化提交计划（对应 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.10 / 3.15 / 3.16 / 3.24）

| Commit | Phase | 内容 |
|--------|-------|------|
| `feat(daemon): security headers middleware (CSP + nosniff + Referrer-Policy ...)` | 3.10 | §4 daemon 端 header 注入；L2 断言每条 header 出现；fixture：mock SPA fallback 路径返回 `index.html` + 全套 header |
| `chore(dashboard): biome rule noDangerouslySetInnerHtml=error + osv-scanner baseline + gitleaks` | 3.15 | §5 Biome 规则、§5.2 rg 兜底脚本、§9.1 osv-scanner、§9.2 gitleaks 配置 |
| `feat(dashboard): safe message renderer + logger redaction` | 3.16 | §3.1 `lib/ansi.ts` + `MessageText` 组件 + §8 redact + logger；L1 全覆盖。v1 **不**包含 DOMPurify / SanitizedHtml wrapper（§3.2 例外不在 v1 触发） |
| `feat(dashboard): SecretReveal component + token modal flow` | 3.16+ | §7.1 `SecretReveal` + §7.2 Tokens 页流程；L1 |
| `chore(ci): dashboard dist scan script` | 3.15 / CI | §6.1 `scripts/check-dashboard-dist.sh`；G1 |
| `test(e2e): security headers + XSS sanitization assertions` | 3.24 | §11 L3 项 a/b/c |

每个 commit 自带必要测试 + G1/G2 hook 全绿 + 不留 TODO。

---

## 13. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | `style-src 'self'`（不含 `'unsafe-inline'`）能否在 L3 全过？若 Radix 实际注入 inline `style=""` 触发违反，是否最小放开为 `'unsafe-inline'`，或换用 nonce/hash | 实施 Phase 3.10 SDE 跑 L3 后决策 | 待 Phase 3.10 |
| 2 | 是否在 v1 引入 `Strict-Transport-Security`？v1 daemon 不持 TLS（[`05`](05-remote-access-modes.md) §9 禁止），HSTS 由前置反代（Caddy / Cloudflare）负责；本文档不强求 | 当用户上反代时由反代配置 | 不在 v1 范围 |
| 3 | dist scan 是否覆盖 source map (`*.map`)？v1 build 默认开 sourcemap；攻击者可读取源码结构但不能直接执行；倾向**不**禁 sourcemap，但 dist scan 不解析 `.map` | 实施 Phase 3.15 时 SDE 复核 | 待 Phase 3.15 |
| 4 | `SecretReveal` 失焦自动 mask 是 §7.1 #4 的可选项；v1 是否实现？倾向**实现**（用 `visibilitychange`），增强偷窥防护 | 实施 Phase 3.16+ 时 SDE 复核 | 待 |
| 5 | 02 §12 middleware chain 需要勘误：分离出全局 `nosniff` middleware 与 HTML-only `security_headers` middleware（§4.1 已锁定）。这需要在 Phase 3.10 落地时同步小幅 commit 修改 02 §12，或 Phase 3.10 commit 自身覆盖该 02 勘误 | SDE 实施 Phase 3.10 时决定（02 勘误 vs 同 commit 落入） | 待 Phase 3.10 |

---

## 14. 相关文档

- 上层：[`docs/01-project-overview.md`](../01-project-overview.md) §7.9 / §9.2
- 兄弟文档：
  - [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)（middleware chain 在哪挂 security headers；problem+json wire）
  - [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md)（token wire 模型 `TokenView` 无 secret 字段）
  - [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md)（drive-by lockout / Origin gate；与本文档分工，不重复定义）
  - [`05-remote-access-modes.md`](05-remote-access-modes.md)（daemon 不持 TLS，HSTS 由反代）
  - [`06-dashboard-mvvm-and-basalt.md`](06-dashboard-mvvm-and-basalt.md)（dashboard 目录、Setup 决策树、`SecretReveal` 出现位置）
  - `08-6dq-hooks-wiring.md`（G1/G2/D/L1/L3 工具链与 CI matrix）
- 工作约束：[`../../CLAUDE.md`](../../CLAUDE.md)
