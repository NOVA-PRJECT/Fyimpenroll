import {expect,test} from 'vitest'
import {kolkataInputToUtcIso,utcIsoToKolkataInput} from '../src/core/utils/dateTime'
test('production date helpers round-trip IST across midnight',()=>{
  expect(kolkataInputToUtcIso('2026-10-15T00:00')).toBe('2026-10-14T18:30:00.000Z')
  expect(utcIsoToKolkataInput('2026-10-14T18:30:00.000Z')).toBe('2026-10-15T00:00')
})
