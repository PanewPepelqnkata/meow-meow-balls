/* eslint-disable */
/**
 * Slim Phaser.Loader.FileTypes namespace for Ball Rush.
 *
 * The game loads ZERO runtime assets (all art is procedural canvas painting
 * via textures.addCanvas/createCanvas). Mirrors
 * node_modules/phaser/src/loader/filetypes/index.js but keeps only the base
 * XHR file types the LoaderPlugin core references, dropping the typed
 * loaders (Image/JSON/Audio/Tilemap/Video/Binary…), whose only job is to
 * register themselves with FileTypesManager for this.load.* calls.
 * Tilemap loaders in particular pull in the tilemaps/ tree we exclude.
 * CJS style, matching the phaser src tree.
 */
module.exports = {
  BinaryFile: require('phaser/src/loader/filetypes/BinaryFile.js'),
  CSSFile: require('phaser/src/loader/filetypes/CSSFile.js'),
  FontFile: require('phaser/src/loader/filetypes/FontFile.js'),
  GLSLFile: require('phaser/src/loader/filetypes/GLSLFile.js'),
  HTMLFile: require('phaser/src/loader/filetypes/HTMLFile.js'),
  JSONFile: require('phaser/src/loader/filetypes/JSONFile.js'),
  ScriptFile: require('phaser/src/loader/filetypes/ScriptFile.js'),
  TextFile: require('phaser/src/loader/filetypes/TextFile.js'),
  XMLFile: require('phaser/src/loader/filetypes/XMLFile.js')
}
