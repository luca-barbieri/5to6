"use strict";

var traverse = require("../../../traverse");
var t = require("../../../types");
var referencesThisOrArguments = require("../../helpers/references-this-or-arguments");

exports.es5to6 = true;

exports.FunctionExpression = function (node, parent, scope) {
  // method shorthands don't have an arrow form
  if(t.isProperty(parent) && parent.value === node && parent.method)
    return node;

  // we can only transform functions that don't reference this or arguments
  if (!referencesThisOrArguments(node))
    node.type = "ArrowFunctionExpression";

  return node;
};
