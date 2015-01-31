var esgraph = require('esgraph');
var Immutable = require('immutable');
var Deque = require("double-ended-queue");
var core = require("core-js");
var Set = core.Set;
var Map = core.Map;
var dump = require('../../debug/dump');
var dumpCfg = require('../../debug/dump-cfg');
var nodeToString = require('../../debug/node-to-string');
var t = require("../../types");
var traverse = require("../../traverse");

function addUse(cfgNode, id) {
  cfgNode.uses = cfgNode.uses.asMutable();
  cfgNode.uses.add(id);
  if(cfgNode.defs.size > 0)
    cfgNode.defs.delete(id);
}

function addDef(cfgNode, id) {
  cfgNode.defs = cfgNode.defs.asMutable();
  cfgNode.defs.add(id);
  if(cfgNode.uses.size > 0)
    cfgNode.uses.delete(id);
}

function addClosureUse(cfgNode, id) {
  cfgNode.closureUses = cfgNode.closureUses.asMutable();
  cfgNode.closureUses.add(id);
}

function addClosureDef(cfgNode, id) {
  cfgNode.closureDefs = cfgNode.closureDefs.asMutable();
  cfgNode.closureDefs.add(id);
}

function addFunctionUsesDefs(cfgNode, node, parent, scope, cfgs) {
  var functionCfg = cfgs.get(node);
  functionCfg[1].assignedOut.forEach(function(id) {
    var ourId = scope.get(id.name, true);
    if(ourId === id) {
      addDef(cfgNode, id);
      addClosureDef(cfgNode, id);
    }
  });
  functionCfg[0].liveIn.forEach(function(id) {
    var ourId = scope.get(id.name, true);
    if(ourId === id) {
      addUse(cfgNode, id);
      addClosureUse(cfgNode, id);
    }
  });
}

var usesDefsVisitor = {
  reverse: true,
  enter: function (node, parent, scope, context, state) {
    // handled separately
    //console.error(node.type);
    //console.error(node._scopeInfo);
    if (t.isFunctionDeclaration(node))
      return context.skip();

    var thisCfgNode = state.astToCfgNode.get(node);
    if(thisCfgNode) {
      state.cfgNodes.push(state.cfgNode);
      state.cfgNode = thisCfgNode;
    }

    var cfgNode = state.cfgNode;

    if(!cfgNode) {
      return;
    }

    if (t.isFunction(node)) {
      addFunctionUsesDefs(cfgNode, node, parent, scope, state.cfgs)
      return context.skip();
    }

    var setIds = t.getIdsSafe(node, true, void 0, true, parent);
    for (var k in setIds) {
      var id = scope.get(k, true);
      if (id)
        addDef(cfgNode, id);
    }

    if(t.isReadIdentifier(node, parent)) {
      var id = scope.get(node.name, true);
      if(id)
        addUse(cfgNode, id);
    }
  },
  exit: function (node, parent, scope, context, state) {
    var cfgNode = state.cfgNode;
    if(cfgNode && cfgNode.astNode === node) {
      state.cfgNode = state.cfgNodes.pop();
    }
  }
};

var usesDefsInNestedFunctionsVisitor = {
  reverse: true,
  enter: function (node, parent, scope, context, state) {
    if (t.isFunctionDeclaration(node)) {
      addFunctionUsesDefs(state.cfgNode, node, parent, scope, state.cfgs);
      return context.skip();
    }
  }
};

function setToString(set) {
  return set.map(function(id) {return id.name}).join(", ");
}

function computeLiveIn(node) {
  var defs = node.defs;
  var uses = node.uses;
  var liveIn = node.liveOut;
  if(false) {
    if (defs)
      liveIn = liveIn.subtract(defs);
    if (uses)
      liveIn = liveIn.union(uses);
  } else if(defs.size > 0 || uses.size > 0) {
    liveIn = liveIn.withMutations(function(s) {
      defs.forEach(function(v) {s.delete(v)});
      uses.forEach(function(v) {s.add(v)});
    });
  }
  return liveIn;
}

function setUnion(sets) {
  if(sets.length == 0)
    return Immutable.Set();
  else if(sets.length == 1)
    return sets[0];
  else
    return sets[0].union.apply(sets[0], sets.slice(1));
}

function setIntersection(sets) {
  if(sets.length == 0)
    throw new Error("zero-sized intersection");
  else if(sets.length == 1)
    return sets[0];
  else
    return sets[0].intersection.apply(sets[0], sets.slice(1));
}

function updateLive(node) {
  if(node.next.length == 0) {
    dump(node.astNode);
    throw new Error("Updating node without successors");
  }

  var liveOut = setUnion(node.next.map(function(n) {return n.liveIn;}));

  if(liveOut.size > node.liveOut.size) {
    node.liveOut = liveOut;

    var liveIn = computeLiveIn(node);
    if(liveIn.size > node.liveIn.size) {
      node.liveIn = liveIn;
      return true;
    }
  }
  return false;
}

function computeAssignedOut(node)
{
  return node.defs.size > 0 ? node.assignedIn.union(node.defs) : node.assignedIn;
}

function updateAssigned(node) {
  if(node.prev.length == 0)
    throw new Error("Updating node without predecessors");

  var assignedIn = setUnion(node.prev.map(function(n) {return n.assignedOut;}));

  if(assignedIn.size > node.assignedIn.size) {
    node.assignedIn = assignedIn;

    var assignedOut = computeAssignedOut(node);
    if(assignedOut.size > node.assignedOut.size) {
      node.assignedOut = assignedOut;
      return true;
    }
  }
  return false;
}

