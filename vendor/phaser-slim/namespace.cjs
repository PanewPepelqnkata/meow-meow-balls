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

// Fix Phaser 4 WebGL1 / Mali-G52 Graphics corruption & bufferSubData stalls:
// 1. In WebGLVAOWrapper.createResource(), Phaser binds the VAO (`this.bind()`)
//    and then calls `this.indexBuffer.bind()`, which relies on
//    `glWrapper.state.bindings.elementArrayBuffer !== this.indexBuffer`.
//    Clearing `state.bindings.elementArrayBuffer` before `this.indexBuffer.bind()`
//    guarantees every newly created VAO records its ELEMENT_ARRAY_BUFFER binding,
//    while leaving `state.bindings.elementArrayBuffer` untouched during normal
//    VAO binds so `WebGLVAOWrapper.createResource()`'s cleanup unbind at the end
//    remains a no-op (never detaching the index buffer from an unbound VAO).
// 2. BatchHandlerTriFlat is the ONLY batch handler that sets `indexBufferDynamic: true`
//    and streams `gl.bufferSubData(ELEMENT_ARRAY_BUFFER)` on a bound VAO every flush,
//    while its `batch()` had a broken `passes[i] !== passID` check that already wrote
//    3 unshared vertices per triangle (0, 1, 2, ...). Use a STATIC_DRAW sequential
//    index buffer (identical to BatchHandlerTri / BatchHandlerQuad) so Graphics
//    never mutates ELEMENT_ARRAY_BUFFER after VAO creation.
var WebGLVAOWrapper = require('phaser/src/renderer/webgl/wrappers/WebGLVAOWrapper.js')
var origVAOCreateResource = WebGLVAOWrapper.prototype.createResource
WebGLVAOWrapper.prototype.createResource = function () {
  this.renderer.glWrapper.state.bindings.elementArrayBuffer = null
  origVAOCreateResource.call(this)
}

var BatchHandlerTriFlat = require('phaser/src/renderer/webgl/renderNodes/BatchHandlerTriFlat.js')
BatchHandlerTriFlat.prototype.defaultConfig.indexBufferDynamic = false
BatchHandlerTriFlat.prototype._generateElementIndices = function (instances) {
  var buffer = new ArrayBuffer(instances * 3 * 2)
  var indices = new Uint16Array(buffer)
  var len = indices.length
  for (var i = 0; i < len; i++) {
    indices[i] = i
  }
  return buffer
}
BatchHandlerTriFlat.prototype.run = function (drawingContext) {
  if (this.instanceCount === 0) {
    return
  }
  this.onRunBegin(drawingContext)
  var programManager = this.programManager
  var programSuite = programManager.getCurrentProgramSuite()
  if (programSuite) {
    var program = programSuite.program
    var vao = programSuite.vao
    this.setupUniforms(drawingContext)
    programManager.applyUniforms(program)
    var indicesPerInstance = this.indicesPerInstance
    var instanceCount = this.instanceCount
    var renderer = this.manager.renderer
    var vertexBuffer = this.vertexBufferLayout.buffer
    var stride = this.vertexBufferLayout.layout.stride
    vertexBuffer.update(this.vertexCount * stride)
    renderer.drawElements(
      drawingContext,
      this._emptyTextures,
      program,
      vao,
      instanceCount * indicesPerInstance,
      0,
      this.topology
    )
  }
  this.instanceCount = 0
  this.vertexCount = 0
  this.onRunEnd(drawingContext)
}
BatchHandlerTriFlat.prototype.batch = function (currentContext, indexes, vertices, colors, lighting) {
  if (this.instanceCount === 0) {
    this.manager.setCurrentBatchNode(this, currentContext)
  }
  this.updateRenderOptions(lighting, currentContext.alphaStrategy)
  if (this._renderOptionsChanged) {
    this.run(currentContext)
    this.updateShaderConfig()
  }
  var instancesPerBatch = this.instancesPerBatch
  var stride = this.vertexBufferLayout.layout.stride
  var verticesPerInstance = this.verticesPerInstance
  var vertexBuffer = this.vertexBufferLayout.buffer
  var vertexViewF32 = vertexBuffer.viewF32
  var vertexViewU32 = vertexBuffer.viewU32
  var floatsPerVertex = stride / vertexViewF32.BYTES_PER_ELEMENT
  var vertexOffset32 = this.vertexCount * floatsPerVertex
  var instanceCompletion = 0
  for (var i = 0; i < indexes.length; i++) {
    var index = indexes[i]
    var vertexIndex = index * 2
    vertexViewF32[vertexOffset32++] = vertices[vertexIndex]
    vertexViewF32[vertexOffset32++] = vertices[vertexIndex + 1]
    vertexViewU32[vertexOffset32++] = colors[index]
    this.vertexCount++
    instanceCompletion++
    if (instanceCompletion === verticesPerInstance) {
      this.instanceCount++
      instanceCompletion = 0
      if (this.instanceCount === instancesPerBatch) {
        this.run(currentContext)
        vertexOffset32 = 0
      }
    }
  }
}
Phaser = Extend(false, Phaser, CONST)
globalThis.Phaser = Phaser

module.exports = Phaser
