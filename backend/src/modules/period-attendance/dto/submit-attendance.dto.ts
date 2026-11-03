import { z } from 'zod'
import { SubmitAttendanceSchema } from '@fyimp/contracts'
export { SubmitAttendanceSchema }
export type SubmitAttendanceDto = z.infer<typeof SubmitAttendanceSchema>
