# 生产 API 部署说明

完整的部署、密钥、Nginx、systemd、数据库权限、运维和验收流程见 [生产交付与运维手册](./production-handover.md)。

## API 不变约束

- API 仅监听 `127.0.0.1:8788`；不得在安全组、防火墙或端口转发中直接开放 8788。
- 临时需求验收使用 Quick Tunnel 时，只允许执行 `cloudflared tunnel --url http://127.0.0.1:3000` 暴露本机 Web；API 8788 不得通过 Quick Tunnel、端口转发或公网代理暴露。
- 浏览器只能经同一 HTTPS 域名的 `/api/*` 访问 API。`APP_ORIGIN` 必须精确等于该 HTTPS 地址。
- `APP_ENV=production` 时，程序要求 HTTPS、`COOKIE_SECURE=true` 和有效的 `CONSULTATION_CONTENT_KEY`，任何一项缺失都会拒绝启动。
- `GET /healthz` 表示进程存活；`GET /readyz` 同时验证 MySQL 连通性。
- 生产应用使用独立 MySQL 运行账户；执行迁移使用单独、临时授予 DDL 权限的发布账户。

部署模板在 `deploy/`：Nginx、systemd 与 MySQL 最小权限脚本均须按实际环境替换占位符后使用。
