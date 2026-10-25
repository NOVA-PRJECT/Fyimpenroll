// query-string uses CommonJS. The patched upstream decoder exports ESM.
const decoder = require('decode-uri-component-modern')
module.exports = decoder.default || decoder
