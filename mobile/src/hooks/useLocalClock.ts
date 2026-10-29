import { useEffect, useState } from 'react';
/** Presentation timer only: never performs a network request. */
export function useLocalClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer); },[]);
  return now;
}
