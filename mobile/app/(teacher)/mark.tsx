import { freshRead } from '../../src/lib/data-refresh';
import React, { useState } from 'react';
import { Text, TextInput, View, Switch, Alert, Button } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../src/context/AuthContext';
import { useOfflineQueue } from '../../src/context/OfflineQueueContext';
import { apiClient } from '../../src/api/client';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';

interface Marks {
  attendance_date: string; revision: number;
  students: { id: string; full_name: string; status: string }[];
  slot: { id: string; course_code: string; course_title: string; period_number: number };
}
function DatedRoster({ data }: { data: Marks }) {
  const [absent, setAbsent] = useState(() => new Set(data.students.filter(s => s.status === 'absent').map(s => s.id)));
  const [busy, setBusy] = useState(false);
  const { isOnline, enqueueAction } = useOfflineQueue();
  const submit = async () => {
    setBusy(true);
    const payload = { timetable_slot_id: data.slot.id, attendance_date: data.attendance_date, expected_revision: data.revision, absent_student_ids: [...absent] };
    try {
      if (!isOnline) {
        await enqueueAction('PERIOD_MARKING', '/api/attendance/period/submit', payload);
        Alert.alert('Saved offline', 'This dated revision will sync for this account. Conflicting edits require review.');
      } else {
        await apiClient.post('/api/attendance/period/submit', payload);
        Alert.alert('Attendance saved');
      }
    } catch (error) { Alert.alert('Submission needs review', error instanceof Error ? error.message : 'Refresh the roster before retrying'); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 12 }}>
    <Text>{data.slot.course_code} — {data.attendance_date} — Period {data.slot.period_number}</Text>
    <Text>{data.students.length - absent.size} present / {absent.size} absent. Switch on to mark absent.</Text>
    {data.students.map(student => <View key={student.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text>{student.full_name}</Text><Switch accessibilityLabel={`${student.full_name} absent`} value={absent.has(student.id)} onValueChange={value => setAbsent(old => { const next = new Set(old); if (value) next.add(student.id); else next.delete(student.id); return next; })} />
    </View>)}
    <Button title={busy ? 'Saving…' : 'Save attendance'} disabled={busy} onPress={() => void submit()} />
  </View>;
}
export default function PeriodMarkingScreen() {
  const { user, role } = useAuth();
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [slotId, setSlotId] = useState('');
  const allowed = role === 'teacher' || role === 'hod';
  const { pendingActions, clearAction } = useOfflineQueue();
  const schedule = useQuery({ queryKey: ['dated-schedule', user?.id, date],
    queryFn: () => apiClient.get<{ periods: { timetable_slot_id: string; course_code: string; period_number: number }[] }>(`/api/attendance/period/teacher-schedule?date=${date}`),
    enabled: allowed && /^\d{4}-\d{2}-\d{2}$/.test(date) });
  const marks = useQuery({ queryKey: ['dated-marks', user?.id, slotId, date],
    queryFn: () => apiClient.get<Marks>(`/api/attendance/period/slot-marks?slotId=${slotId}&date=${date}`), enabled: allowed && !!slotId });
  if (!allowed) return <ScreenContainer><Text>Your role can view schedules but cannot mark attendance.</Text></ScreenContainer>;
  return <ScreenContainer scrollable>
    <Text style={{ fontSize: 24 }}>Period attendance</Text>
    <Text>Select a past or current scheduled date in the active semester.</Text>
    <TextInput accessibilityLabel="Attendance date" value={date} placeholder="YYYY-MM-DD" onChangeText={value => { setDate(value); setSlotId(''); }} />
    {schedule.isPending && <Text>Loading schedule…</Text>}
    {schedule.error && <Text>{schedule.error.message}</Text>}
    {schedule.data?.periods.map(slot => <Button key={slot.timetable_slot_id} title={`${slot.course_code} · Period ${slot.period_number}`} onPress={() => setSlotId(slot.timetable_slot_id)} />)}
    {marks.error && <Text>{marks.error.message}</Text>}
    {marks.data && <DatedRoster key={`${slotId}:${date}:${marks.data.revision}`} data={marks.data} />}
    {pendingActions.PERIOD_MARKING?.blockedReason && <View><Text>{pendingActions.PERIOD_MARKING.blockedReason}</Text><Button title="Discard queued marks and reload" onPress={() => Alert.alert('Discard queued attendance?', 'All pending attendance actions for this account will be removed. Reload each class to review current marks.', [{ text: 'Cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void clearAction('PERIOD_MARKING').then(() => freshRead(() => marks.refetch())); } }])} /></View>}
    <Button title="Reload current marks" onPress={() => Alert.alert('Reload marks?', 'Unsaved selections will be discarded.', [{ text: 'Cancel' }, { text: 'Reload', onPress: () => { setSlotId(''); void freshRead(() => schedule.refetch()); } }])} />
  </ScreenContainer>;
}
