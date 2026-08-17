# 12348 智能法律辅助平台

面向 12348 法律咨询坐席的网页工作台。当前已接入短信登录、法律 AI、法条与类案工具、连续咨询记录、逐问题业务类型统计、团队权限和提示词版本管理。

## 目录约定

```text
app/                 运行中的网页路由、页面与页面样式
app/styles/          当前应用使用的样式模块与设计令牌
features/            认证、用户、审计、品牌、咨询等业务边界
db/                  MySQL schema 与不可修改历史的迁移文件
lib/                 服务端通用能力，例如数据库连接
scripts/             仅开发环境使用的初始化脚本
docs/                架构、数据模型和改动流程
demos/client-preview/给客户评审的独立 HTML 演示，不连接服务端
tests/               项目结构及未来业务测试
public/              仅运行时需要公开访问的静态资源
tooling/             构建工具源码，不是构建产物
worker/              Cloudflare 部署时的请求入口
```

## 根目录中看起来“杂”的文件

- `package.json` / `package-lock.json`：项目命令与依赖的精确版本清单。
- `node_modules/`：根据依赖清单自动下载的运行材料；不属于业务代码、不会提交、可随时由 `npm install` 重建。
- `*.config.ts` / `*.config.mjs`：TypeScript、样式、代码检查、数据库迁移及本地运行的工具配置，必须放在根目录以便工具识别。
- `.env.local`：仅本机所需的数据库及第三方接口地址/密钥，已忽略，不会提交；程序行为参数写在代码中。
- `.openai/`：当前托管环境配置。
- `public/`：仅放浏览器需要直接访问的资源；当前只有站点图标。
- `worker/`：部署到 Cloudflare 时的服务端请求入口；它不是前端页面。

## 常用命令

```bash
npm run dev             # 本地运行
npm run api:start       # 启动本地 API
npm run build           # 生产构建检查
npm test                # 构建与项目结构检查
npm run db:generate     # 根据 schema 生成 MySQL 迁移
npm run db:migrate      # 应用 MySQL 迁移
npm run db:seed:local   # 初始化本地测试账号
```

## 客户品牌

客户名称、Logo、登录问候语、咨询问候语和助手名称位于
`features/brand/client-brand.ts`。现阶段为本地默认配置；上线时应由客户独立入口或部署配置加载。

## 演示文件

将 `demos/client-preview/index.html` 单独发送给客户或同事即可直接浏览。它不访问 MySQL、AI 或短信服务。
