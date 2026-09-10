# CoolCare Admin Inventory — 本机运行版

React + Node.js / Express + MySQL。根据现有 Stitch 六页设计重建为可用网页；原型中的展示数据已替换为数据库查询。未修改云端 Stitch 项目，也未发布到互联网。

## 现在如何使用

1. 确保 Windows 的 `MySQL84` 服务正在运行。
2. 双击本目录的 `start-local.cmd`（或者在此目录运行 `npm start`）。运行窗口需要保持打开。
3. 打开 <http://localhost:3000/admin/inventory>。
4. 使用已导入的演示管理员登录：
   - 邮箱：`norshida@coolcare.demo`
   - 密码：`CoolCareDemo2026!`

这是网页演示账号，不是 MySQL root 账号。关闭启动窗口会停止网页，但 MySQL 内已保存的数据不会丢失。重启网页后需要重新登录。

## 已实现范围

- Inventory Overview：真实库存金额、零件数、库存数量、低库存提示、最近流水。
- Parts Management：查询、状态/库存筛选、排序、分页、CSV 导出。
- Part Details：真实零件信息及其交易历史。
- Add/Edit Part：新增、修改名称/价格/状态；新增库存固定为零。
- Inventory Transactions：只读流水、零件/类型/日期筛选、分页、CSV 导出、详情抽屉。
- Record Transaction：入库、出库、退回、增加/减少调整；预览、确认、数据验证。
- 管理员登录、取消/返回、未保存提醒、加载/空状态/错误提示。

不包含 Bookings、Customers、Technicians 等其他模块。工单仅从既有数据中选择关联，不提供工单管理页。

## 库存规则

- 库存更新、流水插入、操作辅助信息在同一个 MySQL 事务中执行；失败全部回滚。
- 使用零件行锁和预期库存校验防止并发覆盖；超量出库会被拒绝。
- 同一提交使用固定请求 ID，网络失败时重试不会重复扣库存。
- 库存调整的方向和前后数量记录在新增的 `inventory_web_operation` 表中。原有表结构未改。
- Return 表示未用零件退回库存，数量增加；不是退货给供应商。
- 非 Active 零件需要先启用才能记录库存变动。流水不可编辑、不可删除。
- 低库存暂设为 **15 件及以下（包含 0）**，可以修改 `.env.local` 的 `LOW_STOCK_THRESHOLD` 后重启 API。
- 导入的旧流水没有存储前后库存时显示 `Not recorded`，不编造历史数量。
- 时间按 MySQL 服务器本地时间显示；金额沿用原型的 `$` 符号。

## 本机设置与安全

本机已经完成连接初始化，无须再次导入 `schema.sql` 或 `seed.sql`。

- `.env.local`：本机 MySQL 专用账号和会话密钥。不要发送给别人或提交到 Git。
- `.local/setup-mysql.sql`：包含本机专用密码，同样不要分享。
- 服务只监听本机回环地址；没有开放局域网或公网访问。
- API 校验 Active Admin 权限、会话和 CSRF；使用参数化 SQL；数据库账号没有删库、删表、删除流水的权限。
- 会话保存在本机 Node.js 内存中，重启后失效。这是本地演示/开发方案，不是生产部署方案。
- 不要把演示密码、开发服务器或现有演示数据直接用于公网系统。

换电脑时：安装 Node.js 22.13+ 和 MySQL 8.4，准备对应数据库，执行 `npm ci`、`npm run setup`，然后在已登录的 MySQL 客户端执行命令输出的 `SOURCE ...`。每台电脑单独生成连接密码。不要复制本机密钥。

## 开发与验证

```powershell
npm test
npm run test:db
npx tsc --noEmit
npm run build
```

数据库集成测试使用临时记录和保存点，最终回滚，不改变现有业务记录；MySQL 自增编号可能出现正常的空号。覆盖真实 MySQL 新增/编辑、库存变动、重复请求、负库存拒绝，以及中途失败的原子回滚。HTTP 测试覆盖登录、权限、筛选、导出和非法输入。

`npm run build` 验证前端产物；本机启动统一使用 `npm start`。单独开发可分别运行 `npm run api` 与 `npm run dev`。

可选 WebMCP 提供查询零件、打开交易表单两种工具；保存仍需确认。未对受支持浏览器中的 WebMCP 注册作端到端验证。此次未执行浏览器点击/视觉测试；已执行构建、类型及服务端测试。

主要代码：`components/inventory-*.tsx`（界面）、`lib/inventory-client.tsx`（请求与共享状态）、`server/app.mjs`（接口与登录）、`server/inventory.mjs`（库存事务规则）。`components/ui` 是模板自带组件。

提交给组长时分享源代码及锁文件，排除 `.env.local`、`.local/`、`node_modules/`、`dist/` 和本机日志；演示数据库仍使用原有交接文件。
