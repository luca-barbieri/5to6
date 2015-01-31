"use strict";

var t = require("../../../types");
var traverse = require("../../../traverse");
var core = require('core-js/library');
var Map = core.Map;
var Set = core.Set;
var dataflow = require("../../helpers/dataflow");
var Immutable = require('immutable');
var createLca = require('least-common-ancestor');
var dump = require("../../../debug/dump");

exports.es5to6 = true;

var varsVisitor = {
  enter: function (node, parent, scope, context, state) {
    if (t.isFunction(node)) {
      return context.skip();
    }

    if(t.isVariableDeclaration(node)) {
      var setIds = t.getIdsSafe(node, true, void 0, false, parent);
      for (var k in setIds) {
        var id = scope.get(k, true);
        if (id)
          state.vars.add(id);
      }
    }
  }
};

function ScopeData(node, parentScopeData) {
  this.node = node;
  this.parent = parentScopeData;
  this.children = [];
  if(parentScopeData) {
    parentScopeData.children.push(this);
  }
}

ScopeData.prototype = {};

function setToString(set) {
  return set.map(function(id) {return id.name}).join(", ");
}


var scopeDataVisitor = {
  enter: function (node, parent, scope, context, state) {
    if (t.isScope(node) && !t.isFunction(node))
      state.scopeData = new ScopeData(node, state.scopeData);

    state.nodeToScopeData.set(node, state.scopeData);
    state.nodeToParent.set(node, parent);

    var cfgNode = state.astToCfgNode.get(node);
    if(cfgNode)
      cfgNode.scopeData = state.scopeData;

    if (t.isFunction(node)) {
      return context.skip();
    }
  },
  exit: function (node, parent, scope, context, state) {
    if (t.isScope(node))
      state.scopeData = state.scopeData.parent;
  }
};

