<p align="center"><img src="logo.png" width="128" height="128" alt="Meowth logo" /></p>

<h1 align="center">Meowth</h1>

<p align="center">
  <strong>macOS 本机 coding-agent 桥接层</strong><br>
  统一 SDK · HTTP 控制面 · 本机 dashboard · 远程可调度
</p>

<p align="center">
  <a href="https://github.com/nocoo/meowth/releases"><img alt="release" src="https://img.shields.io/github/v/release/nocoo/meowth?label=release&color=blue" /></a>
  <a href="https://github.com/nocoo/meowth/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/nocoo/meowth/ci.yml?branch=main&label=CI" /></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-darwin--arm64%20%7C%20darwin--amd64-lightgrey" />
  <img alt="go" src="https://img.shields.io/badge/Go-1.26.4-00ADD8?logo=go" />
  <img alt="node" src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js" />
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green" /></a>
</p>

---

Meowth 把本机已安装的 5 家 coding CLI（claude / codex / copilot / hermes / pi）包装成统一的 HTTP 服务,配套一个 go:embed 的 web dashboard 在本机管理一切。本机用、Tailscale 暴露给远端、Caddy 反代都行。

## 快速上手

```bash
pnpm install && pnpm daemon:build   # 1. 装依赖 + 编 meowthd 二进制
./daemon/meowthd init               # 2. 拿 root token（mwt_... 只显示一次,立即保存）
./daemon/meowthd serve              # 3. 起 daemon,默认 127.0.0.1:7040
open http://127.0.0.1:7040          # 4. 浏览器打开,粘 token,开始用
```

## 文档

| 入口 | 内容 |
|---|---|
| [`docs/01-project-overview.md`](docs/01-project-overview.md) | 项目定位 / 架构 / Phase 计划（先读这篇） |
| [`docs/architecture/`](docs/architecture/README.md) | 8 篇系统架构:SDK / HTTP / SQLite / mint / 远程 / dashboard / 安全 / 6DQ |
| [`docs/features/`](docs/features/README.md) | 功能迭代（如端口迁移到 Hexly Caddy） |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本历史 |

## License

本仓库**根 license 是 [MIT](LICENSE)**,适用于所有原创代码（daemon `cmd/` + `internal/` + dashboard + scripts + docs）。

子目录 [`daemon/pkg/agent/`](daemon/pkg/agent/) 是从 [multica](https://github.com/multica-ai/multica) `server/pkg/agent/` vendored 的,按 Apache 2.0 §4 要求**保留上游 Modified Apache 2.0 license** —— 详见 [`daemon/pkg/agent/LICENSE`](daemon/pkg/agent/LICENSE) 与 [`daemon/pkg/agent/UPSTREAM.md`](daemon/pkg/agent/UPSTREAM.md)。multica 的两条额外限制（反 SaaS / 保留 logo）对本项目**不适用**:这是个人本机工具,且 dashboard 完全自写、未引入 multica 的 `apps/web/`。
