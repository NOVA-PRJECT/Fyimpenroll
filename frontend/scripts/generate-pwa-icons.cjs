const path = require('node:path')
const fs = require('node:fs/promises')
const sharp = require(require.resolve('sharp', { paths: [path.dirname(require.resolve('next/package.json'))] }))

async function generate() {
  const output = path.join(__dirname, '../public/pwa')
  const logo = path.join(__dirname, '../public/knrunilogo.png')
  await fs.mkdir(output, { recursive: true })
  for (const [name, size, ratio] of [
    ['icon-192.png', 192, 0.76],
    ['icon-512.png', 512, 0.76],
    ['icon-maskable-512.png', 512, 0.58],
    ['apple-touch-icon.png', 180, 0.76],
  ]) {
    const bounds = Math.round(size * ratio)
    const mark = await sharp(logo).resize(bounds, bounds, { fit: 'inside' }).toBuffer()
    await sharp({ create: { width: size, height: size, channels: 4, background: '#FFFFFF' } })
      .composite([{ input: mark, gravity: 'centre' }]).png().toFile(path.join(output, name))
  }
}

generate().catch((error) => { console.error(error); process.exitCode = 1 })
