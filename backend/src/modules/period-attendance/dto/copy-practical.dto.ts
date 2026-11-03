import { z } from 'zod'
import { CopyPracticalSchema } from '@fyimp/contracts'
export { CopyPracticalSchema }
export type CopyPracticalDto = z.infer<typeof CopyPracticalSchema>
