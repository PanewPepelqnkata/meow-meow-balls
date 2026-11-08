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

// 3. In GraphicsWebGLRenderer, CLOSE_PATH executes `lastPath.points.push(lastPath.points[0])`
//    without `addPoint()`'s duplicate check, and ARC's final point at `endAngle = 2*PI`
//    has floating-point cos/sin drift (~1e-16) from `startAngle = 0` so `CLOSE_PATH`
//    or `strokePoints(pts, true, true)` creates a zero-length segment (`len === 0`).
//    `DrawLine.run` divides by `len` without checking `len === 0`, producing 4 `NaN`
//    vertices `[NaN, NaN, NaN, NaN]`, and `StrokePath.run` joins the previous real
//    segment and first real segment to those `NaN` vertices! On Mali-G52 (OpenGL ES 2.0),
//    `NaN` in vertex attributes converts to `(0.0, 0.0)` in world space (top-left of the
//    canvas), stretching giant ink/fill triangles from `(0, 0)` to every closed stroke!
var StrokePath = require('phaser/src/renderer/webgl/renderNodes/StrokePath.js')
var origStrokePathRun = StrokePath.prototype.run
StrokePath.prototype.run = function (
  drawingContext,
  submitterNode,
  path,
  lineWidth,
  open,
  currentMatrix,
  tintTL,
  tintTR,
  tintBL,
  tintBR,
  detail,
  lighting
) {
  if (!path || path.length < 2) {
    return
  }
  var epsSq = 1e-12
  var hasDup = false
  for (var i = 1; i < path.length; i++) {
    var dx = path[i].x - path[i - 1].x
    var dy = path[i].y - path[i - 1].y
    if (dx * dx + dy * dy <= epsSq) {
      hasDup = true
      break
    }
  }
  if (hasDup) {
    var clean = [path[0]]
    for (var j = 1; j < path.length; j++) {
      var prev = clean[clean.length - 1]
      var cdx = path[j].x - prev.x
      var cdy = path[j].y - prev.y
      if (cdx * cdx + cdy * cdy > epsSq) {
        clean.push(path[j])
      }
    }
    if (clean.length < 2) {
      return
    }
    path = clean
  }
  origStrokePathRun.call(
    this,
    drawingContext,
    submitterNode,
    path,
    lineWidth,
    open,
    currentMatrix,
    tintTL,
    tintTR,
    tintBL,
    tintBR,
    detail,
    lighting
  )
}

var DrawLine = require('phaser/src/renderer/webgl/renderNodes/DrawLine.js')
DrawLine.prototype.run = function (
  drawingContext,
  currentMatrix,
  ax,
  ay,
  bx,
  by,
  aLineWidth,
  bLineWidth,
  vertices
) {
  this.onRunBegin(drawingContext)
  var dx = bx - ax
  var dy = by - ay
  var len = Math.sqrt(dx * dx + dy * dy)
  var al0 = len > 0 ? (aLineWidth * (by - ay)) / len : 0
  var al1 = len > 0 ? (aLineWidth * (ax - bx)) / len : 0
  var bl0 = len > 0 ? (bLineWidth * (by - ay)) / len : 0
  var bl1 = len > 0 ? (bLineWidth * (ax - bx)) / len : 0
  var lx0 = bx - bl0
  var ly0 = by - bl1
  var lx1 = ax - al0
  var ly1 = ay - al1
  var lx2 = bx + bl0
  var ly2 = by + bl1
  var lx3 = ax + al0
  var ly3 = ay + al1
  var offset = vertices.length
  if (currentMatrix) {
    vertices[offset + 0] = currentMatrix.getX(lx3, ly3)
    vertices[offset + 1] = currentMatrix.getY(lx3, ly3)
    vertices[offset + 2] = currentMatrix.getX(lx1, ly1)
    vertices[offset + 3] = currentMatrix.getY(lx1, ly1)
    vertices[offset + 4] = currentMatrix.getX(lx0, ly0)
    vertices[offset + 5] = currentMatrix.getY(lx0, ly0)
    vertices[offset + 6] = currentMatrix.getX(lx2, ly2)
    vertices[offset + 7] = currentMatrix.getY(lx2, ly2)
  } else {
    vertices[offset + 0] = lx3
    vertices[offset + 1] = ly3
    vertices[offset + 2] = lx1
    vertices[offset + 3] = ly1
    vertices[offset + 4] = lx0
    vertices[offset + 5] = ly0
    vertices[offset + 6] = lx2
    vertices[offset + 7] = ly2
  }
  this.onRunEnd(drawingContext)
}
Phaser = Extend(false, Phaser, CONST)
globalThis.Phaser = Phaser

module.exports = Phaser
