# 12348 智能法律辅助平台

面向 12348 法律咨询坐席的网页工作台。当前已接入短信登录、法律 AI、法条与类案工具、连续咨询记录、逐问题业务类型统计、团队权限和提示词版本管理。

## 目录约定

```text
app/                 运行中的网页路由、页面与页面样式
app/styles/          当前应用使用的样式模块与设计令牌
features/            认证、用户、审计、品牌、咨询等业务边界
db/                  MySQL schema 与不可修改历史的迁移文件
lib/                 服务端通用能力，例如数据库连接
scripts/             仅开发、验收和安全检查使用的脚本
docs/                部署、运维、安全、数据模型和交付说明
tests/               构建、交付契约和核心业务保护测试
public/              仅运行时需要公开访问的静态资源
```

## 根目录中看起来“杂”的文件

- `package.json` / `package-lock.json`：项目命令与依赖的精确版本清单。
- `node_modules/`：根据依赖清单自动下载的运行材料；不属于业务代码、不会提交、可随时由 `npm install` 重建。
- `*.config.ts` / `*.config.mjs`：TypeScript、样式、代码检查、数据库迁移及本地运行的工具配置，必须放在根目录以便工具识别。
- `.env.local`：仅本机所需的数据库及第三方接口地址/密钥，已忽略，不会提交；生产用 `.env.example` 填写。
- `public/`：仅放浏览器需要直接访问的公开静态资源。

## 常用命令

```bash
npm run dev             # 本地运行
npm run api:start       # 启动本地 API
npm run build           # 生产构建检查
npm test                # 构建与项目结构检查
npm run db:generate     # 根据 schema 生成 MySQL 迁移
npm run db:migrate      # 应用 MySQL 迁移
npm run db:seed:local   # 初始化本地测试账号
npm run test:smoke      # 对已启动的本机/部署环境执行无副作用冒烟测试
```

生产交付、运维和验收请先阅读 `docs/production-handover.md`；本机验收结果见 `docs/local-acceptance-report.md`。公司部署采用普通 Web 模式：Nginx 反向代理 Web 服务和 API 服务，不依赖第三方托管平台。

## 客户品牌

客户名称、Logo、登录问候语、咨询问候语和助手名称位于
`features/brand/client-brand.ts`。现阶段为本地默认配置；上线时应由客户独立入口或部署配置加载。