// TODO: handle loops, inline conditionals, short circuit, vars captured by a closure, try/catch
var computeVisitor = {
  reverse: true,
  enter: function (node, parent, scope, context, state) {
    var cfgNode = state.astToCfgNode.get(node);

    if (t.isScope(node) && !t.isFunction(node)) {
      var scopeData = state.nodeToScopeData.get(node);
      scopeData.refs = new Map();
      scopeData.defs = new Map();
      scopeData.cfgEntries = [];
      scopeData.cfgExits = [];
      state.scopeData = scopeData;
   }

    if(cfgNode) {
      //console.error("ENTRY")
      //dump(cfgNode.astNode);

      if(cfgNode.prev.some(function(n) {return !n.scopeData || state.scopeDataLca(n.scopeData, state.scopeData) !== state.scopeData;}))
        state.scopeData.cfgEntries.push(cfgNode);
      if(cfgNode.next.some(function(n) {return !n.scopeData || state.scopeDataLca(n.scopeData, state.scopeData) !== state.scopeData;}))
        state.scopeData.cfgExits.push(cfgNode);
    }

    if(state.scopeData.refs) {
      var setIds = t.getIdsSafe(node, true, void 0, true, parent);
      for (var k in setIds) {
        var id = scope.get(k, true);
        if (id && state.vars.has(id)) {
          state.scopeData.refs.set(id, setIds[k]);
          if(!state.scopeData.defs.has(id))
            state.scopeData.defs.set(id, setIds[k]);
        }
      }

      if (t.isReadIdentifier(node, parent)) {
        var id = scope.get(node.name, true);
        if (id && state.vars.has(id))
          state.scopeData.refs.set(id, node);
      }
    }

    if (t.isFunction(node)) {
      var functionCfg = state.cfgs.get(node);
      functionCfg[0].liveIn.forEach(function(k) {
        var id = scope.get(k.name, true);
        if(id && state.vars.has(id))
          state.scopeData.refs.set(id, node);
      });
      functionCfg[1].assignedOut.forEach(function(k) {
        var id = scope.get(k.name, true);
        if(id && state.vars.has(id)) {
          state.scopeData.refs.set(id, node);
          if (!state.scopeData.defs.has(id))
            state.scopeData.defs.set(id, node);
        }
      });
      return context.skip();
    }

    return null;
  },

  exit: function (node, parent, scope, context, state) {
    if (t.isScope(node)) {
      var scopeData = state.scopeData;
      var parentScopeData = scopeData.parent;

      var cfgEntries = scopeData.cfgEntries;
      var cfgExits = scopeData.cfgExits;

      if(cfgEntries.length > 1)
        throw new Error("more than one CFG entry");
      var live;

      var live = Immutable.Set();
      live = live.union.apply(live, cfgEntries.map(function(e) {
          return e.liveIn.intersect(e.assignedIn);
      }));
      live = live.union.apply(live, [].concat.apply([],
        cfgExits.map(function(e) {
            return e.next.filter(function(n) {
              return !n.scopeData || state.scopeDataLca(n.scopeData, scopeData) !== scopeData;
            }).map(function(n) {return n.liveIn;});
          })
      ));

      //dump(cfgEntries[0].astNode);
      //dump(cfgExits[0].astNode);

      /*
      console.error();
      console.error();
      console.error();
      if(cfgEntries.length > 0)
        dump(cfgEntries[0].astNode);
      dump(node);
      if(cfgExits.length > 0)
        dump(cfgExits[0].astNode);
      console.error();
      console.error();
      console.error();
      */

      //console.error("EE: " + cfgEntries.length + " " + cfgExits.length);


      //dump(node);
      //console.error("LIVE: " + setToString(live));
      //console.error(cfgEntries.length + " " + cfgExits.length);

      //console.error();

      var toEmit = new Map();
      var allEmitted = new Set();

      scopeData.refs.forEach(function (ref, id) {
        // !parentScopeData.refs is there because nested function definitions generate uses in the entry node, meaning things are live in all scopes
        //console.error("EMIT " + id.name + " " + cfgEntries.length + " " + cfgExits.length + " " + live.has(id));
        if (!parentScopeData.refs || !live.has(id)) {
          var def = scopeData.defs.get(id);
          var kind = (!def || def === ref) ? "const" : "let";
          toEmit.set(ref, [id, kind]);
        }
      });

      // we can only convert a continuous sequence at the end to lets, because the for statement can only hold one statement/declaration, and we cannot in general swap the order of nodes due to side effects
      // TODO: maybe add support for moving constant assignments up
      if(t.isFor(node)) {
        var key = node.init !== void 0 ? "init" : "left";
        var init = node[key];
        if(init) {
          if(t.isVariableDeclaration(init)) {
            for (var i = init.declarations.length - 1; i >= 0; --i) {
              var decl = init.declarations[i];
              var id = scope.get(decl.id.name, true);
              if(!id || !state.vars.has(id))
                break;
              else if(toEmit.has(decl.id)) {
                allEmitted.add(decl.id);
                state.toLets.set(decl, toEmit.get(decl.id)[1]);
              } else if(decl.init)
                break;
            }
          }
          else {
            var processExpression = function(expr) {
              if(toEmit.has(expr)) {
                allEmitted.add(expr);
                state.toLets.set(expr, toEmit.get(expr)[1]);
                return true;
              } else if(t.isAssignmentExpression(expr) && toEmit.has(expr.left)) {
                allEmitted.add(expr.left);
                state.toLets.set(expr, toEmit.get(expr.left)[1]);
                return true;
              } else if(t.isSequenceExpression(expr)) {
                for (var i = expr.expressions.length - 1; i >= 0; --i) {
                  if(!processExpression(expr.expressions[i]))
                    return false;
                }
              }
              return false;
            };

            processExpression(init);
          }
        }
      }

      toEmit.forEach(function(idkind, ref) {
        var id = idkind[0];
        var kind = idkind[1];
        var emitted = allEmitted.has(ref);

        if(!emitted && (t.isBlockStatement(node) || t.isProgram(node))) {
          var isBlockLevelExpression = function (n) {
            if (!n)
              return false;
            for (;;) {
              n = state.nodeToParent.get(n);
              if (t.isExpressionStatement(n)) {
                var p = state.nodeToParent.get(n);
                return p === node;
              } else if (!t.isSequenceExpression(n)) {
                return false;
              }
            }
          };
          var refP = ref ? state.nodeToParent.get(ref) : null;
          var refPP = refP ? state.nodeToParent.get(refP) : null;
          var refPPP = refPP ? state.nodeToParent.get(refPP) : null;
          if (t.isAssignmentExpression(refP) && refP.operator === "=" && refP.left === ref && isBlockLevelExpression(refP)) {
            state.toLets.set(refP, kind);
            emitted = true;
          }
          else if (isBlockLevelExpression(ref)) {
            state.toLets.set(ref, kind);
            emitted = true;
          }
          else if (refPPP === node && t.isVariableDeclaration(refPP) && t.isVariableDeclarator(refP) && refP.id === ref) {
            state.toLets.set(refP, kind);
            emitted = true;
          }

          if (!emitted) {
            var place = ref;
            var placeParent = state.nodeToParent.get(place);
            while (placeParent !== node) {
              place = placeParent;
              placeParent = state.nodeToParent.get(place);
            }

            var letsBefore = state.letsBefore.get(place) || [];
            letsBefore.push(idkind);
            state.letsBefore.set(place, letsBefore);
            emitted = true;
          }
        }

        if(emitted)
          allEmitted.add(ref);
      });

      scopeData.refs.forEach(function (ref, id) {
        if(!allEmitted.has(ref)) {
          parentScopeData.refs.set(id, ref);
          var def = scopeData.defs.get(id);
          if(def && !parentScopeData.defs.has(id))
            parentScopeData.defs.set(id, def);
        }
      });

      delete scopeData.refs;
      delete scopeData.defs;

      for(var i = 0; i < cfgEntries.length; ++i) {
        var cfgNode = cfgEntries[i];
        if(cfgNode.prev.some(function(prev) {return !prev.scopeData || state.scopeDataLca(prev.scopeData, parentScopeData) !== parentScopeData;}))
          parentScopeData.cfgEntries.push(cfgNode);
      }

      for(var i = 0; i < cfgExits.length; ++i) {
        var cfgNode = cfgExits[i];
        if(cfgNode.next.some(function(next) {return !next.scopeData || state.scopeDataLca(next.scopeData, parentScopeData) !== parentScopeData;}))
          parentScopeData.cfgExits.push(cfgNode);
      }

      delete scopeData.cfgEntries;
      delete scopeData.cfgExits;

      state.scopeData = parentScopeData;
    }
  }
};

