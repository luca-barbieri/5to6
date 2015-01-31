var Deque = require("double-ended-queue");
var core = require('core-js');
var Map = core.Map;
var nodeToString = require('./node-to-string');
var dump = require('./dump');
var traverse = require('../traverse');

var cfgNodeToString  = function(cfgIds, node) {
  var id = cfgIds.get(node);
  if(!id) {
    id = cfgIds.size;
    cfgIds.set(node, id);
  }
  var s = id;
  /*
  if(node === entry)
    s += ":entry";
  if(node === exit)
    s += ":exit";
      */
  if(node.astNode)
    s += "@" + nodeToString(node.astNode);
  return s;
}

var dumpCfgVisitor = {
  noScope: true,
  enter: function (node, parent, scope, context, state) {
    if (node.cfg) {
      var s = cfgNodeToString(state.cfgIds, node.cfg);
      for (var i = 0; i < node.cfg.next.length; ++i) {
        if (i > 0)
          s += " ";
        s += cfgNodeToString(state.cfgIds, node.cfg.next[i]);
      }
      console.error(s);
    } else {
      console.error(nodeToString(node));
    }
  }
};

module.exports = dump;

function dumpCfg(cfg) {
  var entry = cfg[0];
  var exit = cfg[1];
  var nodes = cfg[2];

  var cfgIds = new Map();

  for(var i = 0; i < nodes.length; ++i) {
    var node = nodes[i];
    if(node.astNode)
      node.astNode.cfg = node;
  }

  var state = {cfgIds: cfgIds};
  traverse(entry.astNode, dumpCfgVisitor, null, state);

  /*
   var queue = new Deque();
   var queueSet = new Set();

   queue.enqueue(entry);
   queueSet.add(entry);

   while(!queue.isEmpty()) {
    var node = queue.dequeue();
    for (var i = 0; i < node.next.length; ++i) {
      var next = node.next[i];
      if(!queueSet.has(next)) {
        queueSet.add(next);
        queue.enqueue(next);
      }
    }
    var s = cfgNodeToString(node) + " => [";
    for (var i = 0; i < node.next.length; ++i) {
      if (i > 0)
        s += " ";
      s += cfgNodeToString(node.next[i]);
    }
    s += "]";
    console.error(s);
    if(false && node.astNode) {
      var nextSet = new Set(node.next);
      dump(node.astNode, function (n) {
        return !nextSet.has(n);
      });
    }
    console.error();
  }
  */
}

module.exports = dumpCfg;
