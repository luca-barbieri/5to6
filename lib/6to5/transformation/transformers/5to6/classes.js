"use strict";

var util          = require("../../../util");
var t             = require("../../../types");
var traverse      = require("../../../traverse");
var referencesThisOrArguments = require("../../helpers/references-this-or-arguments");
var WeakMap = require('core-js/library').WeakMap;

exports.es5to6 = true;

function IdMap() {
  this.map = new WeakMap();
  this.last = 0;
}

IdMap.prototype.get = function(key) {
  var id = self.map.get(key);
  if(!id)
    self.map.set(key, id = ++self.last);
  return id;
}

function internExpression(node, scope, idMap) {
  traverse(node, internVisitor, scope, idMap);
}

function getClassRefId(node, scope) {
  var ref = node;
  var isStatic = true;

  if(t.isMemberExpression(node)) {
    var key = t.toComputedKey(node, node.property);
    if(t.isLiteral(key) && key.value === "prototype") {
      ref = node.object;
      isStatic = false;
    }
  }

  /*
  if(!t.isIdentifier(ref))
    return;

  var id = scope.get(ref.name, true);
  if(!id)
    return;
  */


  t.sideEffectFreeExpressions

  return [id, isStatic];
}

// if we see a method assignment, move it into the class body
function processMethodAssignment(assign, scope, state, isExpressionResultUnused) {
  if(!t.isAssignmentExpression(assign) || assign.operator !== "=")
    return;
  var member = assign.left;
  if(!t.isMemberExpression(member))
    return;

  var idIsStatic = getClassRefId(member.object, scope);
  if(!idIsStatic)
    return;
  var id = idIsStatic[0];
  var isStatic = idIsStatic[1];

  var classCtx = state.classes.get(id);
  if(!classCtx)
    return;

  var key = t.toComputedKey(member, member.property);
  if(classCtx.isMethodBanned(t.isLiteral(key) ? key.value : null, isStatic))
    return;

  var func = assign.right;
  if(t.isFunction(func) && (!t.isArrowFunctionExpression(func) || !referencesThisOrArguments(func))) {
    var method = t.methodDefinition(member.property, func, member.computed, "");
    method.static = isStatic;
    func.type = "FunctionExpression";
    func.id = null;

    var classBody = state.classBodies.get(id);
    if (!classBody) {
      classBody = [];
      state.classBodies.set(id, classBody);
    }

    classBody.push(method);
    if(isExpressionResultUnused())
      return [];

    return node.left;
  } else {
    classCtx.banMethod(t.isLiteral(key) ? key.value : null, isStatic);
    return null;
  }
  return;
}

