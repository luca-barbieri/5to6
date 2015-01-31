var isObject        = require("lodash/lang/isObject");

function nodeToString(node) {
  var n = {};
  for(var p in node)
    n[p] = node[p];

  var s = n.type;
  delete n.type;

  var range = "";
  if(n.start !== null || n.end !== null) {
    range = "\t[" + n.start + ", " + n.end + "]";
    delete n.start;
    delete n.end;
  }

  for(var k in n) {
    var v = n[k];
    if(v !== null && v !== void 0 && !Array.isArray(v) && !isObject(v)) {
      s += " " + k + "=" + v;
    }
  }

  s += range;
  return s;
}

module.exports = nodeToString;