function StatementsBuilder(useSequence, reverse) {
  this.useSequence = useSequence;
  this.reverse = reverse;
  this.kind = null;
  this.decls = [];
  this.exprs = [];
  this.statements = [];
  this.numDecls = {};
  this.numExprs = 0;
}

StatementsBuilder.prototype = {
  pushDecl: function(kind, decl) {
    ++this.numDecls;
    if(this.decls.length === 0 || (this.kind && this.kind !== kind))
      this.flush();
    this.kind = kind;
    this.decls.push(decl);
  },
  pushExpr: function(expr) {
    ++this.numExprs;
    if(this.exprs.length === 0)
      this.flush();
    this.exprs.push(expr);
  },
  flush: function() {
    if(this.exprs.length > 0) {
      if(this.useSequence) {
        if (this.reverse)
          this.exprs.reverse()
        this.statements.push(t.expressionStatement(t.sequenceExpression(this.exprs)));
      }
      else {
        for(var i = 0; i < this.exprs.length; ++i)
          this.statements.push(t.expressionStatement(this.exprs[i]));
      }
      this.exprs = [];
    } else if(this.decls.length > 0) {
      if(this.reverse)
        this.decls.reverse();
      this.statements.push(t.variableDeclaration(this.kind, this.decls));
      this.decls = [];
      this.kind = null;
    }
  },
  finish: function() {
    this.flush();
    var r = this.statements.slice(0);
    if(this.reverse)
      r.reverse();
    return r;
  },
  wouldBeFirstDecl: function(kind) {
    return this.statements.length === 0 && this.exprs.length === 0 && (!this.kind || this.kind === kind);
  }
};

