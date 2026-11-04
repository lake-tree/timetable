-- ============================================================
-- 课表应用 · 专注模式（番茄钟）数据库迁移 SQL
-- ============================================================
-- 前置：需已完成账号系统迁移（supabase_auth_migration.sql）
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴 → Run
-- 可反复执行（幂等）
-- ============================================================

-- 1) 专注模式表
create table if not exists public.focus_modes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id),
  name           text not null,
  focus_minutes  integer not null default 25,
  break_minutes  integer not null default 5,
  cycles         integer,               -- 循环次数；null 表示无限循环
  created_at     timestamptz default now()
);

alter table public.focus_modes add column if not exists user_id uuid references auth.users(id);
alter table public.focus_modes add column if not exists created_at timestamptz default now();

alter table public.focus_modes enable row level security;

-- 2) 读策略：登录用户读自己的；匿名访客读主账号（owner）的
drop policy if exists "read_focus_modes" on public.focus_modes;
create policy "read_focus_modes" on public.focus_modes for select
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and (
      user_id = public.owner_id()
      or (public.owner_id() is null and user_id is null)
    ))
  );

grant select on public.focus_modes to anon, authenticated;
revoke insert, update, delete on public.focus_modes from anon, authenticated;

-- 3) 写函数（登录身份校验）
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('add_focus_mode','update_focus_mode','delete_focus_mode')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

create or replace function public.add_focus_mode(
  p_name text, p_focus_minutes integer, p_break_minutes integer, p_cycles integer
)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.focus_modes (user_id, name, focus_minutes, break_minutes, cycles, created_at)
  values (v_user, p_name, p_focus_minutes, p_break_minutes, p_cycles, now())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_focus_mode(
  p_id uuid, p_name text, p_focus_minutes integer, p_break_minutes integer, p_cycles integer
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.focus_modes set
    name = p_name, focus_minutes = p_focus_minutes, break_minutes = p_break_minutes, cycles = p_cycles
  where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.delete_focus_mode(p_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.focus_modes where id = p_id and user_id = v_user;
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end $$;

grant execute on function public.add_focus_mode(text, integer, integer, integer) to authenticated;
grant execute on function public.update_focus_mode(uuid, text, integer, integer, integer) to authenticated;
grant execute on function public.delete_focus_mode(uuid) to authenticated;
revoke execute on function public.add_focus_mode(text, integer, integer, integer) from anon, public;
revoke execute on function public.update_focus_mode(uuid, text, integer, integer, integer) from anon, public;
revoke execute on function public.delete_focus_mode(uuid) from anon, public;

-- 4) 加入 Realtime 实时同步
alter publication supabase_realtime add table public.focus_modes;
