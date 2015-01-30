"use strict";

var traverse = require("../../../traverse");
var t          = require("../../../types");
var clone      = require("lodash/lang/clone");
var isString   = require("lodash/lang/isString");

exports.es5to6 = true;

function hasFreeReference(node, parent, scope, id)
{
  var visitor = {
    enter: function (node, parent, scope, context, state) {
      // check if this node is an identifier that matches the same as our function id
      if (!t.isIdentifier(node, { name: state.id })) return;

      // check if this node is the one referenced
      if (!t.isReferenced(node, parent)) return;

      // check that we don't have a local variable declared as that removes the need
      // for the wrapper
      var localDeclar = scope.get(state.id, true);
      if (localDeclar !== state.outerDeclar) return;

      state.selfReference = true;
      context.stop();
    }
  };

  var state = {
    id: id,
    selfReference: false,
    outerDeclar: scope.get(id, true),
  };

  traverse(node, visitor, scope, state);

  return state.selfReference;
}

exports.Property = function (node, parent, scope, context, file) {
  // if we have a free reference to super, don't do the transformation
  if(node.method || (!t.isFunctionExpression(node.value) && !t.isArrowFunctionExpression(node.value)) || hasFreeReference(node, parent, scope, "super"))
    return node;

  var key = node.key;
  var keyExpr = t.toComputedKey(node, key);

  // don't destroy function names
  if(node.value.id && (!t.isLiteral(keyExpr) || node.value.id.name != keyExpr.value))
    return node;

  var computed = true;
  if (t.isLiteral(keyExpr) && t.isValidIdentifier(keyExpr.value)) {
    // this transformation introduces an identifier with the same name as the key, so we must use a computed property
    if (!hasFreeReference(node, parent, scope, key.value)) {
      computed = false;
    }
  }

  // don't introduce computed properties for now
  if(computed && !node.computed)
    return node;

  node.method = true;
  if(computed) {
    node.computed = true;
    node.key = keyExpr;
  } else {
    node.computed = false;
    node.key = t.isIdentifier(key) ? key : t.identifier(key.value);
  }

  t.ensureBlock(node.value);

  return node;
};
