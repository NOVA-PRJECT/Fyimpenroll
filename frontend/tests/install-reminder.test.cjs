const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  createInstallReminderStore,
  canShowInstallReminder,
  INSTALL_REMINDER_COOLDOWN,
  INSTALL_REMINDER_DISMISSED_KEY,
  INSTALL_REMINDER_LAST_SHOWN_KEY,
} = require('../src/core/pwa/install-reminder.ts')

function storage() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
const now = Date.UTC(2026, 9, 21, 12)

test('reminders wait for detection, skip installed apps and install routes, and yield to updates', () => {
  const normal = { pathname: '/dashboard/student', ready: true, installed: false, blocked: false }
  for (const pathname of ['/', '/login', '/dashboard/teacher', '/dashboard/student']) {
    assert.equal(canShowInstallReminder({ ...normal, pathname }), true)
  }
  assert.equal(canShowInstallReminder({ ...normal, ready: false }), false)
  assert.equal(canShowInstallReminder({ ...normal, installed: true }), false)
  assert.equal(canShowInstallReminder({ ...normal, blocked: true }), false)
  assert.equal(canShowInstallReminder({ ...normal, pathname: '/install' }), false)
  assert.equal(canShowInstallReminder({ ...normal, pathname: '/install/' }), false)
})

test('viewing starts an exact 72-hour cooldown that survives a reload', () => {
  const disk = storage()
  const firstVisit = createInstallReminderStore(() => disk)
  assert.equal(firstVisit.isEligible(now), true)
  firstVisit.markShown(now)
  assert.equal(disk.getItem(INSTALL_REMINDER_LAST_SHOWN_KEY), String(now))
  const nextVisit = createInstallReminderStore(() => disk)
  assert.equal(nextVisit.isEligible(now + INSTALL_REMINDER_COOLDOWN - 1), false)
  assert.equal(nextVisit.isEligible(now + INSTALL_REMINDER_COOLDOWN), true)
})

test('Get the app permanently suppresses subsequent visits even after the cooldown', () => {
  const disk = storage()
  let notified = 0
  const firstVisit = createInstallReminderStore(() => disk, () => notified++)
  firstVisit.markShown(now)
  firstVisit.dismissPermanently()
  assert.equal(disk.getItem(INSTALL_REMINDER_DISMISSED_KEY), 'true')
  assert.equal(notified, 1)
  disk.values.set(INSTALL_REMINDER_LAST_SHOWN_KEY, 'invalid')
  const laterVisit = createInstallReminderStore(() => disk)
  assert.equal(laterVisit.isEligible(now + 100 * INSTALL_REMINDER_COOLDOWN), false)
})

test('independent tabs read each other’s cooldown and permanent dismissal', () => {
  const disk = storage()
  const firstTab = createInstallReminderStore(() => disk)
  const secondTab = createInstallReminderStore(() => disk)
  assert.equal(secondTab.isEligible(now), true)
  firstTab.markShown(now)
  assert.equal(secondTab.isEligible(now + 1), false)
  secondTab.dismissPermanently()
  assert.equal(firstTab.isEligible(now + INSTALL_REMINDER_COOLDOWN), false)
  disk.values.clear()
  assert.equal(firstTab.isEligible(now), true)
  assert.equal(secondTab.isEligible(now), true)
})

test('missing, corrupt and future timestamps can recover on the next view', () => {
  const disk = storage()
  const store = createInstallReminderStore(() => disk)
  for (const value of ['', 'broken', '-1', 'Infinity', String(now + 1)]) {
    disk.values.set(INSTALL_REMINDER_LAST_SHOWN_KEY, value)
    assert.equal(store.isEligible(now), true, value)
  }
  store.markShown(now)
  assert.equal(store.isEligible(now), false)
})

test('blocked reads and missing storage show at most once during a page load', () => {
  for (const getStorage of [() => undefined, () => { throw new Error('disabled') }, () => ({ getItem() { throw new Error('blocked') } })]) {
    const store = createInstallReminderStore(getStorage)
    assert.equal(store.isEligible(now), true)
    assert.doesNotThrow(() => store.markShown(now))
    assert.equal(store.isEligible(now + 10 * INSTALL_REMINDER_COOLDOWN), false)
    assert.doesNotThrow(() => store.dismissPermanently())
    assert.equal(store.isEligible(now), false)
  }
})

test('storage write failure still keeps cooldown and permanent dismissal in memory', () => {
  const disk = storage()
  disk.setItem = () => { throw new Error('quota exceeded') }
  const store = createInstallReminderStore(() => disk)
  store.markShown(now)
  assert.equal(store.isEligible(now + INSTALL_REMINDER_COOLDOWN), false)
  store.dismissPermanently()
  assert.equal(store.isEligible(now + 100 * INSTALL_REMINDER_COOLDOWN), false)
})

test('account cleanup preserves browser reminder choices but still removes account data', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const vm = require('node:vm')
  const ts = require('typescript')
  const filename = path.join(__dirname, '../src/core/security/session-navigation.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const local = Object.assign(Object.create({ removeItem(key) { delete this[key] } }), {
    [INSTALL_REMINDER_LAST_SHOWN_KEY]: String(now),
    [INSTALL_REMINDER_DISMISSED_KEY]: 'true',
    'fyimp:theme': 'dark',
    'fyimp:theme-position': '{}',
    'fyimp:rules:example': '{}',
    'account-cache': 'private account data',
    'auth-token': 'private credential',
  })
  let sessionCleared = false
  const exports = {}
  vm.runInNewContext(source, {
    exports,
    require: name => require(path.resolve(path.dirname(filename), name + '.ts')),
    localStorage: local,
    sessionStorage: { clear() { sessionCleared = true } },
  }, { filename })
  exports.clearSessionStorage()
  assert.equal(sessionCleared, true)
  assert.equal(local[INSTALL_REMINDER_DISMISSED_KEY], 'true')
  assert.equal(local[INSTALL_REMINDER_LAST_SHOWN_KEY], String(now))
  assert.equal(local['fyimp:theme'], 'dark')
  assert.equal(local['fyimp:rules:example'], '{}')
  assert.equal(local['account-cache'], undefined)
  assert.equal(local['auth-token'], undefined)
})
