# 发布回滚操作手册

本手册只覆盖可逆的应用发布故障。任何数据库恢复都必须经过变更审批、停写和备份验证；**禁止使用一键数据库回滚脚本**，也禁止在线上执行未经验证的 down migration。

## 1. 先判断故障类型

| 情况 | 处理方式 |
| --- | --- |
| 新版 API/Web 代码故障，且本次迁移向后兼容 | 回退到上一应用版本，保留数据库结构与数据。 |
| 新版迁移、数据写入或数据删除有问题 | 立即停止写入，保留现场；按第 3 节由数据库负责人恢复。 |
| 短信、AI、法条或类案供应商故障 | 不回滚数据库；核查供应商状态、密钥和降级日志。 |
| 无法确认故障范围 | 先停止发布和写入，升级给值班负责人，不执行猜测性的回滚。 |

## 2. 应用版本回滚

前提：发布采用版本目录和 `current` 软链接，例如 `/opt/pocket-legal-assistant/releases/20260820-1200` 与 `/opt/pocket-legal-assistant/current`。发布前必须记录当前版本号。

1. 记录时间、现象、当前版本和最近一次数据库迁移；导出 `journalctl -u pocket-legal-api -u pocket-legal-web --since "15 minutes ago"` 到受控工单附件。
2. 确认本次迁移是向后兼容的。不能确认时，停止并按第 3 节处理。
3. 用部署账户执行：

```bash
sudo /opt/pocket-legal-assistant/current/deploy/scripts/rollback.sh 20260820-1200
```

4. 验证：

```bash
curl --fail https://YOUR_DOMAIN/api/readyz
sudo systemctl status pocket-legal-api pocket-legal-web --no-pager
```

5. 完成短信登录、一次咨询和权限检查。全部通过后在变更记录中标记应用已回退。

脚本会在 `/readyz` 失败时自动恢复此前软链接；它不会执行数据库命令，也不会删除发布目录。

## 3. 数据库恢复（人工审批流程）

1. 停止 API 写入：`sudo systemctl stop pocket-legal-api`，并保留 Web 维护页或由 Nginx 暂时返回维护响应。
2. 保存故障现场：当前数据库快照、应用版本、迁移记录和脱敏日志。
3. 在隔离 MySQL 实例先恢复候选备份，核对备份时间点、迁移版本、表行数和抽样业务数据。
4. 数据库负责人书面批准恢复目标、允许的数据丢失窗口和恢复步骤后，才可在生产执行恢复。
5. 恢复完成后，用与该 schema 兼容的应用版本启动 API，确认 `/api/readyz`、短信登录和咨询读写；再解除维护。

不得以“回滚发布”为由覆盖生产库，也不得通过删除 `__drizzle_migrations` 记录伪造迁移状态。
