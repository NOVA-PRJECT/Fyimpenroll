-- Public timetable grid only; no campus, account, enrollment or attendance data.
INSERT INTO public.time_slots(day_of_week,period_number,start_time,end_time)
SELECT day,period,start_time::time,end_time::time
FROM generate_series(1,5) AS day
CROSS JOIN (VALUES (1,'09:30','10:30'),(2,'10:30','11:30'),(3,'11:30','12:30'),
                   (4,'13:30','14:30'),(5,'14:30','15:30'),(6,'15:30','16:30')) AS periods(period,start_time,end_time)
ON CONFLICT (day_of_week,period_number) DO NOTHING;
