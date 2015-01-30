function one() {
  var inner = function() { return arguments; }
  return [].slice.call(inner());
}
one(1, 2);

function two() {
  var inner = function() { return arguments; }

  var another = function () {
  var inner2 = function() { return arguments; }
  };

  return [].slice.call(inner());
}
two(1, 2);

function three() {
  var fn = function() { return arguments[0] + "bar"; }
  return fn();
}
three("foo");

function four() {
  var fn = function() { return arguments[0].foo + "bar"; }
  return fn();
}
four({ foo: "foo" });

function five(obj) {
  var fn = function() { return obj.arguments[0].foo + "bar"; }
  return fn();
}
five({ arguments: ["foo"] });

function six(obj) {
  var fn = () => {
    var fn2 = function () {
      return arguments[0];
    };
    return fn2("foobar");
  };
  return fn();
}
six();
