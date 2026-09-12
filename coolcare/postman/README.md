# Postman 订单持久化演示

1. 项目根目录运行 `npm run db:up`，然后运行 `npm start`。如果服务已启动，无需重复运行。
2. 在 Postman 点击 **Import**，选择同目录 `CoolCare-Booking-Demo.postman_collection.json`。
3. 保持 Cookie 功能开启，不需要选择 Environment。集合变量已包含本机 API 地址及演示账号，不含 MySQL 密码。
4. 按 01–06 顺序点击 **Send**，或用 Collection Runner 顺序运行一次。

01 获取会话和 CSRF；02 登录并生成演示请求编号、符合规则的未来日期（以新加坡日期加 14 个自然日，遇周末顺延周一）；03 真正创建预约，返回 `booking.id`；04 独立 GET 查询该预约；05 用原客户门户接口再次读取；06 重复请求，确认返回相同订单编号而没有重复创建。

登录和创建后的脚本会自动保存 `csrf`、`userId`、`bookingId`，无需手动复制。所有请求使用同一个 localhost 主机名，避免 Cookie 丢失。新一轮演示重新执行 01、02，会产生新的请求编号和订单；只重复 03 或 06 会复用原订单。

## 向老师展示数据库里的原始记录

记下 03 返回的 `booking.id`，在项目根目录终端执行（将 18 替换为现场编号）：

```powershell
node coolcare/scripts/verify-booking.mjs 18
```

这个命令通过独立 MySQL 连接直接执行只读 SELECT，不调用网页或 HTTP API。输出 booking、web_booking_details、booking_aircon_unit、booking_status_history 的对应数据，可与 Postman 中的订单编号、金额和请求 UUID 对照。它从本机 `.env.local` 读取连接参数，不输出密码。

也可在 MySQL Workbench 已连接的查询窗口运行：

```sql
USE coolcare_service_app;
SET @booking_id = 18;
SELECT * FROM booking WHERE booking_id = @booking_id;
SELECT * FROM web_booking_details WHERE booking_id = @booking_id;
SELECT * FROM booking_aircon_unit WHERE booking_id = @booking_id;
SELECT * FROM booking_status_history WHERE booking_id = @booking_id;
```

这些演示会真实写入本机数据库，不会自动回滚。地址和备注明确标识为课堂演示，不代表实际服务需求。

验证记录：2026-09-11 已通过 Node HTTP 客户端执行集合中的全部六个请求，创建订单 #18，并通过独立 MySQL SELECT 核对。此验证不等于已在 Postman UI 中导入或执行。
