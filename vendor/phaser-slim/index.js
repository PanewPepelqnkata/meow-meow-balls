// ESM facade over the CJS namespace assembly (vendor package is CJS; the
// bundler converts this file's require/default interop both in dev
// prebundle and build).
var Phaser = require('./namespace.cjs')

module.exports = Phaser
module.exports.default = Phaser
