import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ReviewWorker } from './core/jobs/review-worker'

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const worker = app.get(ReviewWorker)
  process.once('SIGINT', () => worker.stop())
  process.once('SIGTERM', () => worker.stop())
  try { await worker.run() } finally { await app.close() }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
