const { test } = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, privateEncrypt, constants, createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const { applySecurityPatches } = require('../scripts/apply-security-patches.cjs')

test('brace operations reject deeply nested input and cyclic ASTs before recursive walking', () => {
  const braces = require('braces')
  const deep = '{'.repeat(1000) + 'a,b' + '}'.repeat(1000)
  for (const operation of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => operation(deep), error => error instanceof SyntaxError && /safe nesting limit/.test(error.message))
  }
  const ast = { type: 'root', nodes: [] }; ast.nodes.push(ast)
  for (const operation of [braces.compile, braces.expand, braces.stringify]) assert.throws(() => operation(ast), SyntaxError)
  assert.deepEqual(braces.expand('a/{b,c}/{1..3}'), ['a/b/1','a/b/2','a/b/3','a/c/1','a/c/2','a/c/3'])
})

test('RSA verification accepts a valid signature and rejects extra nested algorithm elements', () => {
  const forge = require('node-forge')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent: 3 })
  const verifier = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }))
  const asn1 = forge.asn1
  const digest = createHash('sha256').update('synthetic regression message').digest('latin1')
  const node = (type, constructed, value) => asn1.create(asn1.Class.UNIVERSAL, type, constructed, value)
  const signature = extra => {
    const algorithm = [node(asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes()), node(asn1.Type.NULL, false, '')]
    if (extra) algorithm.push(node(asn1.Type.NULL, false, ''))
    const der = asn1.toDer(node(asn1.Type.SEQUENCE, true, [node(asn1.Type.SEQUENCE, true, algorithm), node(asn1.Type.OCTETSTRING, false, digest)])).getBytes()
    return privateEncrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(der, 'latin1')).toString('latin1')
  }
  assert.equal(verifier.verify(digest, signature(false)), true)
  assert.throws(() => verifier.verify(digest, signature(true)), /DigestInfo/)
})

test('query-string uses the patched decoder through its CommonJS contract', { timeout: 3000 }, () => {
  const query = require('query-string')
  assert.equal(query.parse('name=Alice%20Smith').name, 'Alice Smith')
  assert.equal(typeof query.parse('name=' + '%C2'.repeat(5000)).name, 'string')
  const decoder = createRequire(require.resolve('query-string'))('decode-uri-component')
  assert.equal(typeof decoder, 'function')
  assert.equal(decoder('a%20b'), 'a b')
})

test('xcode retains the UUID CommonJS API on the fixed release', () => {
  const uuid = createRequire(require.resolve('xcode'))('uuid')
  assert.equal(uuid.validate(uuid.v4()), true)
})

test('the security patch installer is idempotent', () => {
  applySecurityPatches()
  applySecurityPatches()
})
