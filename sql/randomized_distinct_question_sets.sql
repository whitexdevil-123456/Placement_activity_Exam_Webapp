-- Atomic exam-start RPC. Each attempt receives a random ordered set.
-- Previously unseen questions for the student are favored; overlap between students is allowed,
-- but the exact same combination of questions is not reused for a different attempt.
-- A transaction-level advisory lock serializes starts in the same category so two simultaneous
-- starts cannot race and receive the same set.
create or replace function public.start_attempt_atomic(p_student_id uuid, p_category text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_student public.students%rowtype;
    v_setting public.exam_settings%rowtype;
    v_existing public.attempts%rowtype;
    v_attempt_id uuid;
    v_limit integer;
    v_available integer;
    v_unseen_count integer;
    v_candidate_ids bigint[] := array[]::bigint[];
    v_fill_ids bigint[] := array[]::bigint[];
    v_sorted_candidate bigint[] := array[]::bigint[];
    v_try integer;
    v_unique_set boolean := false;
begin
    if p_category not in ('aptitude', 'programming') then
        raise exception 'Invalid test category';
    end if;

    -- Starts are infrequent relative to answer saves; serialize only starts per test category.
    -- This prevents concurrent students from selecting an identical set at the same time.
    perform pg_advisory_xact_lock(74125, hashtext(p_category));

    select * into v_student
      from public.students
     where id = p_student_id and is_active = true
     for update;
    if not found then raise exception 'Active student not found'; end if;

    select * into v_existing
      from public.attempts
     where student_id = p_student_id and category = p_category and status = 'in_progress'
     order by started_at desc
     limit 1
     for update;
    if found then
        return jsonb_build_object(
            'id', v_existing.id,
            'status', v_existing.status,
            'deadline_at', v_existing.deadline_at,
            'resumed', true
        );
    end if;

    select * into v_setting
      from public.exam_settings
     where category = p_category;
    if not found or not v_setting.is_active then
        raise exception 'This test is currently disabled';
    end if;
    if v_setting.release_mode = 'manual' and not v_setting.manual_open then
        raise exception 'The teacher has not opened this test yet';
    end if;
    if v_setting.release_mode = 'scheduled' then
        if v_setting.scheduled_start_at is null then
            raise exception 'No test has been scheduled yet';
        end if;
        if now() < v_setting.scheduled_start_at then
            raise exception 'This test opens at %',
                to_char(v_setting.scheduled_start_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC';
        end if;
        if v_setting.scheduled_end_at is not null and now() >= v_setting.scheduled_end_at then
            raise exception 'The test registration window has closed';
        end if;
    end if;

    select count(*)
      into v_available
      from public.questions
     where category = p_category and is_active = true;
    if v_available < 1 then raise exception 'No active questions are available for this test'; end if;
    if v_available < v_setting.questions_per_attempt then
        raise exception 'This exam is configured for % questions, but only % active questions are available. Import more questions or lower the question count in Admin → Exam settings.',
            v_setting.questions_per_attempt, v_available;
    end if;
    v_limit := v_setting.questions_per_attempt;

    select count(*)
      into v_unseen_count
      from public.questions q
     where q.category = p_category
       and q.is_active = true
       and not exists (
           select 1
             from public.attempt_questions old_aq
             join public.attempts old_a on old_a.id = old_aq.attempt_id
            where old_a.student_id = p_student_id
              and old_aq.question_id = q.id
       );

    insert into public.attempts (student_id, category, deadline_at)
    values (p_student_id, p_category, now() + make_interval(mins => v_setting.duration_minutes))
    returning id into v_attempt_id;

    -- Try several independently randomized combinations. The selected set prioritizes questions
    -- this student has never seen; if needed, it fills the remainder from previously seen questions.
    -- Sets are compared as sorted IDs, so order does not make two otherwise identical sets unique.
    for v_try in 1..100 loop
        select coalesce(array_agg(picked.id), array[]::bigint[])
          into v_candidate_ids
          from (
              select q.id
                from public.questions q
               where q.category = p_category
                 and q.is_active = true
                 and not exists (
                     select 1
                       from public.attempt_questions old_aq
                       join public.attempts old_a on old_a.id = old_aq.attempt_id
                      where old_a.student_id = p_student_id
                        and old_aq.question_id = q.id
                 )
               order by random()
               limit least(v_limit, v_unseen_count)
          ) as picked;

        select coalesce(array_agg(picked.id), array[]::bigint[])
          into v_fill_ids
          from (
              select q.id
                from public.questions q
               where q.category = p_category
                 and q.is_active = true
                 and not (q.id = any(v_candidate_ids))
               order by random()
               limit greatest(v_limit - cardinality(v_candidate_ids), 0)
          ) as picked;

        v_candidate_ids := v_candidate_ids || v_fill_ids;
        if cardinality(v_candidate_ids) <> v_limit then
            raise exception 'Could not allocate the configured question count. Check the active question bank and exam settings.';
        end if;

        select array_agg(candidate_id order by candidate_id)
          into v_sorted_candidate
          from unnest(v_candidate_ids) as chosen(candidate_id);

        if not exists (
            select 1
              from public.attempts old_a
             where old_a.category = p_category
               and old_a.id <> v_attempt_id
               and (
                   select array_agg(old_aq.question_id order by old_aq.question_id)
                     from public.attempt_questions old_aq
                    where old_aq.attempt_id = old_a.id
               ) = v_sorted_candidate
        ) then
            v_unique_set := true;
            exit;
        end if;
    end loop;

    if not v_unique_set then
        raise exception 'A different question set could not be generated. Add more active questions or reduce the number of questions per attempt.';
    end if;

    with selected as (
        select q.id, q.marks
          from public.questions q
         where q.id = any(v_candidate_ids)
    ), ordered as (
        select id, marks, row_number() over (order by random())::integer as pos
          from selected
    )
    insert into public.attempt_questions (attempt_id, question_id, display_order, marks)
    select v_attempt_id, id, pos, marks from ordered;

    update public.attempts
       set max_score = coalesce((
           select sum(marks)
             from public.attempt_questions
            where attempt_id = v_attempt_id
       ), 0)
     where id = v_attempt_id;

    return jsonb_build_object(
        'id', v_attempt_id,
        'status', 'in_progress',
        'deadline_at', (select deadline_at from public.attempts where id = v_attempt_id),
        'resumed', false,
        'question_count', v_limit
    );
end;
$$;

revoke all on function public.start_attempt_atomic(uuid, text) from public, anon, authenticated;
grant execute on function public.start_attempt_atomic(uuid, text) to service_role;
notify pgrst, 'reload schema';
