var Deque = require("double-ended-queue");
var core = require('core-js');
var Map = core.Map;
var nodeToString = require('./node-to-string');
var dump = require('./dump');
var traverse = require('../traverse');

module.exports = dump;

function dumpCfg(cfg) {
  var entry = cfg[0];
  var exit = cfg[1];
  var nodes = cfg[2];

  var cfgIds = new Map();

  var cfgNodeToString  = function(node) {
    var id = cfgIds.get(node);
    if(!id) {
      id = cfgIds.size;
      cfgIds.set(node, id);
    }
    var s = id;
    if(node === entry)
      s += ":entry";
    if(node === exit)
      s += ":exit";
    if(node.astNode)
      s += "@" + nodeToString(node.astNode);
    return s;
  };

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

    console.error(cfgNodeToString(node));
    for (var i = 0; i < node.next.length; ++i) {
      console.error("\t=> " + cfgNodeToString(node.next[i]));
    }

    if(node !== entry && node.astNode) {
      var nextSet = new Set(node.next);
      dump(node.astNode, function (n) {
        return !nextSet.has(n);
      });
    }
    console.error();
  }
}

module.exports = dumpCfg;
