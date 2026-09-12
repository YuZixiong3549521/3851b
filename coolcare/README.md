# CoolCare 本机整合版

从仓库根目录运行 `npm run setup`、`npm run db:up`、`npm start`。

首次运行可在启动前执行 `npm run db:sample`，生成相互关联的合成预约、报告和库存记录。已有数据必须先备份并明确使用 `--replace`；详见 [SAMPLE-DATA.md](SAMPLE-DATA.md)。日常迁移不会覆盖业务数据。

完整启动方式、模块说明、测试和 GitHub 注意事项见 [仓库说明](../README.md)。

- 首页：http://localhost:3000/
- 客户端：http://localhost:3000/customer
- 技师端：http://localhost:3000/technician/index.html
- 库存后台：http://localhost:3000/admin/inventory

本目录为整合后的主应用；`technician/` 在构建时输出静态页面到 `public/technician/`。
客户 API 和库存 API 共用 `server/app.mjs` 及同一 MySQL 连接池。
数据库环境文件由 setup 自动生成，已加入 Git 忽略。

启动和构建不依赖仓库外或旧上传项目中的文件。数据库结构、迁移、种子数据、共享 UI 和技师源码均保存在本目录。

`scripts/import-accare.mjs` 仅用于可选的旧 SQLite 资料迁移；必须显式提供本机源文件路径，不随 GitHub 分发旧数据库。查看用法：`node scripts/import-accare.mjs --help`。
