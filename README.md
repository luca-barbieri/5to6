This is a fork of 6to5 that works in reverse, transforming ES5 to ES6.

It requires the esgraph-5to6 project.

It can:
* Introduce arrow functions
* Turn arrow functions into expressions
* Introduce shorthand and method properties
* Introduce classes
* Turn var into let/const using an esgraph-based dataflow analysis

It tries to be correct and not break your code, but this is not guaranteed.

NOTE: this code is experimental and I'm not working on this at the moment, so expect bugs and don't expect new versions
