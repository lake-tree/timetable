-- ============================================================
-- 课表应用 · 账号系统迁移 SQL（Supabase Auth 邮箱+密码）
-- ============================================================
-- 使用前请先完成 Dashboard 操作（见文件末尾「前置步骤」）：
--   1. Authentication → Providers → Email  → 开启
--   2. Authentication → Providers → Email  → 「Confirm email」关闭（个人自用，简化注册）
--   3. Authentication → URL Configuration  → Site URL 填 https://lake-tree.github.io/timetable/
--
-- 本脚本可整体反复执行（幂等）。执行位置：
--   Supabase Dashboard → SQL Editor → 新建查询 → 粘贴本脚本 → Run
--
-- 改造内容：
--   1) 新增 app_settings 表（记录「主账号 owner」）+ owner_id() 读取函数
--   2) 4 张业务表加 user_id 列
--   3) 重建 RLS：匿名只读主账号数据；登录用户读写自己的数据
--   4) 全部写操作 RPC 函数改为「登录身份（auth.uid()）校验」，不再用口令
--   5) claim_owner()：首个登录用户一键认领历史无主数据并成为主账号
-- ============================================================

-- ============================================================
-- 第 1 步：app_settings 表 + owner_id() 读取函数
-- ============================================================
create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null default '{}'::jsonb
);
alter table public.app_settings enable row level security;

-- 所有人可读（供匿名访客的 RLS 判断「主账号是谁」）
drop policy if exists "read_app_settings" on public.app_settings;
create policy "read_app_settings" on public.app_settings
  for select using (true);

grant select on public.app_settings to anon, authenticated;
-- 写入仅由 security definer 的 claim_owner() 完成，禁止直连写入
revoke insert, update, delete on public.app_settings from anon, authenticated;

-- 读取主账号 id（security definer 避免 RLS 递归）
create or replace function public.owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select (value ->> 'owner_id')::uuid
  from public.app_settings
  where key = 'owner'
  limit 1;
$$;
grant execute on function public.owner_id() to anon, authenticated;
revoke execute on function public.owner_id() from public;

-- ============================================================
-- 第 2 步：业务表加 user_id 列 + 补齐关键列默认值（幂等）
-- ============================================================
alter table public.semesters add column if not exists user_id uuid references auth.users(id);
alter table public.courses   add column if not exists user_id uuid references auth.users(id);
alter table public.todos     add column if not exists user_id uuid references auth.users(id);
alter table public.links     add column if not exists user_id uuid references auth.users(id);

-- 若原表缺 created_at，补上并设默认值（保证 insert 成功）
alter table public.semesters add column if not exists created_at timestamptz default now();
alter table public.courses   add column if not exists created_at timestamptz default now();
alter table public.todos     add column if not exists created_at timestamptz default now();
alter table public.links     add column if not exists created_at timestamptz default now();

-- 待办状态列默认值（保证 add_todo 成功）
alter table public.todos add column if not exists done      boolean default false;
alter table public.todos add column if not exists pinned    boolean default false;
alter table public.todos add column if not exists recurring boolean default false;
alter table public.todos add column if not exists done_at   timestamptz;
alter table public.todos add column if not exists pinned_at timestamptz;

-- ============================================================
-- 第 3 步：重建 RLS 读策略（先清空旧策略，再建统一策略）
-- ============================================================
do $$
declare r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('semesters','courses','todos','links')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 统一读策略：登录用户读自己的；匿名访客读主账号（owner）的
create policy "read_semesters" on public.semesters for select
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and (
      user_id = public.owner_id()
      or (public.owner_id() is null and user_id is null)  -- 迁移过渡：主账号未认领前，访客仍看无主数据
    ))
  );

create policy "read_courses" on public.courses for select
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and (
      user_id = public.owner_id()
      or (public.owner_id() is null and user_id is null)  -- 迁移过渡：主账号未认领前，访客仍看无主数据
    ))
  );

