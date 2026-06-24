# Docs · Features

功能迭代开发的编号文档目录。每篇文档对应一个**已落地或正在落地**的功能,包含背景、设计、原子化提交计划、6DQ 验证、跳过项。

## 索引

| 编号 | 文档 | 主题 | 状态 |
|------|------|------|------|
| 01 | [`01-port-migration-to-hexly-caddy.md`](./01-port-migration-to-hexly-caddy.md) | 端口迁移到 Hexly Caddy 体系（7040 + 37040 + 17040/17041） | 源码 + 文档 + Caddy 已落地;Caddy HTTPS 手工实测待跟进 |

## 何时新建 features 文档

- 新增端到端可见的能力（新 API 端点、dashboard 新页、新 backend）
- 跨多个模块的协调改动（端口迁移、协议演进、依赖大版本升级）
- 引入新的运维约束或本机环境依赖

仅是 bug fix / 重构 / 单 commit 小改动**不**需要 features 文档,走原子化 commit 即可。
