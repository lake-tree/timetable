# 课表 · Timetable（课表编辑查看）

纯 HTML + CSS + JavaScript 的 PWA 课表应用，前端托管在 GitHub Pages，云端使用 Supabase（PostgreSQL + Realtime），手机与电脑双端实时同步，可安装到手机主屏幕。

## 功能

- 周视图网格（周一~周日 × 各节次），点击卡片查看详情
- 添加 / 修改 / 删除课程，新增时自动检测时间冲突（节次区间 + 周次交集）
- Supabase Realtime `postgres_changes` 实时同步，无需刷新
- 多学期管理，不同学期课表相互隔离
- 待办：添加 / 勾选完成 / 置顶 / 删除；支持「循环」（每日自动刷新）与「单次」；可关联课程、设截止日期
- 访客只读：默认只能查看，输入编辑口令后才能编辑（写操作经服务端口令校验）
- 自动识别今天日期与星期：桌面高亮今天列、手机当天课程置顶
- 桌面端可拖拽调整课表列宽与侧边栏宽度（偏好记住在本地）
- 中英文界面切换
- PWA：可安装到主屏幕，离线可打开（应用壳 + 最近数据缓存）

## 目录结构

```
.
├── index.html          # 页面结构
├── styles.css          # 自定义样式
├── config.js           # Supabase 连接信息与节次配置
├── app.js              # 核心逻辑
├── manifest.json       # PWA 清单
├── sw.js               # Service Worker（离线缓存）
├── icon-192.png        # 应用图标 192
├── icon-512.png        # 应用图标 512（兼 maskable）
├── icon-180.png        # iOS 主屏幕图标
├── README.md
└── .nojekyll
```

## 数据库与权限模型

表（均在 `public` schema）：`semesters`、`courses`、`todos`、`app_secrets`（存编辑口令的 bcrypt 哈希）。

权限模型：

- `anon` 对业务表**只读**（RLS `for select using(true)`）；写权限已 `revoke`。
- 所有写操作通过 `SECURITY DEFINER` 函数 + 口令校验（`verify_edit_password`）执行。
- 函数统一 `set search_path = public, extensions`（pgcrypto 位于 `extensions` schema）。
- Realtime 使用 `supabase_realtime` publication（含 `courses` / `semesters` / `todos`）。

> 完整的建表 + 授权 + RLS + 口令校验函数 SQL，需在 Supabase Dashboard → SQL Editor 执行。

## 新建表 / 重建数据库时的授权要求（重要）

Supabase 自 **2026-10-30 起**，`public` schema 里**新建的表**不再自动授予 Data API 访问权限，必须显式 `GRANT`，否则 supabase-js / PostgREST / GraphQL 访问会报 `permission denied`。

**现有表不受影响**（保持当前授权）。以下场景需要重新授权：新建表、新项目、preview 分支、本地 `supabase db reset`。

以 `new_table` 为例（沿用本项目的「匿名只读 + 口令写」模型）：

```sql
alter table public.new_table enable row level security;

-- 匿名 / 登录用户只读
grant select on public.new_table to anon, authenticated;
create policy "read new_table" on public.new_table
  for select to anon, authenticated using (true);

-- 写操作走 SECURITY DEFINER 函数（函数内校验口令，无需给 anon 写权限）

-- 需要实时同步再执行：
alter publication supabase_realtime add table public.new_table;
```

## PWA

- 站点需 HTTPS（GitHub Pages 已满足）。
- `manifest.json` 提供名称、图标、standalone 启动方式；`sw.js` 预缓存应用壳，并运行时缓存数据响应（离线可看最近数据）。
- 安装：Chrome / Edge 菜单「安装应用」；iOS Safari「分享 → 添加到主屏幕」。
- 安卓部分机型需在系统设置里给浏览器「创建桌面快捷方式」权限，否则「添加」不会落地。

## 本地预览

```bash
python3 -m http.server 8080
```

## 安全提示

- anon key 公开在前端 `config.js` 中，可被任何人获取；因此写操作必须依赖服务端口令校验，**切勿改回「anon 直接写表」**。
- 编辑口令仅以 bcrypt 哈希存于 `app_secrets`。修改口令：

```sql
insert into public.app_secrets (key, value)
values ('edit_password_hash', crypt('新口令', gen_salt('bf')))
on conflict (key) do update set value = excluded.value;
```
