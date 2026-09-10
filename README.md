# CoolCare / AC Care 整合网站

整合版位于 `coolcare/`，原来的项目和 `accare/` 保留为来源备份。网站界面全英文，主页使用上传的 AC Care 设计，客户、技师、库存页面保留各自原设计。

## 启动

需要 Node.js 22.13+ 和 Docker Desktop（Linux containers）。在仓库根目录执行：

```powershell
npm run setup
npm run db:up
npm start
```

打开 http://localhost:3000/ 。以后可在 Docker Desktop 运行后双击 `启动整合网站.cmd`。`npm run db:down` 仅停止数据库，保留数据卷。

## 页面与账号

| 页面 | 地址 |
| --- | --- |
| AC Care 主页 | `/` |
| 登录 / 注册 | `/#/login` / `/#/register` |
| 主页预约管理（取消、改期） | `/#/bookings` |
| 客户 Dashboard / 预约 / 历史 | `/customer` |
| 技师工单 | `/technician/index.html` |
| 库存后台 | `/admin/inventory` |

已有测试账号共用密码 `CoolCareDemo2026!`：

- 客户：`alice.tan@coolcare.demo`
- 技师：`chris.lim@coolcare.demo`
- 管理员：`norshida@coolcare.demo`

主页登录后按账号角色进入对应区域；客户可通过页头 Dashboard 进入原客户中心。也支持注册新客户。旧 SQLite 导入账号保留原有 bcrypt 密码，不覆盖同邮箱现有账号。

## 数据整合

所有运行模块使用同一个 MySQL `coolcare_service_app`，地址为本机 `3307`。不再启动 accare 的独立 SQLite 后端。

- 登录使用服务端 HttpOnly 会话、bcrypt 校验、CSRF 和登录频率限制，不保存浏览器模拟账号或密码。
- 客户与技师身份来自登录会话，每个账号只能读取自己的预约或工单。管理员库存权限独立校验。
- 主页和原客户页面共用 booking、service_address、aircon_unit 等业务表，预约状态与资料可交叉读取。
- 主页支持预约提交、查询、取消和改期。只有尚未分配的 Submitted 预约可自助修改；已安排工单的预约需联系服务团队。
- 预约写入、设备关联、备注、状态历史采用事务；重复请求 ID 防止重复预约。
- `database/05-public-site.sql` 增加注册附加资料、预约补充资料、旧数据映射表。`npm run db:up` 自动执行非破坏性迁移与权限更新。
- 上传 SQLite 的 4 个账号、3 条预约已在本机导入。原文件不变。旧库没有价格，因此导入预约的金额保留为未知，不编造历史价格。

其他电脑如需导入上传的历史记录，启动数据库后执行：

```powershell
cd coolcare
node scripts/import-accare.mjs
```

导入通过来源映射去重，可重复运行；不会重复创建同一条历史预约。

## 范围说明

原页面的 Google / Apple 登录及邮件找回密码没有配置外部提供商，界面会明确提示不可用，不模拟成功。首页促销入口会保留用户的优惠请求，报价按现有服务计算，优惠资格由服务团队确认。

本次整合现有页面，未新增后台派单页面或技师状态编辑页面。客户预约仍需有有效 assignment 与 work_order 后才进入技师工单列表。服务端会话目前存放内存，重启后需要重新登录。

## 验证

```powershell
npm test
npm --prefix coolcare run test:db
cd coolcare
node node_modules/typescript/bin/tsc --noEmit
cd ..
npm run build
```

17 项自动化测试通过，覆盖注册登录、会话、角色隔离、预约创建与去重、两套客户页面的数据一致性、取消与改期、库存事务及原有筛选。TypeScript 检查和生产构建通过。测试写入采用事务回滚，自增编号可能出现空号。浏览器已验证首页、登录、FAQ、预约提交、预约列表与改期；修复了首页主题样式加载及原生取消确认弹窗问题。尚未完成全部页面逐项点击回归。

## GitHub

`.gitignore` 排除本机凭据、依赖、生成文件和 IDE 缓存。原先三个 ZIP 已用解压后的源代码目录替代。`accare.zip` 保留为上传的原始设计来源。同步更新使用 `git pull --ff-only origin main`，首次运行按上方安装步骤准备本机环境。

公开部署前需要配置持久化会话、HTTPS、邮件及可选 OAuth 服务；当前服务只面向本机运行。
