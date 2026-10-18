begin;
create temporary table tt_mdc_2h_before on commit drop as
select * from jsonb_populate_recordset(null::public.courses, '[{"id":"26981be5-5db7-40cb-bc26-9abca0d862dc","tag":"MDC-3","title":"Current Issues of Global Economy","credits":3,"category":"MDC","semester":2,"seat_limit":60,"course_code":"KU02MDCECO104TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"3abb7244-4d8c-4ea7-a9ba-8907c1857224","tag":"MDC-2","title":"Foundations of Data Science","credits":3,"category":"MDC","semester":2,"seat_limit":50,"course_code":"KU2MDCCSE201TT","department_id":"77eacd1e-1577-4e39-84f2-d8e45da4f095","academic_level":null,"theory_hours_per_week":2,"prerequisite_course_ids":[],"practical_hours_per_week":2},{"id":"403e6166-0275-497c-9e71-cf01017a0b37","tag":"MDC-3","title":"Urban and Rural Economy","credits":3,"category":"MDC","semester":2,"seat_limit":60,"course_code":"KU02MDCECO106TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"5bc734c6-eb85-445c-a924-844e324263ce","tag":"MDC-2","title":"ELEMENTARY MATHEMATICS -2","credits":3,"category":"MDC","semester":2,"seat_limit":30,"course_code":"KU02MDCMAT10 1TT","department_id":"a3dd0c91-e402-40aa-84df-ef4ad9906964","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"5e6d6216-1b63-4272-a4f7-3a1f667d41b0","tag":"MDC-3","title":"Basic Mathematical and Statistical Methods","credits":3,"category":"MDC","semester":2,"seat_limit":60,"course_code":"KU02MDCECO107TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"68f5fc17-5fdd-4d67-a9b8-4b773d1ac43f","tag":"MDC-2","title":"SELF AND SOCIETY","credits":3,"category":"MDC","semester":2,"seat_limit":60,"course_code":"KU02MDCPSY102TT","department_id":"9d3e0366-5b7c-4fc4-8f7e-680967378927","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"b1ba5a4e-c5af-4a91-aad7-1aa0387ea1ae","tag":"MDC-3","title":"Economic Journalism","credits":3,"category":"MDC","semester":2,"seat_limit":60,"course_code":"KU02MDCECO105TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"b6318307-f3d5-4833-b456-51309d7c140d","tag":"MDC-2","title":"CORRELATION AND REGRESSION ANALYSIS","credits":3,"category":"MDC","semester":2,"seat_limit":60,"course_code":"KU02MDCSTA201TT","department_id":"255df1ce-3c98-4cdb-8c6f-148806517d29","academic_level":null,"theory_hours_per_week":2,"prerequisite_course_ids":[],"practical_hours_per_week":2}]'::jsonb);
do $tt_mdc_update$
declare v_count integer; v_preserved jsonb; v_after jsonb;
begin
  if not exists(select 1 from public.campuses where id='b72074e2-468e-4218-afb6-0f08f14cfe8f' and code='MANGATTT')
  then raise exception 'Unexpected test campus'; end if;
  if (select count(*) from tt_mdc_2h_before)<>8
    or exists(select 1 from tt_mdc_2h_before where category<>'MDC' or semester<>2 or course_code not like '%TT' or credits<>3
      or not ((theory_hours_per_week=3 and practical_hours_per_week=0) or (theory_hours_per_week=2 and practical_hours_per_week=2)))
  then raise exception 'Unexpected MDC snapshot'; end if;
  perform c.id from public.courses c join tt_mdc_2h_before b on b.id=c.id for update of c;
  if (select count(*) from public.courses c join public.departments d on d.id=c.department_id
    where d.campus_id='b72074e2-468e-4218-afb6-0f08f14cfe8f' and c.semester=2 and c.category='MDC')<>8
    or exists(select 1 from tt_mdc_2h_before b left join public.courses c on c.id=b.id
      left join public.departments d on d.id=c.department_id where c.id is null
      or d.campus_id is distinct from 'b72074e2-468e-4218-afb6-0f08f14cfe8f'::uuid
      or to_jsonb(c) is distinct from to_jsonb(b))
  then raise exception 'Course metadata changed since preflight'; end if;
  if exists(select 1 from public.system_logs where campus_id='b72074e2-468e-4218-afb6-0f08f14cfe8f'
    and log_type='timetable_job' and academic_year='2026-27' and semester=2 and status in('queued','running'))
    or exists(select 1 from public.timetable_entries where campus_id='b72074e2-468e-4218-afb6-0f08f14cfe8f'
    and academic_year='2026-27' and semester=2 and status='published')
  then raise exception 'Timetable is active or published'; end if;
  select jsonb_build_object(
    'other_courses',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) from public.courses c where not exists(select 1 from tt_mdc_2h_before b where b.id=c.id)),
    'registrations',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.student_registrations r),
    'preferences',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.registration_preferences r),
    'assignments',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.teacher_course_assignments r),
    'blueprints',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.semester_blueprints r)
  ) into v_preserved;
  update public.courses c set theory_hours_per_week=case when b.practical_hours_per_week=2 then 0 else 2 end
    from tt_mdc_2h_before b where c.id=b.id;
  get diagnostics v_count = row_count;
  if v_count<>8 or exists(select 1 from tt_mdc_2h_before b join public.courses c on c.id=b.id where
    c.theory_hours_per_week+c.practical_hours_per_week<>2 or c.practical_hours_per_week not in(0,2)
    or (to_jsonb(c)-'theory_hours_per_week') is distinct from (to_jsonb(b)-'theory_hours_per_week'))
  then raise exception 'MDC update verification failed'; end if;
  select jsonb_build_object(
    'other_courses',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) from public.courses c where not exists(select 1 from tt_mdc_2h_before b where b.id=c.id)),
    'registrations',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.student_registrations r),
    'preferences',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.registration_preferences r),
    'assignments',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.teacher_course_assignments r),
    'blueprints',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.semester_blueprints r)
  ) into v_after;
  if v_after is distinct from v_preserved then raise exception 'Unrelated data changed; update rolled back'; end if;
end $tt_mdc_update$;
commit;
