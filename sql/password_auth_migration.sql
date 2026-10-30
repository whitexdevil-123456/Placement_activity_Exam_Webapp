-- Student password migration for an existing Class Test Portal deployment.
-- Keeps all existing students and password hashes (old PINs become their initial passwords).
-- Run once in Supabase SQL Editor before deploying the updated backend.

do $$
begin
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='students' and column_name='pin_hash')
       and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='students' and column_name='password_hash') then
        alter table public.students rename column pin_hash to password_hash;
    elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='students' and column_name='pin_hash')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='students' and column_name='password_hash') then
        update public.students set password_hash = coalesce(password_hash, pin_hash);
        alter table public.students drop column pin_hash;
    end if;
end $$;

alter table public.students add column if not exists password_hash text;
do $$
begin
    if exists (select 1 from public.students where password_hash is null) then
        raise exception 'Some student accounts have no credential hash; resolve those rows before enabling password login.';
    end if;
end $$;
alter table public.students alter column password_hash set not null;
alter table public.students add column if not exists email text;
alter table public.students add column if not exists registration_pending boolean not null default false;
create unique index if not exists students_email_lower_unique_idx
    on public.students (lower(email))
    where email is not null and length(btrim(email)) > 0;

create table if not exists public.student_password_reset_tokens (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists student_password_reset_tokens_student_created_idx
    on public.student_password_reset_tokens(student_id, created_at desc);
create index if not exists student_password_reset_tokens_expiry_idx
    on public.student_password_reset_tokens(expires_at);
alter table public.student_password_reset_tokens enable row level security;
revoke all on table public.student_password_reset_tokens from public, anon, authenticated;
grant all on table public.student_password_reset_tokens to service_role;

create or replace function public.create_student_password_reset(p_student_id uuid, p_token_hash text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_student_id uuid;
begin
    select s.id into v_student_id from public.students s
     where s.id = p_student_id and s.is_active = true and s.registration_pending = false for update;
    if not found then return false; end if;
    if exists (select 1 from public.student_password_reset_tokens t
                where t.student_id = p_student_id and t.created_at > now() - interval '60 seconds') then
        return false;
    end if;
    update public.student_password_reset_tokens set used_at = now()
     where student_id = p_student_id and used_at is null;
    delete from public.student_password_reset_tokens where created_at < now() - interval '7 days';
    insert into public.student_password_reset_tokens(student_id, token_hash, expires_at)
    values (p_student_id, p_token_hash, now() + interval '30 minutes');
    return true;
end;
$$;

create or replace function public.consume_student_password_reset(p_token_hash text, p_new_password_hash text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_student_id uuid;
begin
    select t.student_id into v_student_id from public.student_password_reset_tokens t
     where t.token_hash = p_token_hash and t.used_at is null and t.expires_at > now() for update;
    if not found then return false; end if;
    update public.students set password_hash = p_new_password_hash
     where id = v_student_id and is_active = true and registration_pending = false;
    if not found then return false; end if;
    update public.student_password_reset_tokens set used_at = now()
     where token_hash = p_token_hash and used_at is null;
    return true;
end;
$$;

revoke all on function public.create_student_password_reset(uuid, text) from public, anon, authenticated;
revoke all on function public.consume_student_password_reset(text, text) from public, anon, authenticated;
grant execute on function public.create_student_password_reset(uuid, text) to service_role;
grant execute on function public.consume_student_password_reset(text, text) to service_role;
notify pgrst, 'reload schema';