// note that this doesn't ban methods if we fail, as we rely on assignment being a movement barrier
function processPrototypeAssignment(assign, scope, state, isExpressionResultUnused) {
  if(!t.isAssignmentExpression(assign) || assign.operator !== "=")
    return;

  var left = assign.left;
  var idIsStatic = getClassRefId(left, scope);
  if(!idIsStatic)
    return;
  var id = idIsStatic[0];
  var isStatic = idIsStatic[1];

  if(isStatic)
    return;

  var obj = assign.right;
  if(!t.isObjectExpression(obj))
    return;

  var classCtx = state.classes.get(id);
  if(!classCtx)
    return;

  var classBody = state.classBodies.get(id);
  if(!classBody) {
    classBody = [];
    state.classBodies.set(id, classBody);
  }

  if(classBody && classBody.length > 0)
    return;

  var unconvertible = [];
  for(var i = 0; i < obj.properties.length; ++i) {
    var prop = obj.properties[i];
    var func = prop.value;

    var key = t.toComputedKey(prop, prop.key);
    if(!classCtx.isMethodBanned(t.isLiteral(key) ? key.value : null, isStatic) && t.isFunction(func) && (!t.isArrowFunctionExpression(func) || !referencesThisOrArguments(func)))
    {
      var method = t.methodDefinition(prop.key, func, prop.computed, prop.kind === "init" ? "" : prop.kind);
      method.static = isStatic;
      func.type = "FunctionExpression";
      func.id = null;

      classBody.push(method);
    } else {
      unconvertible.push(prop);
      classCtx.banMethod(t.isLiteral(key) ? key.value : null, isStatic);
    }
  }

  if(unconvertible.length === obj.properties.length)
    return;

  var exprs = [];
  var assignProps = [];
  var lastExprReturnsLeft = false;

  // note that this requires an ES6 runtime
  var getObjectAssign = function() {
    return t.memberExpression(t.identifier("Object"), t.identifier("assign"), false);
  };

  var flush = function() {
    if(assignProps.length > 0) {
      if (!getObjectAssign || assignProps.length === 1) {
        for(var i = 0; i < assignProps.length; ++i) {
          var prop = assignProps[i];
          exprs.push(t.assignmentExpression("=", t.memberExpression(left, prop.key, prop.computed), prop.value));
        }
        lastExprReturnsLeft = false;
      } else {
        exprs.push(t.callExpression(getObjectAssign(), [left, t.objectExpression(assignProps)]));
        lastExprReturnsLeft = true;
      }
      assignProps = [];
    }
  };

  for(var i = 0; i < unconvertible.length; ++i) {
    var prop = unconvertible[i];
    if(prop.kind === "init") {
      assignProps.push(prop);
    }
    else {
      var key = t.toComputedKey(prop, prop.key);
      var objectDefineProperty = t.memberExpression(t.identifier("Object"), t.identifier("defineProperty"), false);
      flush();
      exprs.push(t.callExpression(objectDefineProperty, [left, key, t.objectExpression([t.property("init", t.identifier(prop.kind), prop.value, false)])]));
      lastExprReturnsLeft = false;
    }
  }
  flush();

  if(!lastExprReturnsLeft && !isExpressionResultUnused())
    exprs = exprs.concat([left]);

  if(exprs.length === 0)
    return [];
  if(exprs.length === 1)
    return exprs[0];
  return t.sequenceExpression(exprs);
}

// if we see a method reference, we cannot put a later assignment of the method into the class
function processMethodReference(member, scope, state) {
  if(!t.isMemberExpression(member))
    return;

  var idIsStatic = getClassRefId(member.object, scope);
  if(!idIsStatic)
    return;
  var id = idIsStatic[0];
  var isStatic = idIsStatic[1];

  if(!isStatic && !state.classBodies.has(id))
    state.classBodies.set(id, []);

  var classCtx = state.classes.get(id);
  if(!classCtx)
    return;

  var key = t.toComputedKey(member, member.property);
  classCtx.banMethod(t.isLiteral(key) ? key.value : null, isStatic)
}

// if we see a direct class reference, we cannot put any assignment of methods in the class
function processClassReference(node, parent, scope, state) {
  if(t.isMemberExpression(parent) && parent.left === node)
    return;

  var idIsStatic = getClassRefId(node, scope);
  if(!idIsStatic)
    return;
  var id = idIsStatic[0];
  var isStatic = idIsStatic[1];

  var classCtx = state.classes.get(id);
  if(!classCtx)
    return;

  if(isStatic)
    classCtx.banMethod(null, true);
  classCtx.banMethod(null, false);
}

// if we see a new expression, convert the called function into a class
function processNewExpression(node, scope, state) {
  if(!t.isNewExpression(node))
    return;

  if(!t.isIdentifier(node.callee))
    return;

  var id = scope.get(node.callee.name, true);
  if(!id)
    return;

  if(!state.classBodies.has(id))
    state.classBodies.set(id, []);
}

function isEmptyNode(node) {
  if(t.isBlockStatement(node) && node.body.length === 0)
    return true;
  if(t.isExpressionStatement(node) && (!node.expression || (Array.isArray(node.expression) && node.expression.length === 0)))
    return true;
  if(t.isSequenceExpression(node) && node.expressions.length === 0)
    return true;
  if(t.isVariableDeclaration(node) && node.declarations.length === 0)
    return true;
  return false;
}

function ClassContext(node) {
  // these are set to null to ban all methods
  this.bannedMethods = new Set();
  this.bannedStaticMethods = new Set();
}

ClassContext.prototype = {
  isMethodBanned: function(name, isStatic) {
    var bannedMethods = isStatic ? this.bannedStaticMethods : this.bannedMethods;
    return bannedMethods == null || (name ? bannedMethods.has(name) : bannedMethods.size > 0);
  },
  banMethod: function(name, isStatic) {
    if(name) {
      var bannedMethods = isStatic ? this.bannedStaticMethods : this.bannedMethods;
      if (bannedMethods)
        bannedMethods.add(name);
    } else {
      if(isStatic)
        this.bannedStaticMethods = null;
      else
        this.bannedMethods = null;
    }
  }
};

