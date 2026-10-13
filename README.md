# 课表 · Timetable（课表编辑查看）

纯 HTML + CSS + JavaScript 的课表应用，前端托管在 GitHub Pages，云端使用 Supabase（PostgreSQL + Realtime），手机与电脑双端实时同步。

## 功能

- 周视图网格（周一~周日 × 各节次），点击卡片查看详情
- 添加 / 修改 / 删除课程，新增时自动检测时间冲突
- Supabase Realtime `postgres_changes` 实时同步，无需刷新
- 多学期管理，不同学期课表相互隔离
- 响应式：桌面端侧边栏 + 网格；手机端底部导航 + 按星期分组列表

## 目录结构

```
.
├── index.html   # 页面结构
├── styles.css   # 自定义样式
├── config.js    # Supabase 连接信息与节次配置
├── app.js       # 核心逻辑
├── README.md
└── .nojekyll
```

## 使用步骤

### 1. 在 Supabase 中建表并授权

打开 Supabase Dashboard → SQL Editor，依次执行以下 SQL（也可整段执行）：

```sql
-- 建表
create table if not exists public.semesters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  start_date  date,
  created_at  timestamptz not null default now()
);

create table if not exists public.courses (
  id            uuid primary key default gen_random_uuid(),
  semester_id   uuid not null references public.semesters(id) on delete cascade,
  name          text not null,
  teacher       text,
  location      text,
  weekday       int  not null check (weekday between 1 and 7),
  start_section int  not null check (start_section >= 1),
  end_section   int  not null check (end_section >= start_section),
  weeks         text,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists courses_semester_id_idx on public.courses (semester_id);

-- 启用 RLS
alter table public.courses   enable row level security;
alter table public.semesters enable row level security;

-- 显式授权
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.courses   to anon, authenticated;
grant select, insert, update, delete on public.semesters to anon, authenticated;
grant usage, select on all sequences in schema public    to anon, authenticated;

-- RLS 策略
create policy "Allow anonymous access on courses"
  on public.courses for all to anon using (true) with check (true);
create policy "Allow anonymous access on semesters"
  on public.semesters for all to anon using (true) with check (true);
create policy "Allow authenticated access on courses"
  on public.courses for all to authenticated using (true) with check (true);
create policy "Allow authenticated access on semesters"
  on public.semesters for all to authenticated using (true) with check (true);

-- 启用 Realtime 复制
alter publication supabase_realtime add table public.courses;
alter publication supabase_realtime add table public.semesters;
```

> 若提示 `gen_random_uuid()` 不存在，先执行 `create extension if not exists pgcrypto;`。
> 若 `supabase_realtime` 发布不存在，先执行 `create publication supabase_realtime;`。

### 2. 填写连接信息

编辑 `config.js`，替换 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`（在 Supabase Dashboard → Project Settings → API 中获取，使用 anon / public key）。

### 3. 本地预览

直接用浏览器打开 `index.html`，或用静态服务器：

```bash
python3 -m http.server 8080
```

### 4. 部署到 GitHub Pages

把本目录推送到 GitHub 仓库，然后在仓库 Settings → Pages 选择 `main` 分支根目录部署即可。

## 安全提示

anon key 会公开在前端代码中，且本应用为匿名用户开放了表的读写权限，因此任何拿到 anon key 的人都能读写数据。请勿在课表数据中存放敏感信息。
