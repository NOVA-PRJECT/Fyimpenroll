import { NestFactory } from '@nestjs/core'
import { randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { configureManualTimetableBodyParser } from './core/http/manual-timetable-body-parser'
import { AppModule } from './app.module'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cookieParser = require('cookie-parser')

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create(AppModule)
  // A campus draft contains every scheduled period and can exceed Express's
  // default 100 KB. Keep the larger bound specific to the manual editor API.
  configureManualTimetableBodyParser(app)

  // Match the actual ingress. Do not accept arbitrary leftmost forwarded headers.
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0)
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error('TRUST_PROXY_HOPS must be 0–5')
  ;(app.getHttpAdapter().getInstance() as any).set('trust proxy', proxyHops)
  app.enableShutdownHooks()
  app.use((req: any, res: any, next: any) => {
    const requestId = randomUUID()
    req.requestId = requestId
    res.setHeader('X-Request-ID', requestId)
    res.on('finish', () => {
      if (res.statusCode >= 500) logger.error(`${requestId} ${req.method} ${req.path} ${res.statusCode}`)
    })
    next()
  })

  app.use(cookieParser())

  const isProd = process.env.NODE_ENV === 'production'

  // Defensive security headers and cache control
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    next()
  })
  const rawOrigins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001']

  app.enableCors({
    origin: (origin, callback) => {
      // Allow server-to-server proxies, mobile clients, and non-browser callers
      if (!origin) return callback(null, true)
      if (!isProd) return callback(null, true)

      try {
        const url = new URL(origin)
        const isWhitelisted = rawOrigins.includes(origin) || rawOrigins.includes(url.origin)

        if (isWhitelisted) {
          return callback(null, true)
        }
      } catch {
        // invalid URL origin
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Content-Disposition', 'X-Request-ID', 'Server-Timing'],
  })

  const port = process.env.PORT || 4000
  await app.listen(port, '0.0.0.0')

  logger.log(`NestJS Backend running at http://127.0.0.1:${port}`)
  logger.log(`Supabase database & auth connected`)
}

bootstrap()
