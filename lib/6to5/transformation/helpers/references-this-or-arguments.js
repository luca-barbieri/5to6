var traverse = require("../../traverse");
var t = require("../../types");

var referencesThisOrArgumentsVisitor = {
  noScope: true,
  enter: function (node, parent, scope, context, state) {
    if (t.isFunction(node) && node.type !== "ArrowFunctionExpression") {
      return context.skip();
    }

    if (t.isIdentifier(node) && node.name === "arguments") {
    } else if (t.isThisExpression(node)) {
    } else {
      return;
    }

    if (t.isReferenced(node, parent)) {
      state.referencesThisOrArguments = true;
      return context.stop();
    }
  }
};

module.exports = function(func) {
  var state = {referencesThisOrArguments: false};
  traverse(func, referencesThisOrArgumentsVisitor, null, state);
  return state.referencesThisOrArguments;
};
