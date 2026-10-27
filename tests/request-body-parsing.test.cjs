const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { Body, Controller, HttpCode, Module, Post, Req, Res } = require('@nestjs/common')
const { AuthController } = require('../backend/dist/modules/auth/auth.controller')
const { configureManualTimetableBodyParser } = require('../backend/dist/core/http/manual-timetable-body-parser')
let app, baseUrl
const logins = []

const authController = new AuthController({
  async login(email, password) {
    logins.push({ email, password })
    return { token: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresIn: 3600,
      userId: 'synthetic-director', role: 'campus_director', redirectTo: '/dashboard/director', consent: { accepted: true } }
  },
})
// Exercise the real login handler without initializing unrelated auth routes,
// provider credentials, guards, or a live authentication service.
class LoginHttpController {
  login(body, req, res) { return authController.login(body, req, res) }
}
Controller('api/auth')(LoginHttpController)
Post('login')(LoginHttpController.prototype, 'login', Object.getOwnPropertyDescriptor(LoginHttpController.prototype, 'login'))
HttpCode(200)(LoginHttpController.prototype, 'login', Object.getOwnPropertyDescriptor(LoginHttpController.prototype, 'login'))
Body()(LoginHttpController.prototype, 'login', 0)
Req()(LoginHttpController.prototype, 'login', 1)
Res({ passthrough: true })(LoginHttpController.prototype, 'login', 2)

class ManualController {
  preview(body) { return { length: body.payload.length } }
}
Controller('api/timetable/manual')(ManualController)
Post('preview')(ManualController.prototype, 'preview', Object.getOwnPropertyDescriptor(ManualController.prototype, 'preview'))
Body()(ManualController.prototype, 'preview', 0)

class OrdinaryController {
  echo(body) { return body }
}
Controller('api/ordinary')(OrdinaryController)
Post('echo')(OrdinaryController.prototype, 'echo', Object.getOwnPropertyDescriptor(OrdinaryController.prototype, 'echo'))
Body()(OrdinaryController.prototype, 'echo', 0)

class TestModule {}
Module({
  controllers: [LoginHttpController, ManualController, OrdinaryController],
})(TestModule)

before(async () => {
  app = await NestFactory.create(TestModule, { logger: false, abortOnError: false })
  configureManualTimetableBodyParser(app)
  await app.listen(0, '127.0.0.1')
  baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`
})
after(async () => { await app?.close() })

test('login receives JSON credentials after the scoped timetable parser is installed', async () => {
  const credentials = { email: 'director@example.test', password: 'synthetic-password' }
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) })
  assert.equal(response.status, 200)
  assert.deepEqual(logins, [credentials])
  assert.equal((await response.json()).redirectTo, '/dashboard/director')
  assert.match(response.headers.get('set-cookie'), /auth_token=synthetic-access/)
})

test('large campus drafts retain the scoped 2 MB limit', async () => {
  const payload = 'x'.repeat(150 * 1024)
  const response = await fetch(`${baseUrl}/api/timetable/manual/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).length, payload.length)
})

test('ordinary endpoints still parse JSON and retain the normal 100 KB limit', async () => {
  const small = await fetch(`${baseUrl}/api/ordinary/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'parsed' }) })
  assert.equal(small.status, 201)
  assert.deepEqual(await small.json(), { value: 'parsed' })
  const oversized = await fetch(`${baseUrl}/api/ordinary/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(150 * 1024) }) })
  assert.equal(oversized.status, 413)
})
