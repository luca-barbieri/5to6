#!/usr/bin/env node

var commander = require("commander");
var transform = require("../../lib/6to5/transformation/transform");
var util = require("../../lib/6to5/util");
var fs = require("fs");
var each = require("lodash/collection/each");
var keys = require("lodash/object/keys");

var index = function(es5to6) {
  commander.option("-t, --source-maps-inline", "Append sourceMappingURL comment to bottom of code");
  commander.option("-s, --source-maps", "Save source map alongside the compiled code");
  commander.option("-f, --filename [filename]", "Filename to use when reading from stdin - this will be used in source-maps, errors etc [stdin]", "stdin");
  commander.option("-w, --watch", "Recompile files on changes");
  commander.option("-e, --experimental", "Enable experimental support for proposed ES7 features");
  commander.option("-p, --playground", "Enable playground support");
  if (es5to6)
    commander.option("-6, --6to5", "Transpile ES6 to ES5 instead of modernizing");
  else
    commander.option("-5, --5to6", "Modernize ES5 to ES6 instead of transpiling");

  commander.option("-m, --modules [modules]", "Module formatter type to use [common]", "common");
  commander.option("-l, --whitelist [whitelist]", "Whitelist of transformers to ONLY use", util.list);
  commander.option("-b, --blacklist [blacklist]", "Blacklist of transformers to NOT use", util.list);
  commander.option("-i, --optional [list]", "List of optional transformers to enable", util.list);
  commander.option("-L, --loose [list]", "List of transformers to enable loose mode ON", util.list);
  commander.option("-o, --out-file [out]", "Compile all input files into a single file");
  commander.option("-d, --out-dir [out]", "Compile an input directory of modules into an output directory");
  commander.option("-c, --remove-comments", "Remove comments from the compiled code", false);
  commander.option("-m, --module-ids", "Insert module id in modules", false);
  commander.option("-R, --react-compat", "Makes the react transformer produce pre-v0.12 code");
  commander.option("--keep-module-id-extensions", "Keep extensions when generating module ids", false);

  commander.on("--help", function () {
    var outKeys = function (title, obj) {
      console.log("  " + title + ":");
      console.log();

      each(keys(obj).sort(), function (key) {
        if (key[0] === "_") return;

        if (obj[key].optional) {
          key = "[" + key + "]";
        }

        console.log("    - " + key);
      });

      console.log();
    };

    outKeys("Transformers", transform.transformers);
    outKeys("Module formatters", transform.moduleFormatters);
  });

  var pkg = require("../../package.json");
  commander.version(pkg.version);
  commander.usage("[options] <files ...>");
  commander.parse(process.argv);

//

  var errors = [];

  var filenames = commander.args;

  each(filenames, function (filename) {
    if (!fs.existsSync(filename)) {
      errors.push(filename + " doesn't exist");
    }
  });

  if (commander.outDir && !filenames.length) {
    errors.push("filenames required for --out-dir");
  }

  if (commander.outFile && commander.outDir) {
    errors.push("cannot have --out-file and --out-dir");
  }

  if (commander.watch) {
    if (!commander.outFile && !commander.outDir) {
      errors.push("--watch requires --out-file or --out-dir");
    }

    if (!filenames.length) {
      errors.push("--watch requires filenames");
    }
  }

  if (commander.sourceMaps) {
    if (!commander.outFile && !commander.outDir) {
      errors.push("--source-maps requires --out-file or --out-dir");
    }
  }

  if (errors.length) {
    console.error(errors.join(". "));
    process.exit(2);
  }

//

  index.opts = {
    keepModuleIdExtensions: commander.keepModuleIdExtensions,
    sourceMapName: commander.outFile,
    es5to6: es5to6 ? !commander["6to5"] : commander["5to6"],
    experimental: commander.experimental,
    reactCompat: commander.reactCompat,
    playground: commander.playground,
    moduleIds: commander.moduleIds,
    blacklist: commander.blacklist,
    whitelist: commander.whitelist,
    sourceMap: commander.sourceMaps || commander.sourceMapsInline,
    optional: commander.optional,
    comments: !commander.removeComments,
    modules: commander.modules,
    loose: commander.loose
  };

  var fn;

  if (commander.outDir) {
    fn = require("./dir");
  } else {
    fn = require("./file");
  }

  fn(commander, filenames, exports.opts);
};

module.exports = index;