create policy "read_todos" on public.todos for select
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and (
      user_id = public.owner_id()
      or (public.owner_id() is null and user_id is null)  -- 迁移过渡：主账号未认领前，访客仍看无主数据
    ))
  );

create policy "read_links" on public.links for select
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and (
      user_id = public.owner_id()
      or (public.owner_id() is null and user_id is null)  -- 迁移过渡：主账号未认领前，访客仍看无主数据
    ))
  );

-- 读权限显式授予（Supabase 2026-10-30 起新表需显式 grant）
grant select on public.semesters to anon, authenticated;
grant select on public.courses   to anon, authenticated;
grant select on public.todos     to anon, authenticated;
grant select on public.links     to anon, authenticated;

-- 写权限保持 revoke：所有写操作走下方 security definer 函数
revoke insert, update, delete on public.semesters from anon, authenticated;
revoke insert, update, delete on public.courses   from anon, authenticated;
revoke insert, update, delete on public.todos     from anon, authenticated;
revoke insert, update, delete on public.links     from anon, authenticated;

-- ============================================================
-- 第 4 步：删除旧版（口令参数）RPC 函数
-- ============================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'add_course','update_course','delete_course',
        'add_semester','delete_semester',
        'add_todo','edit_todo','set_todo_done','set_todo_pinned','delete_todo',
        'add_link','update_link','delete_link','claim_owner'
      )
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

-- ============================================================
-- 第 5 步：创建新版 RPC 函数（登录身份校验，无需口令）
-- ============================================================