function updateByUnion(key) {
  return function(node) {
    if (node.prev.length == 0) {
      throw new Error("Updating node without predecessors");
    }

    var set = setUnion([node[key]].concat(node.prev.map(function (n) {
      return n[key];
    })));

    if (set.size > node[key].size) {
      node[key] = set;

      return true;
    }
    return false;
  };
}

function NodeQueue() {
  this.queue = new Deque();
  this.set = new Set();
}

NodeQueue.prototype = {}

NodeQueue.prototype.enqueue = function(nodes) {

  if(Array.isArray(nodes)) {
    for (var i = 0; i < nodes.length; ++i) {
      var n = nodes[i];
      this.enqueue(n);
    }
  } else {
    var node = nodes;
    if (!this.set.has(node)) {
      this.queue.enqueue(node);
      this.set.add(node);
    }
  }
};

NodeQueue.prototype.dequeue = function(node) {
  var node = this.queue.dequeue();
  if(node !== void 0)
    this.set.delete(node);
  return node;
}

function analyzeProgramOrFunction(ast, scope, cfgs)
{
  //console.error(ast.type);
  //console.error(ast.id ? ast.id.name : "-");
  var body;
  if(t.isFunction(ast)) {
    body = ast.body;
    //console.error(ast.type);
    if (t.isExpression(body))
      body = t.expressionStatement(body);
    else if (!t.isBlockStatement(body))
      throw new Error("unexpected body node");
  } else
    body = ast;
  var cfg = esgraph(body);
  //dumpCfg(cfg);

  var entry = cfg[0];
  var exit = cfg[1];
  var nodes = cfg[2];
  entry.astNode = null;

  var astToCfgNode = new Map();
  for (var i = 0; i < nodes.length; ++i) {
    var node = nodes[i];
    if (node.astNode)
      astToCfgNode.set(node.astNode, node);
  }
  cfg.push(astToCfgNode);

  var node;
  var emptySet = Immutable.Set();
  // TODO: we should use a priority queue and prioritize nodes in forward/reverse topological order in the dominator tree
  var queue = new NodeQueue();

  for (var i = 0; i < nodes.length; ++i) {
    var node = nodes[i];
    node.defs = node.uses = node.closureDefs = node.closureUses = emptySet;
  }

  traverse(ast, usesDefsVisitor, scope, {cfgs: cfgs, astToCfgNode: astToCfgNode, cfgNodes: [], cfgNode: null});
  traverse(ast, usesDefsInNestedFunctionsVisitor, scope, {cfgs: cfgs, astToCfgNode: astToCfgNode, cfgNode: entry});

  var makeSetImmutable = function(key) {
    for (var i = 0; i < nodes.length; ++i) {
      var node = nodes[i];
      var set = node[key];
      if (set)
        node[key] = set.asImmutable();
    }
  }

  makeSetImmutable('closureDefs');
  makeSetImmutable('closureUses');

  var fixedPoint = function(key, dir, update) {
    for (var i = 0; i < nodes.length; ++i) {
      var node = nodes[i];
      var set = node[key];
      if(set && set.size > 0)
        queue.enqueue(node[dir]);
    }

    while (node = queue.dequeue()) {
      if (update(node))
        queue.enqueue(node[dir]);
    }
  };

  fixedPoint('closureDefs', 'next', updateByUnion('closureDefs'));
  fixedPoint('closureUses', 'next', updateByUnion('closureUses'));

  for (var i = 0; i < nodes.length; ++i) {
    var node = nodes[i];
    node.closureDefs.forEach(function(id) {
      addDef(node, id);
    });
    node.closureUses.forEach(function(id) {
      addUse(node, id);
    });
  }

  makeSetImmutable('defs');
  makeSetImmutable('uses');

  for (var i = 0; i < nodes.length; ++i) {
    var node = nodes[i];
    node.assignedIn = emptySet;
    node.assignedOut = computeAssignedOut(node);
  }

  fixedPoint('assignedOut', 'next', updateAssigned);

  for (var i = 0; i < nodes.length; ++i) {
    var node = nodes[i];
    node.liveOut = emptySet;
    node.liveIn = computeLiveIn(node);
  }

  fixedPoint('liveIn', 'prev', updateLive);

  /*
  dump(ast, null, function(node) {
    var cfgNode = astToCfgNode.get(node);
    if(!cfgNode)
      return;
    var e = "";
    for(var k in cfgNode) {
      var v = cfgNode[k];
      if(v && v.__proto__ === Immutable.Set().__proto__) {
        e = e + " " + k + "=[" + setToString(v) + "]";
      }
    }
    for(var i = 0; i < cfgNode.next.length; ++i) {
      var node = cfgNode.next[i];
      if(node.astNode)
        e += " => " + node.astNode.type;
    }
    for(var i = 0; i < cfgNode.prev.length; ++i) {
      var node = cfgNode.prev[i];
      if(node.astNode)
        e += " <= " + node.astNode.type;
    }
    return e;
  });
  */

  //dumpCfg(cfg);

  return cfg;
}

var analysisVisitor = {
  reverse: true,
  exit: function (node, parent, scope, context, state) {
    if (t.isFunction(node)) {
      state.cfgs.set(node, analyzeProgramOrFunction(node, scope, state.cfgs));
    }
  }
};

// pass in the program
function analyze(node, scope) {
  var cfgs = new Map();
  traverse(node, analysisVisitor, scope, {cfgs: cfgs});
  cfgs.set(node, analyzeProgramOrFunction(node, scope, cfgs));
  return cfgs;
}

module.exports = analyze;
