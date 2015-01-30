"use strict";

var nameMethod = require("../../helpers/name-method");
var t          = require("../../../types");
var clone      = require("lodash/lang/clone");
var isString   = require("lodash/lang/isString");

exports.es5to6 = true;

exports.Property = function (node, parent, scope, context, file) {
  if(!node.shorthand && !node.method) {
    var key = t.toComputedKey(node, node.key);
    if(t.isLiteral(key) && t.isValidIdentifier(key.value) && t.isIdentifier(node.value) && node.value.name === key.value) {
      node.key = node.value;
      node.shorthand = true;
      node.computed = false;
    }
  }

  return node;
};
