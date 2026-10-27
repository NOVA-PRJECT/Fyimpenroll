import { INestApplication } from '@nestjs/common'
import { json, NextFunction, Request, Response } from 'express'

export function configureManualTimetableBodyParser(app: INestApplication) {
  const parse = json({ limit: '2mb' })
  // Nest detects installed parsers by the middleware function's name, without
  // checking its mount path. A top-level `jsonParser` here would suppress its
  // default JSON parser for login and every other endpoint. Keep ours scoped
  // behind a differently named wrapper so Nest still installs its defaults.
  app.use('/api/timetable/manual', function parseManualTimetableJson(req: Request, res: Response, next: NextFunction) {
    return parse(req, res, next)
  })
}
