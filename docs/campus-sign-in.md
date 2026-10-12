# Campus GPS sign-in rollout

1. Apply the repository's existing attendance/security migrations, then `supabase/migrations/20261012010000_campus_sign_in_date.sql`. The new migration preserves existing attendance and supports both the original generated date column and the later plain date column. Do not rerun the old September 9 migration on production: it drops the attendance table.
2. Deploy the backend, web and mobile changes together. The sign-in API now requires `client_timestamp` from the location capture. Captures older than 60 seconds, more than 10 seconds in the future, or from a previous IST date/session are rejected. Students should enable automatic device time.
3. Configure the backend's Supabase URL and service role key and the frontend's `BACKEND_URL` and HTTPS domain. Keep service credentials on the server. Retain `Permissions-Policy: geolocation=(self)`; check that the hosting proxy does not override it.
4. In the director dashboard's Registration tab, use **Campus sign-in settings** to save a physically verified centre, radius and ordered IST timings. Seed locations are not evidence of correct campus boundaries. Do not rerun seed upserts after configuring campuses: they overwrite these settings.
5. Verify each student's `campus_id` and the director's campus assignment. Test student login, location permission, a capture inside the campus radius, a capture outside it, denied permission, poor accuracy, duplicate taps and both session boundaries. Check the student status and staff roster after saving.

Campus sign-in requires an internet connection and location accuracy of 50 metres or better. The mobile app no longer queues GPS check-ins. Old GPS queue entries are removed when that account's queue is read; class attendance entries remain intact. A location captured offline is not verified attendance.

The server determines session, time and distance. Morning arrival is on time up to the configured morning cutoff. The midday split starts the evening session, which counts as early leave until the evening cutoff. The day-end instant is inclusive; later captures are rejected. The system currently has no opening-time or holiday calendar for campus sign-in.

The app rejects locations reported as mocked by the native platform. Browser and mobile coordinates remain device-reported; timestamp and accuracy checks do not prove that a device is physically present. Stronger protection requires a separately designed campus presence factor or staff verification. Do not describe GPS alone as spoof-proof.

Raw student coordinates are not persisted by this flow. The record contains student/campus identity, session, server timestamp, result, accuracy and source. Audit logs also retain distance and request metadata. Campus centre coordinates are configuration and are intentionally stored.
