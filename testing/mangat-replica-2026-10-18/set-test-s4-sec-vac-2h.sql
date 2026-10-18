begin;
create temporary table tt_s4_baskets_2h_before on commit drop as
select * from jsonb_populate_recordset(null::public.courses, '[{"id":"c6864eee-4374-4409-b905-a02cef4058f1","tag":"SEC-4","title":"Corporate Social Responsibility","credits":3,"category":"SEC","semester":4,"seat_limit":60,"course_code":"KU04SECECO201TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"50f892ec-e60f-4268-9b87-8be2e4d0f33e","tag":"SEC-4","title":"Entrepreneurship Development","credits":3,"category":"SEC","semester":4,"seat_limit":60,"course_code":"KU04SECECO202TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"db7e604d-b91f-4080-8f2b-cfad1d8e5551","tag":"SEC-4","title":"BASIC COURSE IN LATEX","credits":3,"category":"SEC","semester":4,"seat_limit":30,"course_code":"KU04SECMAT20TT","department_id":"a3dd0c91-e402-40aa-84df-ef4ad9906964","academic_level":null,"theory_hours_per_week":2,"prerequisite_course_ids":[],"practical_hours_per_week":2},{"id":"bd4b5882-855d-477d-8363-438134f1e0d2","tag":"SEC-4","title":"STRESS MANAGEMENT","credits":3,"category":"SEC","semester":4,"seat_limit":60,"course_code":"KU04SECPSY201TT","department_id":"9d3e0366-5b7c-4fc4-8f7e-680967378927","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"b46603d7-26c4-4f76-8134-e7b058691da2","tag":"SEC-4","title":"DATA ANALYSIS USING EXCEL","credits":3,"category":"SEC","semester":4,"seat_limit":60,"course_code":"KU04SECSTA201TT","department_id":"255df1ce-3c98-4cdb-8c6f-148806517d29","academic_level":null,"theory_hours_per_week":2,"prerequisite_course_ids":[],"practical_hours_per_week":2},{"id":"f855594d-cb42-445e-a575-2290d5f6e7c0","tag":"SEC-4","title":"DATA ANALYSIS USING SPSS","credits":3,"category":"SEC","semester":4,"seat_limit":60,"course_code":"KU04SECSTA202TT","department_id":"255df1ce-3c98-4cdb-8c6f-148806517d29","academic_level":null,"theory_hours_per_week":2,"prerequisite_course_ids":[],"practical_hours_per_week":2},{"id":"2b12fa89-f509-4dd7-82f7-9193dc781b59","tag":"VAC-4","title":"Public Speaking","credits":3,"category":"VAC","semester":4,"seat_limit":60,"course_code":"KU04VACECO203TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"c270991f-5d62-4def-895b-8d11f68605f4","tag":"VAC-4","title":"Economics of Startup and Entrepreneurship","credits":3,"category":"VAC","semester":4,"seat_limit":60,"course_code":"KU04VACECO204TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0},{"id":"15c10dca-ffb2-44a0-a2fe-23e1897c4d8a","tag":"VAC-4","title":"DRIVING AND ROAD RAGE BEHAVIOR","credits":3,"category":"VAC","semester":4,"seat_limit":60,"course_code":"KU04VACPSY202TT","department_id":"9d3e0366-5b7c-4fc4-8f7e-680967378927","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0}]'::jsonb);
do $tt_s4_baskets_update$
declare v_count integer; v_preserved jsonb; v_after jsonb;
begin
  if not exists(select 1 from public.campuses where id='b72074e2-468e-4218-afb6-0f08f14cfe8f' and code='MANGATTT')
  then raise exception 'Unexpected test campus'; end if;
  if (select count(*) from tt_s4_baskets_2h_before)<>9
    or exists(select 1 from tt_s4_baskets_2h_before where category not in ('SEC','VAC') or semester<>4 or course_code not like '%TT' or credits<>3
      or not ((theory_hours_per_week=3 and practical_hours_per_week=0) or (theory_hours_per_week=2 and practical_hours_per_week=2)))
  then raise exception 'Unexpected S4 SEC/VAC snapshot'; end if;
  perform c.id from public.courses c join tt_s4_baskets_2h_before b on b.id=c.id for update of c;
  if (select count(*) from public.courses c join public.departments d on d.id=c.department_id
    where d.campus_id='b72074e2-468e-4218-afb6-0f08f14cfe8f' and c.semester=4 and c.category in ('SEC','VAC'))<>9
    or exists(select 1 from tt_s4_baskets_2h_before b left join public.courses c on c.id=b.id
      left join public.departments d on d.id=c.department_id where c.id is null
      or d.campus_id is distinct from 'b72074e2-468e-4218-afb6-0f08f14cfe8f'::uuid
      or to_jsonb(c) is distinct from to_jsonb(b))
  then raise exception 'Course metadata changed since preflight'; end if;
  if exists(select 1 from public.system_logs where campus_id='b72074e2-468e-4218-afb6-0f08f14cfe8f'
    and log_type='timetable_job' and academic_year='2026-27' and semester=4 and status in('queued','running'))
    or exists(select 1 from public.timetable_entries where campus_id='b72074e2-468e-4218-afb6-0f08f14cfe8f'
    and academic_year='2026-27' and semester=4 and status='published')
  then raise exception 'Timetable is active or published'; end if;
  select jsonb_build_object(
    'other_courses',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) from public.courses c where not exists(select 1 from tt_s4_baskets_2h_before b where b.id=c.id)),
    'registrations',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.student_registrations r),
    'preferences',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.registration_preferences r),
    'assignments',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.teacher_course_assignments r),
    'blueprints',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.semester_blueprints r)
  ) into v_preserved;
  update public.courses c set theory_hours_per_week=case when b.practical_hours_per_week=2 then 0 else 2 end
    from tt_s4_baskets_2h_before b where c.id=b.id;
  get diagnostics v_count = row_count;
  if v_count<>9 or exists(select 1 from tt_s4_baskets_2h_before b join public.courses c on c.id=b.id where
    c.theory_hours_per_week+c.practical_hours_per_week<>2 or c.practical_hours_per_week not in(0,2)
    or (to_jsonb(c)-'theory_hours_per_week') is distinct from (to_jsonb(b)-'theory_hours_per_week'))
  then raise exception 'S4 SEC/VAC update verification failed'; end if;
  select jsonb_build_object(
    'other_courses',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) from public.courses c where not exists(select 1 from tt_s4_baskets_2h_before b where b.id=c.id)),
    'registrations',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.student_registrations r),
    'preferences',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.registration_preferences r),
    'assignments',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.teacher_course_assignments r),
    'blueprints',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.semester_blueprints r)
  ) into v_after;
  if v_after is distinct from v_preserved then raise exception 'Unrelated data changed; update rolled back'; end if;
end $tt_s4_baskets_update$;
commit;
