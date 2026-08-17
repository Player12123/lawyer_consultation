# 审计事件清单

审计表只记录“谁在何时对什么对象做了什么”，不保存验证码、密钥或咨询全文。手机号只保存不可逆哈希。

## 身份与会话

- `auth.sms.sent`：登录验证码已由供应商接受发送。
- `auth.login.succeeded`：短信验证成功并建立新会话。
- `auth.login.failed`：验证码错误、过期或超过尝试次数。
- `auth.login.blocked`：凭据正确但账号已被管理员禁用。
- `auth.logout`：用户主动退出并撤销当前会话。

## 手机号换绑

- `account.phone_change.old_code_sent`：原手机号验证码已发送。
- `account.phone_change.new_code_sent`：新手机号验证码已发送。
- `account.phone_change.old_verified`：原手机号验证通过。
- `account.phone_change.completed`：新手机号验证通过、绑定已更新并撤销旧会话。

## 分组、成员与权限

- `team.group.created`：系统管理员新建成员组。
- `team.member.created`：系统管理员预录入用户。
- `team.member.assignment.updated`：系统管理员修改普通用户/组长角色或分组；记录变更前后值。
- `team.member.active`：管理员启用账号。
- `team.member.disabled`：管理员禁用账号并撤销其会话。
- `team.member.deleted`：系统管理员逻辑删除账号。

## 咨询与智能体

- `consultation.answer.generated`：咨询成功完成；只记录咨询记录 ID、业务类型和提示词版本，不记录正文。
- `consultation.context.cleared`：用户结束当前 AI 上下文；历史咨询不删除。
- `prompt.legal_consultation.published`：系统管理员发布新提示词；记录版本号和内容哈希，不在审计元数据重复保存全文。

## 与技术错误日志的区别

审计事件用于追责和权限复核；`service_error_logs` 用于产品运维排障，保留 200 天且不进入客户后台。AI、短信、法条、类案或数据库故障写入技术错误日志，不伪装成用户操作审计。
