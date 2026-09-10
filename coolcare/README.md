# CoolCare 本机整合版

从仓库根目录运行 `npm run setup`、`npm run db:up`、`npm start`。

完整启动方式、模块说明、测试和 GitHub 注意事项见 [仓库说明](../README.md)。

- 首页：http://localhost:3000/
- 客户端：http://localhost:3000/customer
- 技师端：http://localhost:3000/technician/index.html
- 库存后台：http://localhost:3000/admin/inventory

本目录为整合后的主应用；`technician/` 在构建时输出静态页面到 `public/technician/`。
客户 API 和库存 API 共用 `server/app.mjs` 及同一 MySQL 连接池。
数据库环境文件由 setup 自动生成，已加入 Git 忽略。

`setup:legacy` 仅保留原库存项目的历史设置脚本；整合版使用 `npm run setup`。
