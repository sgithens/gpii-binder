/*

    A Fluid component to launch testem with test coverage instrumentation.

 */
"use strict";
var fluid = require("infusion");
var gpii  = fluid.registerNamespace("gpii");

var path = require("path");
var http = require("http");
var fs = require("fs");
var shell = require("shelljs");
var rimraf = require("rimraf");

fluid.registerNamespace("gpii.test.testem.instrumented");

gpii.test.testem.instrumented.cleanDirs = function (pathStringOrArray) {
    var subdirPaths = fluid.makeArray(pathStringOrArray);
    fluid.each(subdirPaths, function (subdirPath) {
        var fullSubdirPath = path.join(__dirname, subdirPath);
        if (!fs.existsSync(fullSubdirPath)) {
            fs.mkdirSync(fullSubdirPath);
        }
        else {
            var pattern = path.join(fullSubdirPath, "*");
            rimraf(pattern, function (error) {
                if (error) {
                    fluid.fail(error);
                }
            });
        }
    });
};

gpii.test.testem.instrumented.init = function (that, config, data, callback) {
    gpii.test.testem.instrumented.cleanDirs("coverage", "instrumented");

    var instrumentedDir = fluid.module.resolvePath(that.options.instrumentedDir);
    var srcDir          = fluid.module.resolvePath(that.options.sourceDir);
    var coverageDir     = fluid.module.resolvePath(that.options.coverageDir);

    // TODO:  Note, only one source directory is supported at the moment.
    shell.exec("node ./node_modules/istanbul/lib/cli.js instrument --output " + instrumentedDir + " " + srcDir, function (code, output) {
        if (code) {
            callback(code, output);
            return;
        }


        // if instrumented successfully
        // start the server
        that.server = http.createServer(function (req, res) {
            // console.error("... Received coverage of", req.headers["content-length"], "length");
            // need separate files per browser/client
            req.pipe(fs.createWriteStream(path.join(coverageDir, "coverage-" + Math.random() + ".json")));
            // make sure we"ve got it all
            req.on("end", res.end.bind(res));
        }).listen(that.options.coveragePort, function (serverErr) {
            // console.error("------ Listening for coverage on " + port);
            // when server is ready
            // pass control back to testem
            callback(serverErr);
        });
    });
};

gpii.test.testem.instrumented.shutdown = function (that, config, data, callback) {
    if (that.server) {
        // shutdown the server
        that.server.close();

        // generate report
        shell.exec("node ./node_modules/istanbul/lib/cli.js report", function (code, output) {
            if (code) {
                return callback(code, output);
            }

            var coverageDir = fluid.module.resolvePath(that.options.coverageDir);

            // check on generated report
            var lcov = shell.grep("end_of_record", path.join(coverageDir, "lcov.info"));
            var report = shell.grep("src/index.html", path.join(coverageDir, "lcov-report/index.html"));
    
            if (!lcov || !report) {
                callback(new Error("Unable to generate coverage report."));
                return;
            }

            fluid.log("Coverage reports saved to " + coverageDir);
            // everything is good
            callback(null);
        });
        
    }
    else {
        callback(new Error("Cannot shutdown server because it does not exist."));
    }
};

gpii.test.testem.instrumented.resolvePaths = function (pathsToResolve) {
    return fluid.transform(fluid.makeArray(pathsToResolve), fluid.module.resolvePath);
};

fluid.defaults("gpii.test.testem.instrumented", {
    gradeNames: ["fluid.component"],
    coveragePort: 7358,
    sourceDir:       "%gpii-binder/src",
    coverageDir:     "%gpii-binder/coverage",
    instrumentedDir: "%gpii-binder/instrumented",
    sourceFiles:     "%gpii-binder/src/js/*.js",
    serveFiles:      "%gpii-binder/src/js/*.js",
    testemOptions: {
        on_start: "{that}.onStart",
        on_exit:  "{that}.onExit",
        src_files: {
            expander: {
                funcName: "gpii.test.testem.instrumented.resolvePaths",
                args:     ["{that}.options.sourceFiles"]
            }
        },
        test_page: {
            expander: {
                funcName: "gpii.test.testem.instrumented.resolvePaths",
                args:     ["{that}.options.testPages"]
            }
        },
        serve_files: {
            expander: {
                funcName: "gpii.test.testem.instrumented.resolvePaths",
                args:     ["{that}.options.serveFiles"]
            }
        },
        "proxies": {
            "/coverage": {
                "target": {
                    expander: {
                        funcName: "fluid.stringTemplate",
                        args: ["http://localhost:%port", { port: "{that}.options.coveragePort" }]
                    }
                }
            }
        }
    },
    invokers: {
        "onStart": {
            funcName: "gpii.test.testem.instrumented.init",
            args:     ["{that}", "{arguments}.0", "{arguments}.1", "{arguments}.2"] // config, data, callback
        },
        "onExit": {
            funcName: "gpii.test.testem.instrumented.shutdown",
            args:     ["{that}", "{arguments}.0", "{arguments}.1", "{arguments}.2"] // config, data, callback
        }
    }
});