# AirCon Maintenance Technician Portal

这是按两张高保真截图制作的 React + Vite 前端。已完成 Dashboard、My Jobs、共享侧栏/页头/卡片/徽章/表格、搜索、组合筛选、分页、右侧工单详情和窄屏布局。

## Windows 上怎么运行

你当前电脑已检测到 Node.js v24.17.0 和 npm 11.13.0。如果换电脑，请从 https://nodejs.org/ 安装 Node.js，使用 22.12 或更高版本，再重新打开 VS Code。Vite 环境说明：https://vite.dev/guide/ 。

1. 在 VS Code 里选 **File → Open Folder**，打开本文件所在的 `aircon-technician-portal` 文件夹。要能在左侧直接看到 `package.json` 和 `src`。
2. 选 **Terminal → New Terminal**。
3. 第一次运行输入 `npm.cmd install`，等待完成。以后一般不需要重复安装。
4. 输入 `npm.cmd run dev`。
5. 打开终端显示的 Local 地址，默认是 http://127.0.0.1:5173 。如果端口已占用，以终端实际显示的地址为准。
6. 点击左侧 Dashboard / My Jobs 切换。修改文件并保存，浏览器自动更新。停止服务按 **Ctrl+C**。

也可以直接在 PowerShell 执行：

```powershell
cd "C:\Users\Vivian\Documents\Codex\2026-09-05\referenced-chatgpt-conversation-this-is-an\outputs\aircon-technician-portal"
npm.cmd install
npm.cmd run dev
```

不需要再执行 `npm create vite`，项目已经创建好了。不要双击 `index.html` 运行。这里用 `npm.cmd`，可避免 PowerShell 的 `npm.ps1` 执行策略问题。

## 每个文件放哪里

所有文件都已放好，不需要逐个新建或复制。把整个文件夹移动到别处也可以；移动后在新的文件夹里打开终端。

```text
aircon-technician-portal/
├─ package.json                 依赖及启动/构建命令
├─ package-lock.json            安装后生成的依赖版本锁
├─ index.html                   网页入口
├─ vite.config.js               React 插件、后端开发代理
├─ .env.example                 环境变量示例
├─ .gitignore                   忽略依赖目录、构建产物和本地环境配置
├─ README.md                    本说明
└─ src/
   ├─ main.jsx                  React 挂载入口
   ├─ App.jsx                   页面切换、数据加载、错误重试、详情状态
   ├─ styles.css                颜色、尺寸、布局和响应式样式
   ├─ components/
   │  ├─ Sidebar.jsx            深色侧栏
   │  ├─ Header.jsx             标题和日期
   │  ├─ StatCard.jsx           统计卡片
   │  ├─ Badges.jsx             StatusBadge / PriorityBadge
   │  ├─ JobTable.jsx           两个页面共用的工单表格
   │  └─ JobDrawer.jsx          工单详情抽屉，支持 Escape、键盘焦点限制
   ├─ pages/
   │  ├─ TechnicianDashboard.jsx 今日安排、进度、下个预约、服务类型
   │  └─ MyJobs.jsx             标签、搜索、筛选和每页 8 条分页
   ├─ data/
   │  └─ mockJobs.js            14 条模拟工单、演示日期、技师资料
   ├─ services/
   │  └─ jobService.js          模拟数据/API 切换入口
   └─ utils/
      ├─ jobs.js               日期时间格式、统计、筛选规则
      └─ jobs.test.js          数据统计和组合筛选测试
```

## 演示数据规则

- 默认使用模拟数据，无需启动 MySQL 或后端；演示日期固定为 **2026-09-01**，使 Today 标签始终有数据。
- 统计来自同一份数据：14 个工单、今日 4 个、未来 5 个、完成 5 个、进行中 1 个、待处理 1 个。两张参考图里的统计和状态不完全一致，因此没有硬编码互相矛盾的数字。
- Dashboard 的 Completed Jobs 显示全部完成工单，没有用预约日期冒充完成日期来统计“本周完成”。未来若需要此指标，后端应提供 `completedAt`。
- Next Appointment 为当天最早的 Assigned / On the Way 工单，按预约时间排序；它不是实时定位或实时调度系统。
- Service Reports、Profile 标注 Coming soon。本次不包含登录、通知、登出、报告编辑或工单状态写入。
- 详情抽屉为只读；目前刷新不会保存任何业务修改。
- 字体优先 Inter，网络不可用时自动使用 Windows Segoe UI，不影响功能。

## 以后接 Node/Express + MySQL

数据流：`coolcare_service_app → Node/Express → GET /api/technician/jobs → jobService.js → React`。

1. 在本项目根目录复制 `.env.example` 为 `.env`：

   ```powershell
   Copy-Item .env.example .env
   ```

2. 修改 `.env`：

   ```dotenv
   VITE_USE_MOCK=false
   VITE_API_BASE_URL=/api
   ```

3. 让 Express 在 `http://localhost:3001` 运行，并实现 `GET /api/technician/jobs`。开发代理已经在 `vite.config.js` 配好；如果后端端口不同，修改该文件中的 `target`。
4. 后端需要 JOIN 实际的工单、分配、预约、客户、服务和地址表，将结果转换为以下格式。这里是约定好的前端对象，不是对你尚未提供的完整数据库结构的假设。

   ```json
   {
     "jobs": [
       {
         "id": "AC-2841",
         "customer": "Sarah Mitchell",
         "date": "2026-09-01",
         "time": "08:00",
         "serviceType": "AC Servicing",
         "address": "42 Elm Street, Northvale",
         "priority": "Normal",
         "status": "In Progress",
         "reportedProblem": "Air conditioning is not cooling."
       }
     ]
   }
   ```

   前 8 个字段必填且为字符串；`reportedProblem`、`initials` 可选。`id` 必须唯一。日期统一 `YYYY-MM-DD`，时间统一 `HH:mm`。状态统一为 `Assigned / On the Way / In Progress / Pending / Completed`；若数据库使用 `Scheduled`，在后端转换为 `Assigned`。优先级为 `Normal / High / Urgent`。

5. 保存后停止前端，再执行 `npm.cmd run dev`。API 模式使用当前本地日期，不再锁定演示日期。API 失败会显示错误和重试按钮，不会悄悄退回模拟数据。

数据库密码只放在 Express 后端的环境变量中；不要写入前端或任何 `VITE_` 变量。后端应通过登录会话识别技师并只返回该技师的工单。当前页面中的 Daniel 是演示资料，真实登录后再替换。

本项目不包含 Express 服务，也没有连接或修改你的 MySQL 数据库。生产环境下 Vite 的开发代理不会生效，需要由正式服务器代理 `/api`，或设置实际 API 地址并配置相应 CORS/会话策略。

## 检查和打包

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

`build` 生成 `dist` 文件夹；`preview` 仅用于本地查看构建结果，打开它在终端显示的地址。

可以手动检查：切换 My Jobs → Today，应有 4 条；搜索 Robert，再选 Urgent/Pending，应有 1 条；切换 All Jobs 并清空筛选，第二页应有 6 条；点击 View Details，可用关闭按钮或 Escape 返回。

常见问题：找不到 npm 时安装 Node.js 后重开终端；找不到 package.json 时检查终端所在文件夹；端口占用时使用终端给出的新地址；页面 API 错误时确认后端已启动，或将 `VITE_USE_MOCK` 改回 `true` 并重启前端。
