# 生产交付与运维手册

本手册面向接手部署和日常运维的技术人员。公网部署前必须完成本手册的“上线门槛”和验收项；开发电脑和局域网测试不属于生产环境。

## 1. 运行拓扑

```text
Internet -> WAF/CDN -> Nginx (80/443) -> Web (127.0.0.1:3000)
                                      -> API (127.0.0.1:8788) -> MySQL private network
                                                                    -> SMS / AI / legal tools
```

只有 80、443 可由公网访问。MySQL、3000 和 8788 只能由本机或私有网络访问。

临时需求验收可以使用 Cloudflare Quick Tunnel，但只能把本机 Web 暴露出去：

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

隧道地址只用于当次临时验收，用完立即停止 `cloudflared`。不得对 `127.0.0.1:8788`、MySQL 端口或任何数据库连接地址创建 Quick Tunnel、端口转发、安全组放行或公网 DNS 入口；API 8788 和 MySQL 不得公网暴露，必须继续只允许本机或私有网络访问。

## 2. 上线门槛

- Linux LTS 云主机，独立非 root 运行账户 `pocketlegal`，启用自动安全更新。
- 已备案的域名、有效 TLS 证书和 HTTPS 入口。公网 IP 不能替代 HTTPS 域名。
- MySQL 无公网地址，已启用备份；运行账户使用 `deploy/mysql-runtime-grants.sql` 中的最小权限。
- 生产密钥进入云密钥管理服务或仅 root 可读的 `/etc/pocket-legal-assistant/api.env`，权限为 `600`，绝不放入 Git。
- 已确认短信、AI 和法律工具供应商允许处理本项目的数据，且对方凭据可轮换。

## 3. API 环境变量

生产 API 需要以下变量。值由部署人员填写；`REPLACE_` 或空值不可上线。

```dotenv
APP_ENV=production
APP_ORIGIN=https://YOUR_DOMAIN
COOKIE_SECURE=true
DATABASE_URL=mysql://pocketlegal_app:REPLACE_PASSWORD@MYSQL_PRIVATE_HOST:3306/pocket_legal_assistant
TENANT_ID=REPLACE_26_CHARACTER_TENANT_ID
SESSION_TOKEN_PEPPER=REPLACE_32_BYTE_OR_LONGER_RANDOM_VALUE
PHONE_HASH_PEPPER=REPLACE_32_BYTE_OR_LONGER_RANDOM_VALUE
VERIFICATION_CODE_PEPPER=REPLACE_32_BYTE_OR_LONGER_RANDOM_VALUE
CONSULTATION_CONTENT_KEY=REPLACE_32_BYTE_OR_LONGER_RANDOM_VALUE
SMS_BESTONE_ENDPOINT=REPLACE_HTTPS_OR_PRIVATE_ENDPOINT
SMS_BESTONE_APP_ID=REPLACE_ME
SMS_BESTONE_PASSWORD=REPLACE_ME
AI_BASE_URL=REPLACE_ME
AI_API_KEY=REPLACE_ME
AI_MODEL=REPLACE_ME
LEGAL_TOOLS_X_APP_ID=REPLACE_ME
LEGAL_TOOLS_X_APP_SECRET=REPLACE_ME
LAW_SEARCH_ENDPOINT=REPLACE_ME
CASE_SEARCH_ENDPOINT=REPLACE_ME
```

需求方自行短信登录产生或激活的账号一律为普通用户 `agent`。`system_admin` 只能由系统管理员在后台明确创建或设置；不得通过环境变量、手机号匹配、公开注册或临时验收登录自动产生系统管理员。

`CONSULTATION_CONTENT_KEY` 不可丢失或随意更换，否则历史咨询正文无法解密。轮换必须先实施双密钥迁移方案。

## 4. 发布顺序

1. 备份数据库，验证备份可恢复到隔离环境。
2. 以迁移账户在应用目录执行 `ENV_FILE=/etc/pocket-legal-assistant/api.env npm run db:migrate`。
3. 以运行账户安装锁定依赖：`npm ci --omit=dev`；构建前端：`npm run build`。
4. 安装 `deploy/systemd` 下两个 service，执行 `systemctl daemon-reload`，再启动 API 与 Web。
5. 安装 Nginx 配置。把 `deploy/nginx/http-rate-limit.conf` 引入 `http {}`，把站点配置中的域名和证书路径替换为真实值，执行 `nginx -t` 后 reload。
6. 访问 `https://YOUR_DOMAIN/api/readyz` 必须返回 200，再按验收清单完成业务测试。

任何一步失败，停止发布并按 [发布回滚操作手册](rollback-runbook.md) 回滚到上一个应用版本；数据库迁移必须在发布前审查，不能直接手工修改线上表结构。

## 5. 日常运维

- 健康检查：`/healthz` 仅表示 API 进程存活；`/readyz` 同时验证 MySQL 连通性，应作为负载均衡就绪探针。
- 查看日志：`journalctl -u pocket-legal-api -u pocket-legal-web -f`；日志中不得记录验证码、Cookie、完整手机号、授权头或咨询原文。
- 不得把 `.env.local` 或生产环境变量中的短信、AI、数据库、Cookie、Pepper、加密密钥真实值写入输出、Git、文档或日志。
- 每日检查：就绪探针、磁盘空间、备份状态、短信失败率、AI/法律工具错误日志。
- 每月至少一次：恢复演练、依赖漏洞扫描、系统补丁、密钥轮换计划审查、管理员账号审查。
- 依赖审计：发布前和每月至少一次执行 `npm run security:audit`，把结果填写到 [依赖漏洞审计记录](security-audit-record.md)。网络故障必须记录为“未完成”，不能视为通过。
- 日志检查：CI 或发布前执行 `npm run security:log-safety`，阻止把验证码、完整手机号、咨询正文、授权头或密钥直接输出到标准日志。
- 数据清理：API 每日清理过期验证码、已撤销/过期会话、200 天技术日志；到期咨询正文替换为不可还原的占位内容，同时保留统计字段。

## 6. 事故处置

1. 发现密钥泄露：立即在供应商处吊销并换新，更新密钥服务，重启 API；必要时轮换会话 Pepper 使全部用户重新登录。
2. 发现异常登录或管理员误操作：立即禁用账号，检查审计事件，撤销相关会话。
3. 短信或 AI 供应商故障：保留脱敏错误日志与时间范围，向供应商提交请求 ID/时间，不要提交用户咨询正文。
4. 数据库故障：停止写入、切换或恢复数据库后确认 `/readyz` 和核心验收项，禁止绕过迁移直接恢复服务。

## 7. 上线验收

- 短信发送、验证码登录、自动普通用户注册、禁用账号拦截和退出登录。
- 系统管理员、组长、普通用户三种角色的越权访问均返回 403。
- 咨询、记录恢复、清空上下文、法条/类案补充和管理统计。
- 验证码重放、错误验证码 5 次、同手机号 60 秒频率限制、1 小时 5 次限制。
- HTTPS、HTTP 跳转、Cookie 含 `HttpOnly; Secure; SameSite=Strict`，以及 API/数据库端口无公网暴露。
- `/healthz`、`/readyz`、API 重启、Web 重启、数据库备份恢复。
