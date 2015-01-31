var traverse = require('../traverse/index');
var nodeToString = require('./node-to-string');

var dumpVisitor = {
  noScope: true,
  enter: function (node, parent, scope, context, state) {
    if(state.filter && !state.filter(node))
      return context.skip();

    var s = "";
    for (var i = 0; i < state.depth; ++i)
      s += "\t";
    var e = state.extra ? state.extra(node) : null;
    s += nodeToString(node) + (e ? (" " + e) : "");

    console.error(s);
    state.depth += 1;
  },
  exit: function (node, parent, scope, context, state) {
    state.depth -= 1;
  }
};

function dump(node, filter, extra) {
  var state = {depth: 1, filter: filter, extra: extra};
  console.error(nodeToString(node));
  traverse(node, dumpVisitor, null, state);
}

module.exports = dump;