function MutationContext(node, scope, state) {
  this.scope = scope;
  this.vars = state.vars;
  this.toLets = state.toLets;
  this.isFor = false;

  this.letsBefore = state.letsBefore.get(node) || [];
  this.letsBeforeMap = new Map(this.letsBefore);
}

MutationContext.prototype = {
  inVars: function(n) {
    var id = this.scope.get(n, true);
    return id && this.vars.has(id);
  },
  toLet: function(n) {
    var kind;
    if(kind = this.toLets.get(n)) {
      this.toLets.delete(n);
      return kind;
    }
    return false;
  },
  takeFromLetsBefore: function(id) {
    if(t.isIdentifier(id)) {
      var id = this.scope.get(id.name, true)
      if(id) {
        var kind = this.letsBeforeMap.get(id);
        if(kind) {
          this.letsBeforeMap.delete(id);
          return kind;
        }
      }
    }

    return null;
  },
  extractLetsBefore: function() {
    var self = this;
    var r = this.letsBefore.filter(function(x) {return self.letsBeforeMap.has(x[0]);});
    this.letsBefore = [];
    this.letsBeforeMap = null;
    return r;
  }
};

// we can take from lets before only for non-first decls, because the first decl is put in the for scope itself, while the "lets before" are for the parent scope
// things other than for don't have letsBefores anyway because we use toLet there
function toLet(node, id, ctx, bld) {
  var kind;
  if(kind = ctx.toLet(node)) {
    if (ctx.isFor && !bld.wouldBeFirstDecl(kind))
      throw new Error("non-first let in for");
    return kind;
  }
  if(kind = ctx.takeFromLetsBefore(id)) {
    if(ctx.isFor) {
      if(bld.wouldBeFirstDecl(kind))
        bld.flush();
      if(bld.wouldBeFirstDecl(kind))
        bld.statements.push(null);
    }
    return kind;
  }
  return null;
}

function addLetsBefore(ctx, bld) {
  var letsBefore = ctx.extractLetsBefore();
  for(var i = 0; i < letsBefore.length; ++i) {
    var lb = letsBefore[i];
    // if the lets-before hasn't been stolen, we must force it to be a let
    bld.pushDecl("let", t.variableDeclarator(lb[0]));
  }
}

function mutateVar(node, ctx) {
  var bld = new StatementsBuilder(false, true);

  for (var i = node.declarations.length - 1; i >= 0; --i) {
    var decl = node.declarations[i];
    var kind;
    if(!ctx.inVars(decl.id.name))
      bld.pushDecl(node.kind, decl);
    else if(kind = toLet(decl, decl.id, ctx, bld))
      bld.pushDecl(kind, decl);
    else if (decl.init)
      bld.pushExpr(t.inherits(t.assignmentExpression("=", decl.id, decl.init), decl));
    else {
      // TODO: do something with potential attached comments?
    }
  }

  addLetsBefore(ctx, bld);
  var s = bld.finish();
  if(s.length === 1 && t.isVariableDeclaration(s[0]) && node.declarations.length === s[0].length) {
    node.kind = s[0].kind;
    return null;
  }
  return s;
}

function mutateExprInto(node, ctx, bld) {
  var kind;
  if (t.isAssignmentExpression(node) && (kind = toLet(node, node.left, ctx, bld)))
    bld.pushDecl(kind, t.inherits(t.variableDeclarator(node.left, node.right), node));
  else if (t.isIdentifier(node) && (kind = toLet(node, node, ctx, bld)))
    bld.pushDecl(kind, t.inherits(t.variableDeclarator(node), node));
  else if(ctx.toLet(node))
    throw new Error("unexpected node type for exprToLet");
  else if(t.isSequenceExpression(node)) {
    for (var i = node.expressions.length - 1; i >= 0; --i) {
      mutateExprInto(node.expressions[i], ctx, bld);
    }
  } else
    bld.pushExpr(node);
}

