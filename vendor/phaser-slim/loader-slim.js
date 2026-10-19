/* eslint-disable */
/**
 * Slim Phaser.Loader namespace for Ball Rush — mirrors
 * node_modules/phaser/src/loader/index.js with FileTypes pointed at the
 * reduced set in ./loader-filetypes-slim.js (the game loads no assets).
 * CJS style, matching the phaser src tree.
 */
var CONST = require('phaser/src/loader/const.js')
var Extend = require('phaser/src/utils/object/Extend.js')

var Loader = {
  Events: require('phaser/src/loader/events/index.js'),

  FileTypes: require('./loader-filetypes-slim.js'),

  File: require('phaser/src/loader/File.js'),
  FileTypesManager: require('phaser/src/loader/FileTypesManager.js'),
  GetURL: require('phaser/src/loader/GetURL.js'),
  LoaderPlugin: require('phaser/src/loader/LoaderPlugin.js'),
  MergeXHRSettings: require('phaser/src/loader/MergeXHRSettings.js'),
  MultiFile: require('phaser/src/loader/MultiFile.js'),
  XHRLoader: require('phaser/src/loader/XHRLoader.js'),
  XHRSettings: require('phaser/src/loader/XHRSettings.js')
}

Loader = Extend(false, Loader, CONST)

module.exports = Loader
