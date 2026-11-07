-- ============================================================
-- 设备配对迁移：让 OnePage 墨水屏以「手机登录的那个账户」身份读数据
--
-- 背景：设备端只有 anon key，身份是匿名访客。而 courses/todos 的 RLS 是
--   (auth.uid() is not null and user_id = auth.uid()) or user_id = public.owner_id()
-- 所以设备永远只能读到主账号内容，手机上登录别的账户也没用。
--
-- 解法：手机扫码把自己的 refresh_token 交给设备，设备用它换 access_token，
-- 之后所有请求带 Authorization: Bearer <access_token>，RLS 按 auth.uid() 自动生效。
-- 不修改任何现有读策略。
--
-- 安全设计：
--   * 设备生成 code（二维码里）+ secret（只存设备本地），两者同时匹配才能领取；
--   * 表本身不开放任何直接读写权限，全部走 security definer 的 RPC；
--   * refresh_token 一经领取立刻置空并标记 consumed，一次性；
--   * code 默认 10 分钟有效，过期只能重新扫。
--
-- 执行方式：Supabase Dashboard → SQL Editor 整段粘贴执行（幂等，可重复跑）。
-- ============================================================

-- 1) 配对表
create table if not exists public.device_pairings (
  code          text primary key,                                             -- 二维码里的配对码
  device_secret text not null,                                                -- 设备本地保存的校验串
  user_id       uuid references auth.users (id) on delete cascade,
  refresh_token text,
  status        text not null default 'pending'
                  check (status in ('pending', 'ready', 'consumed')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  ready_at      timestamptz
);

create index if not exists device_pairings_expires_idx on public.device_pairings (expires_at);

alter table public.device_pairings enable row level security;
-- 不开放直接读写：所有操作都必须经过下面的 RPC（避免 anon 枚举 code 抓 token）
revoke all on public.device_pairings from anon, authenticated;

-- 2) 设备申请配对码（设备端调用，anon 可用）
--    只写入 code/secret/有效期，user_id 与 refresh_token 留空等手机来填。
create or replace function public.create_device_pairing(
  p_code text,
  p_secret text,
  p_ttl_seconds integer default 600
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_code is null or length(trim(p_code)) < 6 then
    raise exception 'Invalid pairing code';
  end if;
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'Invalid device secret';
  end if;

  -- 顺手清理一天前的残留行，避免表无限增长
  delete from public.device_pairings where expires_at < now() - interval '1 day';

  insert into public.device_pairings (code, device_secret, expires_at)
  values (
    upper(trim(p_code)),
    p_secret,
    now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 600), 3600)))
  )
  on conflict (code) do update
    set device_secret = excluded.device_secret,
        user_id = null,
        refresh_token = null,
        status = 'pending',
        created_at = now(),
        expires_at = excluded.expires_at,
        ready_at = null;
end $$;

revoke execute on function public.create_device_pairing(text, text, integer) from public;
grant execute on function public.create_device_pairing(text, text, integer) to anon, authenticated;

-- 3) 手机扫码后确认绑定（已登录用户调用）
--    refresh_token 由网页端从当前会话取出后传入；Supabase 服务端拿不到它。
create or replace function public.approve_device_pairing(
  p_code text,
  p_refresh_token text,
  p_device_label text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_refresh_token is null or length(p_refresh_token) < 10 then
    raise exception 'Invalid refresh token';
  end if;

  update public.device_pairings
     set user_id = v_user,
         refresh_token = p_refresh_token,
         status = 'ready',
         ready_at = now()
   where code = upper(trim(p_code))
     and status = 'pending'
     and expires_at > now();

  if not found then
    raise exception 'Pairing code not found or expired';
  end if;
end $$;

revoke execute on function public.approve_device_pairing(text, text, text) from public;
revoke execute on function public.approve_device_pairing(text, text, text) from anon;
grant execute on function public.approve_device_pairing(text, text, text) to authenticated;

-- 4) 设备领取登录态（设备端轮询，anon 可用）
--    必须 code + secret 同时匹配；领取后立刻销毁表里的 refresh_token 副本。
create or replace function public.claim_device_pairing(
  p_code text,
  p_secret text
)
returns table (status text, user_id uuid, refresh_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.device_pairings%rowtype;
begin
  select * into v_row
    from public.device_pairings
   where code = upper(trim(p_code))
     and device_secret = p_secret
     and expires_at > now()
   for update;

  if not found then
    return;  -- 空结果：配对码不存在 / secret 不对 / 已过期
  end if;

  if v_row.status <> 'ready' then
    return query select v_row.status, null::uuid, null::text;
    return;
  end if;

  -- 先把 token 交出去，再抹掉表里的副本（一次性）
  return query select 'ready'::text, v_row.user_id, v_row.refresh_token;

  update public.device_pairings
     set status = 'consumed',
         refresh_token = null
   where code = v_row.code;
end $$;

revoke execute on function public.claim_device_pairing(text, text) from public;
grant execute on function public.claim_device_pairing(text, text) to anon, authenticated;

-- 5) 校验
--   select * from public.claim_device_pairing('ABC12345', 'wrong-secret');  -- 应返回空
select 'device_pairing migration applied' as result,
       (select count(*) from public.device_pairings) as existing_rows;
