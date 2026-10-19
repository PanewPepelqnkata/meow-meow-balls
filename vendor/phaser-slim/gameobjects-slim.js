/* eslint-disable */
/**
 * Slim Phaser.GameObjects namespace for Ball Rush.
 *
 * Mirrors node_modules/phaser/src/gameobjects/index.js but drops object
 * types the game never creates (verified by grep over src/ — the game only
 * uses Graphics, Container, Image, Rectangle/Circle shapes and Text):
 * BitmapText/RetroFont, Blitter, DOMElement, Extern, Particles,
 * PathFollower, Rope, TileSprite, Video, Mesh2D, Noise*, lights.
 *
 * Factories/Creators entries for dropped types are omitted so
 * GameObjectFactory stays consistent (add.* methods simply don't exist).
 * The phaser src tree is CJS; this file keeps the same style.
 */
var GameObjects = {
  Events: require('phaser/src/gameobjects/events/index.js'),

  DisplayList: require('phaser/src/gameobjects/DisplayList.js'),
  GameObjectCreator: require('phaser/src/gameobjects/GameObjectCreator.js'),
  GameObjectFactory: require('phaser/src/gameobjects/GameObjectFactory.js'),
  UpdateList: require('phaser/src/gameobjects/UpdateList.js'),

  Components: require('phaser/src/gameobjects/components/index.js'),
  GetCalcMatrix: require('phaser/src/gameobjects/GetCalcMatrix.js'),

  BuildGameObject: require('phaser/src/gameobjects/BuildGameObject.js'),
  BuildGameObjectAnimation: require('phaser/src/gameobjects/BuildGameObjectAnimation.js'),
  GameObject: require('phaser/src/gameobjects/GameObject.js'),
  Container: require('phaser/src/gameobjects/container/Container.js'),
  Graphics: require('phaser/src/gameobjects/graphics/Graphics.js'),
  Group: require('phaser/src/gameobjects/group/Group.js'),
  Image: require('phaser/src/gameobjects/image/Image.js'),
  Layer: require('phaser/src/gameobjects/layer/Layer.js'),
  RenderTexture: require('phaser/src/gameobjects/rendertexture/RenderTexture.js'),
  Sprite: require('phaser/src/gameobjects/sprite/Sprite.js'),
  Stamp: require('phaser/src/gameobjects/stamp/Stamp.js'),

  Text: require('phaser/src/gameobjects/text/Text.js'),
  GetTextSize: require('phaser/src/gameobjects/text/GetTextSize.js'),
  MeasureText: require('phaser/src/gameobjects/text/MeasureText.js'),
  TextStyle: require('phaser/src/gameobjects/text/TextStyle.js'),

  Zone: require('phaser/src/gameobjects/zone/Zone.js'),

  //  Shapes
  Shape: require('phaser/src/gameobjects/shape/Shape.js'),
  Arc: require('phaser/src/gameobjects/shape/arc/Arc.js'),
  Curve: require('phaser/src/gameobjects/shape/curve/Curve.js'),
  Ellipse: require('phaser/src/gameobjects/shape/ellipse/Ellipse.js'),
  Grid: require('phaser/src/gameobjects/shape/grid/Grid.js'),
  IsoBox: require('phaser/src/gameobjects/shape/isobox/IsoBox.js'),
  IsoTriangle: require('phaser/src/gameobjects/shape/isotriangle/IsoTriangle.js'),
  Line: require('phaser/src/gameobjects/shape/line/Line.js'),
  Polygon: require('phaser/src/gameobjects/shape/polygon/Polygon.js'),
  Rectangle: require('phaser/src/gameobjects/shape/rectangle/Rectangle.js'),
  Star: require('phaser/src/gameobjects/shape/star/Star.js'),
  Triangle: require('phaser/src/gameobjects/shape/triangle/Triangle.js'),

  //  Game Object Factories
  Factories: {
    Container: require('phaser/src/gameobjects/container/ContainerFactory.js'),
    Graphics: require('phaser/src/gameobjects/graphics/GraphicsFactory.js'),
    Group: require('phaser/src/gameobjects/group/GroupFactory.js'),
    Image: require('phaser/src/gameobjects/image/ImageFactory.js'),
    Layer: require('phaser/src/gameobjects/layer/LayerFactory.js'),
    RenderTexture: require('phaser/src/gameobjects/rendertexture/RenderTextureFactory.js'),
    Sprite: require('phaser/src/gameobjects/sprite/SpriteFactory.js'),
    Stamp: require('phaser/src/gameobjects/stamp/StampFactory.js'),
    Text: require('phaser/src/gameobjects/text/TextFactory.js'),
    Zone: require('phaser/src/gameobjects/zone/ZoneFactory.js'),

    //  Shapes
    Arc: require('phaser/src/gameobjects/shape/arc/ArcFactory.js'),
    Curve: require('phaser/src/gameobjects/shape/curve/CurveFactory.js'),
    Ellipse: require('phaser/src/gameobjects/shape/ellipse/EllipseFactory.js'),
    Grid: require('phaser/src/gameobjects/shape/grid/GridFactory.js'),
    IsoBox: require('phaser/src/gameobjects/shape/isobox/IsoBoxFactory.js'),
    IsoTriangle: require('phaser/src/gameobjects/shape/isotriangle/IsoTriangleFactory.js'),
    Line: require('phaser/src/gameobjects/shape/line/LineFactory.js'),
    Polygon: require('phaser/src/gameobjects/shape/polygon/PolygonFactory.js'),
    Rectangle: require('phaser/src/gameobjects/shape/rectangle/RectangleFactory.js'),
    Star: require('phaser/src/gameobjects/shape/star/StarFactory.js'),
    Triangle: require('phaser/src/gameobjects/shape/triangle/TriangleFactory.js')
  },

  Creators: {
    Container: require('phaser/src/gameobjects/container/ContainerCreator.js'),
    Graphics: require('phaser/src/gameobjects/graphics/GraphicsCreator.js'),
    Group: require('phaser/src/gameobjects/group/GroupCreator.js'),
    Image: require('phaser/src/gameobjects/image/ImageCreator.js'),
    Layer: require('phaser/src/gameobjects/layer/LayerCreator.js'),
    RenderTexture: require('phaser/src/gameobjects/rendertexture/RenderTextureCreator.js'),
    Sprite: require('phaser/src/gameobjects/sprite/SpriteCreator.js'),
    Stamp: require('phaser/src/gameobjects/stamp/StampCreator.js'),
    Text: require('phaser/src/gameobjects/text/TextCreator.js'),
    Zone: require('phaser/src/gameobjects/zone/ZoneCreator.js')
  }
}

//  WebGL only Game Objects
if (typeof WEBGL_RENDERER) {
  GameObjects.CaptureFrame = require('phaser/src/gameobjects/captureframe/CaptureFrame.js')
  GameObjects.Gradient = require('phaser/src/gameobjects/gradient/Gradient.js')
  GameObjects.Stencil = require('phaser/src/gameobjects/stencil/Stencil.js')
  GameObjects.StencilReference = require('phaser/src/gameobjects/stencilreference/StencilReference.js')

  GameObjects.Factories.CaptureFrame = require('phaser/src/gameobjects/captureframe/CaptureFrameFactory.js')
  GameObjects.Factories.Gradient = require('phaser/src/gameobjects/gradient/GradientFactory.js')
}

module.exports = GameObjects
