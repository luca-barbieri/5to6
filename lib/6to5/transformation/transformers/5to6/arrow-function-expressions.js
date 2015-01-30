"use strict";

var traverse = require("../../../traverse");
var t = require("../../../types");

exports.es5to6 = true;

exports.ArrowFunctionExpression = function (node, parent, scope) {
  if (t.isBlockStatement(node.body) && node.body.body.length == 1 && t.isReturnStatement(node.body.body[0]) && node.body.body[0].argument) {
    node.body = node.body.body[0].argument;
  }

  return node;
};
