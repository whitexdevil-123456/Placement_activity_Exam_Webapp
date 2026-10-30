-- Email OTP 2-step authentication migration for an existing Class Test Portal database.
-- Run after the password_auth_migration.sql and password_reset_migration.sql migrations.
-- Safe to run repeatedly. OTP challenges are private and service-role only.
create table if not exists public.auth_login_otp_challenges (
    id uuid primary key,
    role text not null check (role in ('student', 'admin')),
    student_id uuid references public.students(id) on delete cascade,
    login_identifier text not null,
    email text not null,
    display_name text not null default '',
    otp_hash text not null,
    attempts integer not null default 0 check (attempts between 0 and 5),
    expires_at timestamptz not null,
    consumed_at timestamptz,
    created_at timestamptz not null default now(),
    constraint auth_login_otp_role_subject_check check ((role = 'student' and student_id is not null) or (role = 'admin' and student_id is null))
);
create index if not exists auth_login_otp_identifier_created_idx
    on public.auth_login_otp_challenges (role, lower(login_identifier), created_at desc);
create index if not exists auth_login_otp_expiry_idx
    on public.auth_login_otp_challenges (expires_at);
alter table public.auth_login_otp_challenges enable row level security;
revoke all on table public.auth_login_otp_challenges from public, anon, authenticated;
grant all on table public.auth_login_otp_challenges to service_role;

create or replace function public.create_login_otp_challenge(
    p_challenge_id uuid, p_role text, p_student_id uuid,
    p_login_identifier text, p_email text, p_display_name text, p_otp_hash text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recent timestamptz;
begin
    if p_role not in ('student', 'admin') or length(btrim(p_login_identifier)) = 0 or length(btrim(p_email)) = 0 then
        return jsonb_build_object('status', 'invalid');
    end if;
    if (p_role = 'student' and p_student_id is null) or (p_role = 'admin' and p_student_id is not null) then
        return jsonb_build_object('status', 'invalid');
    end if;
    perform pg_advisory_xact_lock(hashtext(p_role || ':' || lower(p_login_identifier)));
    select max(created_at) into v_recent from public.auth_login_otp_challenges
     where role = p_role and lower(login_identifier) = lower(p_login_identifier);
    if v_recent is not null and v_recent > now() - interval '60 seconds' then
        return jsonb_build_object('status', 'rate_limited',
            'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_recent + interval '60 seconds' - now())))::integer));
    end if;
    update public.auth_login_otp_challenges set consumed_at = coalesce(consumed_at, now())
     where role = p_role and lower(login_identifier) = lower(p_login_identifier) and consumed_at is null;
    insert into public.auth_login_otp_challenges
        (id, role, student_id, login_identifier, email, display_name, otp_hash, attempts, expires_at)
    values
        (p_challenge_id, p_role, p_student_id, btrim(p_login_identifier), lower(btrim(p_email)), coalesce(p_display_name, ''), p_otp_hash, 0, now() + interval '5 minutes');
    delete from public.auth_login_otp_challenges where created_at < now() - interval '2 days';
    return jsonb_build_object('status', 'created', 'challenge_id', p_challenge_id, 'expires_in_seconds', 300);
end;
$$;

create or replace function public.verify_login_otp_challenge(p_challenge_id uuid, p_otp_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_challenge public.auth_login_otp_challenges%rowtype; v_remaining integer;
begin
    select * into v_challenge from public.auth_login_otp_challenges where id = p_challenge_id for update;
    if not found then return jsonb_build_object('status', 'invalid'); end if;
    if v_challenge.consumed_at is not null then return jsonb_build_object('status', 'used'); end if;
    if v_challenge.expires_at <= now() then
        update public.auth_login_otp_challenges set consumed_at = now() where id = p_challenge_id;
        return jsonb_build_object('status', 'expired');
    end if;
    if v_challenge.attempts >= 5 then
        update public.auth_login_otp_challenges set consumed_at = now() where id = p_challenge_id;
        return jsonb_build_object('status', 'locked');
    end if;
    if v_challenge.otp_hash <> p_otp_hash then
        update public.auth_login_otp_challenges set attempts = attempts + 1 where id = p_challenge_id;
        v_remaining := greatest(0, 5 - v_challenge.attempts - 1);
        if v_remaining = 0 then
            update public.auth_login_otp_challenges set consumed_at = now() where id = p_challenge_id;
            return jsonb_build_object('status', 'locked');
        end if;
        return jsonb_build_object('status', 'invalid', 'attempts_remaining', v_remaining);
    end if;
    update public.auth_login_otp_challenges set consumed_at = now() where id = p_challenge_id;
    return jsonb_build_object('status', 'verified', 'role', v_challenge.role,
        'student_id', v_challenge.student_id, 'login_identifier', v_challenge.login_identifier,
        'email', v_challenge.email, 'display_name', v_challenge.display_name);
end;
$$;

revoke all on function public.create_login_otp_challenge(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.verify_login_otp_challenge(uuid, text) from public, anon, authenticated;
grant execute on function public.create_login_otp_challenge(uuid, text, uuid, text, text, text, text) to service_role;
grant execute on function public.verify_login_otp_challenge(uuid, text) to service_role;
notify pgrst, 'reload schema';
