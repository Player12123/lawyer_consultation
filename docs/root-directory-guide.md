# 根目录说明

根目录只保留“项目启动、构建和部署必须识别”的文件；业务实现不应继续堆在这里。

| 项目 | 是否业务代码 | 是否应手动修改 |
|---|---:|---:|
| `app`、`features`、`db`、`lib` | 是 | 是 |
| `docs`、`scripts`、`tests` | 是 | 是 |
| `package.json` | 否，项目清单 | 仅新增依赖或命令时 |
| `package-lock.json` | 否，依赖锁定结果 | 由 npm 自动更新 |
| `node_modules` | 否，下载结果 | 不修改；可重建 |
| `vite.config.ts`、`drizzle.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`postcss.config.mjs`、`next.config.ts` | 否，工具配置 | 仅对应技术配置变更时 |
| `public` | 否，公开静态文件 | 只放 favicon、客户 Logo 等公开资源 |
| `.env.local` | 否，本机密钥 | 不提交、不发送 |

`dist`、`.next`、`.vinext` 均为自动生成目录，并已在 `.gitignore` 中忽略。
