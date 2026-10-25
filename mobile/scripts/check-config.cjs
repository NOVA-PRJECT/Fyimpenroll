const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const envPath = path.join(__dirname, '../.env')
const environment = { ...(fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {}), ...process.env }
for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_PORTAL_URL']) {
  if (!environment[key]) throw new Error(`Missing ${key}. Complete mobile/.env or configure the build environment.`)
}
for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_PORTAL_URL']) {
  const url = new URL(environment[key])
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid ${key}`)
}
console.log('Mobile public configuration validated.')