function mutateExpr(node, useSequence, ctx) {
  if(!t.isExpression(node))
    throw new Error("expected expression");
  var bld = new StatementsBuilder(useSequence, true);
  mutateExprInto(node, ctx, bld);
  if(bld.numDecls === 0)
    return null;
  addLetsBefore(ctx, bld);
  return bld.finish();
}

function mutateFor(node, ctx) {
  var key = node.init !== void 0 ? "init" : "left";
  var init = node[key];
  if(!init)
    return null;

  var saveIsFor = ctx.isFor;
  ctx.isFor = true;
  var replace = t.isVariableDeclaration(init) ? mutateVar(init, ctx) : mutateExpr(init, false, ctx);
  ctx.isFor = saveIsFor;
  if(!replace)
    return null;

  if(replace.length === 0) {
    if(!t.isForStatement(node)) { // preserve variable in for in/of
      if(t.isVariableDeclaration(init))
        node[key] = init.declarations[0].id;
    } else
      node[key] = null;
    return null;
  } else {
    var n = replace[replace.length - 1];
    if(t.isExpressionStatement(n))
      n = n.expression;
    node[key] = n;
    return replace.slice(0, replace.length - 1).concat([node]);
  }
}

function resultToArray(result, node) {
  if (!result)
    result = node;
  if (!Array.isArray(result))
    result = [result];
  return result;
}

// if we have a letsBefore with that variable, "steal it"
var mutateVisitor = {
  enter: function (node, parent, scope, context, state) {
    if (t.isFunction(node)) {
      return context.skip();
    }

    var ctx = new MutationContext(node, scope, state);

    var result;
    if (t.isExpressionStatement(node))
      result = mutateExpr(node.expression, true, ctx);
    else if (t.isVariableDeclaration(node) && (t.isProgram(parent) || t.isBlockStatement(parent)))
      result = mutateVar(node, ctx);
    else if(t.isFor(node))
      result = mutateFor(node, ctx);

    var bld = new StatementsBuilder(true, true);
    addLetsBefore(ctx, bld);
    var letsBefore = bld.finish();
    if(letsBefore.length > 0)
      result = letsBefore.concat(resultToArray(result, node));

    if(Array.isArray(result) && !t.isBlockStatement(parent) && !t.isProgram(parent)) {
      if(result.length == 1)
        result = result[0];
      else
        result = t.toBlock(result, parent);
    }
    return result;
  }
};

exports.Function = function (node, parent, scope, context, file) {
  if(!t.isBlockStatement(node.body))
    return;
  var state = {cfgs: file.cfgs, nodeToParent: new Map(), nodeToScopeData: new Map(), scopeData: new ScopeData(), vars: new Set(), letsBefore: new Map(), toLets: new Map()};
  traverse(node, varsVisitor, scope, state);
  var cfg = file.cfgs.get(node);
  state.astToCfgNode = cfg[3];
  traverse(node, scopeDataVisitor, scope, state);
  state.scopeDataLca = createLca(state.scopeData, function(scopeData) {return scopeData.children;});
  state.scopeData.cfgEntries = [];
  state.scopeData.cfgExits = [];
  traverse(node, computeVisitor, scope, state);
  delete state.scopeData.cfgEntries;
  delete state.scopeData.cfgExits;
  traverse(node, mutateVisitor, scope, state);
  if(state.toLets.size > 0) {
    state.toLets.forEach(function(x) {
      dump(x);
    });
    throw new Error("unable to convert some AST nodes to lets")
  }

  //dump(node);
};

exports.Program = {
  enter: function(node, parent, scope, context, file) {
    file.cfgs = dataflow(node, scope);
  },
  exit: function(node, parent, scope, context, file) {
  }
}