-- 5.1 课程
create or replace function public.add_course(
  p_semester_id uuid, p_name text, p_weekday integer, p_start integer, p_end integer,
  p_teacher text, p_location text, p_weeks text, p_note text
)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid(); v_sem uuid; v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select id into v_sem from public.semesters where id = p_semester_id and user_id = v_user;
  if v_sem is null then raise exception 'Forbidden' using errcode = '42501'; end if;
  insert into public.courses
    (user_id, semester_id, name, teacher, location, weekday, start_section, end_section, weeks, note, created_at)
  values
    (v_user, p_semester_id, p_name, p_teacher, p_location, p_weekday, p_start, p_end, p_weeks, p_note, now())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_course(
  p_id uuid, p_name text, p_weekday integer, p_start integer, p_end integer,
  p_teacher text, p_location text, p_weeks text, p_note text
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.courses set
    name = p_name, weekday = p_weekday, start_section = p_start, end_section = p_end,
    teacher = p_teacher, location = p_location, weeks = p_weeks, note = p_note
  where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.delete_course(p_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.courses where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

-- 5.2 学期
create or replace function public.add_semester(p_name text, p_start_date date)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.semesters (user_id, name, start_date, created_at)
  values (v_user, p_name, p_start_date, now())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_semester(p_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.courses where semester_id = p_id and user_id = v_user;
  delete from public.todos   where semester_id = p_id and user_id = v_user;
  delete from public.semesters where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

-- 5.3 待办
create or replace function public.add_todo(
  p_semester_id uuid, p_content text, p_due_date date, p_course_id uuid, p_recurring boolean
)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid(); v_sem uuid; v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select id into v_sem from public.semesters where id = p_semester_id and user_id = v_user;
  if v_sem is null then raise exception 'Forbidden' using errcode = '42501'; end if;
  insert into public.todos
    (user_id, semester_id, content, due_date, course_id, recurring, done, pinned, created_at)
  values
    (v_user, p_semester_id, p_content, p_due_date, p_course_id, p_recurring, false, false, now())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.edit_todo(
  p_id uuid, p_content text, p_due_date date, p_course_id uuid, p_recurring boolean
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.todos set
    content = p_content, due_date = p_due_date, course_id = p_course_id, recurring = p_recurring
  where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.set_todo_done(p_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.todos set
    done = p_done,
    done_at = case when p_done then now() else null end
  where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.set_todo_pinned(p_id uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.todos set
    pinned = p_pinned,
    pinned_at = case when p_pinned then now() else null end
  where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.delete_todo(p_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.todos where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

-- 5.4 网站收藏
create or replace function public.add_link(p_name text, p_url text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.links (user_id, name, url, created_at)
  values (v_user, p_name, p_url, now())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_link(p_id uuid, p_name text, p_url text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.links set name = p_name, url = p_url
  where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.delete_link(p_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.links where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

-- 5.5 认领主账号：把历史无主数据归到当前登录用户，并设为 owner
create or replace function public.claim_owner()
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  update public.semesters set user_id = v_user where user_id is null;
  update public.courses   set user_id = v_user where user_id is null;
  update public.todos     set user_id = v_user where user_id is null;
  update public.links     set user_id = v_user where user_id is null;

  insert into public.app_settings (key, value)
  values ('owner', jsonb_build_object('owner_id', v_user))
  on conflict (key) do nothing;

  return true;
end $$;

-- ============================================================
-- 第 6 步：函数执行权限（只授予登录用户 authenticated）
-- ============================================================
grant execute on function public.add_course(uuid, text, integer, integer, integer, text, text, text, text) to authenticated;
grant execute on function public.update_course(uuid, text, integer, integer, integer, text, text, text, text) to authenticated;
grant execute on function public.delete_course(uuid) to authenticated;
grant execute on function public.add_semester(text, date) to authenticated;
grant execute on function public.delete_semester(uuid) to authenticated;
grant execute on function public.add_todo(uuid, text, date, uuid, boolean) to authenticated;
grant execute on function public.edit_todo(uuid, text, date, uuid, boolean) to authenticated;
grant execute on function public.set_todo_done(uuid, boolean) to authenticated;
grant execute on function public.set_todo_pinned(uuid, boolean) to authenticated;
grant execute on function public.delete_todo(uuid) to authenticated;
grant execute on function public.add_link(text, text) to authenticated;
grant execute on function public.update_link(uuid, text, text) to authenticated;
grant execute on function public.delete_link(uuid) to authenticated;
grant execute on function public.claim_owner() to authenticated;

-- 兜底：禁止匿名/公共角色执行写函数
revoke execute on function public.add_course(uuid, text, integer, integer, integer, text, text, text, text) from anon, public;
revoke execute on function public.update_course(uuid, text, integer, integer, integer, text, text, text, text) from anon, public;
revoke execute on function public.delete_course(uuid) from anon, public;
revoke execute on function public.add_semester(text, date) from anon, public;
revoke execute on function public.delete_semester(uuid) from anon, public;
revoke execute on function public.add_todo(uuid, text, date, uuid, boolean) from anon, public;
revoke execute on function public.edit_todo(uuid, text, date, uuid, boolean) from anon, public;
revoke execute on function public.set_todo_done(uuid, boolean) from anon, public;
revoke execute on function public.set_todo_pinned(uuid, boolean) from anon, public;
revoke execute on function public.delete_todo(uuid) from anon, public;
revoke execute on function public.add_link(text, text) from anon, public;
revoke execute on function public.update_link(uuid, text, text) from anon, public;
revoke execute on function public.delete_link(uuid) from anon, public;

-- ============================================================
-- 前置步骤（Dashboard 手动操作，非 SQL）
-- ============================================================
-- 1) Supabase Dashboard → Authentication → Providers → Email
--    把开关打开（Enable Email provider）
-- 2) 同一页面 → 把「Confirm email」关掉
--    （个人自用，注册后直接登录，免去收邮件验证）
-- 3) Authentication → URL Configuration：
--    Site URL 填 https://lake-tree.github.io/timetable/
--    Redirect URLs 加 https://lake-tree.github.io/timetable/**
-- 4) 保存。
--
-- 执行完本 SQL 后，回到网页：
--   首次点右上角「登录」→「注册」，填邮箱+密码注册（会自动成为主账号，
--   历史课程/待办/网站全部自动归到这个账号）。
-- ============================================================