function getClassId(node, parent) {
  if(t.isFunction(node) && t.isVariableDeclarator(parent) && parent.init === node) {
    if(!t.isArrowFunctionExpression(node) || !referencesThisOrArguments(node))
      return parent.id;
  }

  if(t.isFunctionDeclaration(node))
    return node.id;

  return null;
}

/*
var functionDeclarationsVisitor = {
  enter: function (node, parent, scope, context, state) {
    if(t.isFunctionDeclaration(node)) {
      var classId = getClassId(node, parent);
      if (classId)
        state.classes.set(classId, new ClassContext(node));
    }

    if(t.isFunction(node))
      context.skip();
  }
};
*/

var moveToClassBodiesVisitor = {
  enter: function (node, parent, scope, context, state) {
    function isExpressionResultUnused() {
      return t.isExpressionResultUnused(node, parent, function() {return state.unusedSequenceExpressions.has(parent);});
    }

    if(t.isSequenceExpression(node) && isExpressionResultUnused())
      state.unusedSequenceExpressions.add(node);

    var result = processPrototypeAssignment(node, scope, state, isExpressionResultUnused);
    if(result !== void 0)
      return result;

    var result = processMethodAssignment(node, scope, state, isExpressionResultUnused);
    if(result !== void 0)
      return result;

    processClassReference(node, parent, scope, state);
    processMethodReference(node, scope, state);
    processNewExpression(node, scope, state);

    if(t.isMovementBarrier(node, parent)) {
      state.classes.clear();
    }

    // don't remove nodes that were already empty in the source
    if(isEmptyNode(node))
      return context.skip();

    // TODO: this is unsafe for function declarations, because code before the declaration itself could modify the prototype
    // fixing this would unfortunately require a far more complex analysis
    // BTW, 6to5's class support code is also broken because it doesn't push classes definitions up
    //if(!t.isFunctionDeclaration(node)) {
      var classId = getClassId(node, parent);
      if (classId)
        state.classes.set(classId, new ClassContext(node));
    //}

    if(t.isScope(node) && !t.isBlockStatement(node)) {
      state.classesStack.push(state.classes);
      state.classes = new Map();
    }

    /*
    if((t.isFunctionDeclaration(parent) && node == parent.body) || t.isProgram(node)) {
      traverse(node, functionDeclarationsVisitor, scope, state);
    }
    */
  },
  exit: function (node, parent, scope, context, state) {
    state.unusedSequenceExpressions.delete(node);

    if(t.isScope(node) && !t.isBlockStatement(node)) {
      state.classes = state.classesStack.pop();
    }

    if(isEmptyNode(node)) {
      if (t.isExpressionStatement(parent))
        return null;
      if (t.isBlockStatement(node) && !t.isBlockStatement(parent))
      {} // don't remove empty nodes that would need to be recreated
      else
        return [];
    };

    if(t.isSequenceExpression(node) && node.expressions.length === 1)
      return node.expressions[0];
  }
};

function makeClass(ctor, id, func, state) {
  var classBody = state.classBodies.get(id);
  if(!classBody)
    return null;

  var classId = func.id;

  var constructor = t.methodDefinition(t.identifier("constructor"), func, false, "");
  constructor.static = false;
  func.type = "FunctionExpression";
  func.id = null;

  var body = t.classBody([constructor].concat(classBody));

  var superClass = null;
  return ctor(classId, body, superClass);
}

var createClassesVisitor = {
  exit: function (node, parent, scope, context, state) {
    var classId = getClassId(node, parent);
    if (classId)
      return makeClass(t.isFunctionDeclaration(node) ? t.classDeclaration : t.classExpression, classId, node, state);
  }
};

exports.ast = {
  before: function(ast, file) {
    var state = {classes: new Map(), classesStack: [], unusedSequenceExpressions: new Set(), classBodies: new Map()};
    traverse(file.ast, moveToClassBodiesVisitor, file.scope, state);
    traverse(file.ast, createClassesVisitor, file.scope, state);
  }
}
