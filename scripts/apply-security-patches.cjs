const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

// These upstream advisories have no released fix. Keep explicit, reproducible
// patches rather than changing framework versions or suppressing audit findings.
const depthGuard = `'use strict';
module.exports = ast => {
  const pending = [[ast, 0]];
  const seen = new Set();
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (depth > 128 || seen.has(node) || seen.size >= 65536) {
      throw new SyntaxError('Brace pattern exceeds the safe nesting limit');
    }
    seen.add(node);
    if (Array.isArray(node.nodes)) for (const child of node.nodes) pending.push([child, depth + 1]);
  }
};
`
function replace(file, before, after, expected = 1) {
  let text = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
  const already = text.split(after).length - 1
  if (already === expected) return
  if (text.split(before).length - 1 !== expected) throw new Error(`Security patch no longer matches ${file}; review the upstream change`)
  text = text.replaceAll(before, after)
  fs.writeFileSync(file, text)
}

function applySecurityPatches() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  for (const relative of Object.keys(lock.packages)) {
    const name = relative.endsWith('node_modules/braces') ? 'braces' : relative.endsWith('node_modules/node-forge') ? 'node-forge' : null
    if (!name) continue
    const dir = path.join(root, relative)
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue // A backend-only installation omits mobile tooling.
    const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version
    const expected = name === 'braces' ? '3.0.3' : '1.4.0'
    if (version !== expected) throw new Error(`Review ${name}@${version} before retiring or updating its security patch`)
    if (name === 'braces') {
      const guardFile = path.join(dir, 'lib/fyimp-depth-guard.js')
      if (fs.existsSync(guardFile) && fs.readFileSync(guardFile, 'utf8') !== depthGuard) throw new Error('Unexpected braces guard contents')
      fs.writeFileSync(guardFile, depthGuard)
      const parse = path.join(dir, 'lib/parse.js')
      replace(parse, '      stack.push(block);', "      if (stack.length >= 128) throw new SyntaxError('Brace pattern exceeds the safe nesting limit');\n      stack.push(block);", 2)
      for (const [filename, opening] of [
        ['compile.js', 'const compile = (ast, options = {}) => {'],
        ['expand.js', 'const expand = (ast, options = {}) => {'],
        ['stringify.js', 'module.exports = (ast, options = {}) => {'],
      ]) replace(path.join(dir, 'lib', filename), opening, opening + "\n  require('./fyimp-depth-guard')(ast);")
    } else {
      replace(path.join(dir, 'lib/rsa.js'), '            obj.value.length !== 2) {',
        "            obj.value.length !== 2 ||\n            obj.value[0].value.length !== (('parameters' in capture) ? 2 : 1) ||\n            (('parameters' in capture) && capture.parameters !== '')) {")
    }
  }
}
module.exports = { applySecurityPatches }
if (require.main === module) applySecurityPatches()
