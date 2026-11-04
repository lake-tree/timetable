# 课表 · Timetable（课表编辑查看）

纯 HTML + CSS + JavaScript 的 PWA 课表应用，前端托管在 GitHub Pages，云端使用 Supabase（PostgreSQL + Realtime），手机与电脑双端实时同步，可安装到手机主屏幕。

## 功能

- 周视图网格（周一~周日 × 各节次），点击卡片查看详情
- 添加 / 修改 / 删除课程，新增时自动检测时间冲突（节次区间 + 周次交集）
- Supabase Realtime `postgres_changes` 实时同步，无需刷新
- 多学期管理，不同学期课表相互隔离
- 待办：添加 / 勾选完成 / 置顶 / 删除；支持「循环」（每日自动刷新）与「单次」；可关联课程、设截止日期
- 账号系统（Supabase Auth）：邮箱 + 密码注册 / 登录，跨设备同步，登录后即可编辑
- 访客只读：未登录只能查看主账号课表，登录后才能添加 / 修改 / 删除
- 首个注册的账号自动成为「主账号」，历史课程 / 待办 / 网站自动归入该账号
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
├── supabase_auth_migration.sql  # 账号系统数据库迁移脚本（一次性执行）
├── README.md
└── .nojekyll
```

## 数据库与权限模型

表（均在 `public` schema）：`semesters`、`courses`、`todos`、`links`、`app_settings`（记录主账号 owner）。

权限模型（账号系统）：

- `anon`（未登录访客）：只读**主账号**的数据（RLS `user_id = owner_id()`）。
- `authenticated`（登录用户）：只读 / 写**自己**的数据（RLS `user_id = auth.uid()`）。
- 所有写操作通过 `SECURITY DEFINER` 函数执行，函数内校验 `auth.uid()`（登录身份），无需口令。
- `claim_owner()`：首个登录用户认领历史无主数据并成为主账号（幂等）。
- 函数统一 `set search_path = public, extensions`。
- Realtime 使用 `supabase_realtime` publication（含 `courses` / `semesters` / `todos` / `links`）。

> 完整的账号系统迁移 SQL（建表 + 加列 + RLS + 全部写函数），见 `supabase_auth_migration.sql`，在 Supabase Dashboard → SQL Editor 一次性执行。

## 上线账号系统的步骤

1. **Dashboard 开启认证**：Authentication → Providers → Email → 打开开关；同页把「Confirm email」关闭（个人自用，注册即登录）；URL Configuration 里 Site URL 填 `https://lake-tree.github.io/timetable/`。
2. **执行迁移 SQL**：SQL Editor → 粘贴 `supabase_auth_migration.sql` 全文 → Run。
3. **注册账号**：打开网页 → 右上角「登录」→「注册」，填邮箱 + 密码。注册后自动成为主账号，历史课程 / 待办 / 网站全部归入该账号。

## 新建表 / 重建数据库时的授权要求（重要）

Supabase 自 **2026-10-30 起**，`public` schema 里**新建的表**不再自动授予 Data API 访问权限，必须显式 `GRANT`，否则 supabase-js / PostgREST / GraphQL 访问会报 `permission denied`。

**现有表不受影响**（保持当前授权）。以下场景需要重新授权：新建表、新项目、preview 分支、本地 `supabase db reset`。

以 `new_table` 为例（沿用本项目的「匿名只读主账号 + 登录读写自己」模型）：

```sql
alter table public.new_table add column if not exists user_id uuid references auth.users(id);
alter table public.new_table enable row level security;

grant select on public.new_table to anon, authenticated;
revoke insert, update, delete on public.new_table from anon, authenticated;

create policy "read new_table" on public.new_table for select
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and user_id = public.owner_id())
  );

-- 写操作走 SECURITY DEFINER 函数（函数内校验 auth.uid()）

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

- anon key 公开在前端 `config.js` 中，可被任何人获取；因此写操作依赖服务端登录身份（`auth.uid()`）校验，**切勿改回「anon 直接写表」**。
- 每个账号只能读写自己的数据（RLS + SECURITY DEFINER 函数双重校验）；访客只能看主账号课表。
- `app_secrets` 表为历史遗留（旧口令机制），账号系统上线后不再使用，可保留不动。
