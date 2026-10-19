// CJS namespace assembly mirroring node_modules/phaser/src/phaser.js but
// excluding Physics (bundled Matter), Sound, Tilemaps, Curves, DOM,
// Filters — none of which Ball Rush uses. globalThis instead of global for
// browser compatibility under ESM interop.
require('phaser/src/polyfills/requestVideoFrame.js')

var CONST = require('phaser/src/const.js')
var Extend = require('phaser/src/utils/object/Extend.js')

var Phaser = {
  Actions: require('phaser/src/actions/index.js'),
  Animations: require('phaser/src/animations/index.js'),
  BlendModes: require('phaser/src/renderer/BlendModes.js'),
  Cache: require('phaser/src/cache/index.js'),
  Cameras: require('phaser/src/cameras/index.js'),
  Core: require('phaser/src/core/index.js'),
  Class: require('phaser/src/utils/Class.js'),
  Data: require('phaser/src/data/index.js'),
  Display: require('phaser/src/display/index.js'),
  Events: require('phaser/src/events/index.js'),
  Game: require('phaser/src/core/Game.js'),
  GameObjects: require('./gameobjects-slim.js'),
  Geom: require('phaser/src/geom/index.js'),
  Input: require('phaser/src/input/index.js'),
  Loader: require('./loader-slim.js'),
  Math: require('phaser/src/math/index.js'),
  Plugins: require('phaser/src/plugins/index.js'),
  Renderer: require('phaser/src/renderer/index.js'),
  Scale: require('phaser/src/scale/index.js'),
  ScaleModes: require('phaser/src/renderer/ScaleModes.js'),
  Scene: require('phaser/src/scene/Scene.js'),
  Scenes: require('phaser/src/scene/index.js'),
  Structs: require('phaser/src/structs/index.js'),
  Textures: require('phaser/src/textures/index.js'),
  Time: require('phaser/src/time/index.js'),
  TintModes: require('phaser/src/renderer/TintModes.js'),
  Tweens: require('phaser/src/tweens/index.js'),
  Utils: require('phaser/src/utils/index.js')
}

Phaser = Extend(false, Phaser, CONST)
globalThis.Phaser = Phaser

module.exports = Phaser
