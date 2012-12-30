/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.1 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, jQuery, setTimeout, opera */

var requirejs, require, define;
(function(global) {
    var req, s, head, baseElement, dataMain, src, interactiveScript, currentlyAddingScript, mainScript, subPath, version = '2.1.1',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        aps = ap.slice,
        apsp = ap.splice,
        isBrowser = !! (typeof window !== 'undefined' && navigator && document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ? /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */

    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */

    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */

    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */

    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function(value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value !== 'string') {
                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.


    function bind(obj, fn) {
        return function() {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.


    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function(part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */

    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers, checkLoadedTimeoutId, config = {
            waitSeconds: 7,
            baseUrl: './',
            paths: {},
            pkgs: {},
            shim: {},
            map: {},
            config: {}
        },
            registry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */

        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i += 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */

        function normalize(name, baseName, applyMap) {
            var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment, foundMap, foundI, foundStarMap, starI, baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (config.pkgs[baseName]) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        normalizedBaseParts = baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = normalizedBaseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = config.pkgs[(pkgName = name[0])];
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && (baseParts || starMap) && map) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = map[baseParts.slice(0, j).join('/')];

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = mapValue[nameSegment];
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break;
                                }
                            }
                        }
                    }

                    if (foundMap) {
                        break;
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && starMap[nameSegment]) {
                        foundStarMap = starMap[nameSegment];
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function(scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name && scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = config.paths[id];
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                removeScript(id);
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.


        function splitPrefix(name) {
            var prefix, index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */

        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts, prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = defined[prefix];
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function(name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ? '_unnormalized' + (unnormalizedCounter += 1) : '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !! suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ? prefix + '!' + normalizedName : normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = registry[id];

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = registry[id];

            if (hasProp(defined, id) && (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                getModule(depMap).on(name, fn);
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function(id) {
                    var mod = registry[id];
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */

        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue, [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function(mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function(mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function(mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function() {
                            return (config.config && config.config[mod.map.id]) || {};
                        },
                        exports: defined[mod.map.id]
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function(depMap, i) {
                    var depId = depMap.id,
                        dep = registry[depId];

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (traced[depId]) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var map, modId, err, usingPathFallback, waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(registry, function(mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function(mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function() {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function(map) {
            this.events = undefEvents[map.id] || {};
            this.map = map;
            this.shim = config.shim[map.id];
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

/* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function(depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function(err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function(i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function() {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function() {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function() {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks is the module is ready to define itself, and if so,
             * define it.
             */
            check: function() {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule, id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error.
                            if (this.events.error) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule && cjsModule.exports !== undefined &&
                                //Make sure it is not already the exports value
                                cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = [this.map.id];
                                err.requireType = 'define';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        delete registry[id];

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function() {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function(plugin) {
                    var load, normalizedMap, normalizedMod, name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true,
                            skipMap: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function(name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name, this.map.parentMap);
                        on(normalizedMap, 'defined', bind(this, function(value) {
                            this.init([], function() {
                                return value;
                            }, null, {
                                enabled: true,
                                ignore: true
                            });
                        }));

                        normalizedMod = registry[normalizedMap.id];
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function(err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function(value) {
                        this.init([], function() {
                            return value;
                        }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function(err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function(mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function(text, textAlt) { /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        try {
                            req.exec(text);
                        } catch (e) {
                            throw new Error('fromText eval for ' + moduleName + ' failed: ' + e);
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function() {
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function(depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap, (this.map.isDefine ? this.map : this.map.parentMap), false, !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = handlers[depMap.id];

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function(depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', this.errback);
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!handlers[id] && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function(pluginMap) {
                    var mod = registry[pluginMap.id];
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function(name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function(name, evt) {
                each(this.events[name], function(cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */

        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function(cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var pkgs = config.pkgs,
                    shim = config.shim,
                    objs = {
                        paths: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function(value, prop) {
                    if (objs[prop]) {
                        if (prop === 'map') {
                            mixin(config[prop], value, true, true);
                        } else {
                            mixin(config[prop], value, true);
                        }
                    } else {
                        config[prop] = value;
                    }
                });

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function(value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if (value.exports && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function(pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? {
                            name: pkgObj
                        } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main').replace(currDirRegExp, '').replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function(mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function(value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || getGlobal(value.exports);
                }
                return fn;
            },

            makeRequire: function(relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && handlers[deps]) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' + id + '" has not been loaded yet for context: ' + contextName + (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function() {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function(moduleNamePlusExt) {
                        var index = moduleNamePlusExt.lastIndexOf('.'),
                            ext = null;

                        if (index !== -1) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt, relMap && relMap.id, true), ext);
                    },

                    defined: function(id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function(id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function(id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = registry[id];

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. parent module is passed in for context,
             * used by the optimizer.
             */
            enable: function(depMap, parent) {
                var mod = registry[depMap.id];
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function(moduleName) {
                var found, args, mod, shim = config.shim[moduleName] || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = registry[moduleName];

                if (!found && !defined[moduleName] && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine', 'No define call for ' + moduleName, null, [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function(moduleName, ext) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url, parentPath;

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = pkgs[parentModule];
                        parentPath = paths[parentModule];
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/\?/.test(url) ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url + ((url.indexOf('?') === -1 ? '?' : '&') + config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function(id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callack function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function(name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function(evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' || (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function(evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error', evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function(deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config, contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = contexts[contextName];
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function(config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ?
    function(fn) {
        setTimeout(fn, 4);
    } : function(fn) {
        fn();
    };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each(['toUrl', 'undef', 'defined', 'specified'], function(prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function() {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = function(err) {
        throw err;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function(context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = config.xhtml ? document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') : document.createElement('script');
            node.type = config.scriptType || 'text/javascript';
            node.charset = 'utf-8';
            node.async = true;

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
            //Check if node.attachEvent is artificially added by custom script or
            //natively supported by browser
            //read https://github.com/jrburke/requirejs/issues/187
            //if we can NOT find [native code] then it must NOT natively supported.
            //in IE8, node.attachEvent does not have toString()
            //Note the test for "[native code" with no closing brace, see:
            //https://github.com/jrburke/requirejs/issues/273
            !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) && !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEvenListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            //In a web worker, use importScripts. This is not a very
            //efficient use of importScripts, importScripts will block until
            //its script is downloaded and evaluated. However, if web workers
            //are in play, the expectation that a build has been done so that
            //only one script needs to be loaded anyway. This may need to be
            //reevaluated if other use cases become common.
            importScripts(url);

            //Account for anonymous modules
            context.completeLoad(moduleName);
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function(script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function(script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = dataMain.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/') + '/' : './';

                    cfg.baseUrl = subPath;
                    dataMain = mainScript;
                }

                //Strip off any trailing .js since dataMain is now
                //like a module name.
                dataMain = dataMain.replace(jsSuffixRegExp, '');

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(dataMain) : [dataMain];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function(name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = [];
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps.length && isFunction(callback)) {
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback.toString().replace(commentRegExp, '').replace(cjsRequireRegExp, function(match, dep) {
                    deps.push(dep);
                });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function(text) { /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));;this["JST"] = this["JST"] || {};

this["JST"]["app/templates/domain-item.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  var buffer = "", stack1, foundHelper, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\r\n	<a href=\"#\">\r\n		<i class=\"icon-globe\"></i> ";
  foundHelper = helpers.name;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + " (";
  foundHelper = helpers.quantity;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.quantity; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + ")\r\n	</a>\r\n</li>\r\n";
  return buffer;};

this["JST"]["app/templates/folder-dropdown.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  


  return "<li class=\"dropdown categories_drop\">\r\n	<a class=\"dropdown-toggle tip\" data-toggle=\"dropdown\"   href=\"#\"  rel=\"tooltip\" data-placement=\"bottom\" data-original-title=\"Select Folder\">\r\n		<img src=\"../img/white/33-cabinet@2x.png\" class=\"folder\">\r\n	</a>\r\n	\r\n	<div class=\"dropdown-menu category\">\r\n		<div class=\"general-options\">\r\n			<a href=\"#\" class=\"js-clear-search\">\r\n				<i class=\"icon-home\"></i> View all\r\n			</a>\r\n		</div>\r\n\r\n	</ul>\r\n	</div>\r\n</li>\r\n";};

this["JST"]["app/templates/folder-item.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  var buffer = "", stack1, foundHelper, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\r\n	<a href=\"#\">\r\n		<i class=\"icon-folder-close\"></i> ";
  foundHelper = helpers.name;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "\r\n	</a>\r\n</li>\r\n";
  return buffer;};

this["JST"]["app/templates/footer-viewMode.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  


  return "<div class=\"btn-group viewmode\" data-toggle=\"buttons-radio\">\r\n	<button type=\"button\" class=\"btn grid js-changemode\" data-mode=\"grid\">\r\n		<i class=\"icon-th-large\"></i>\r\n		Grid\r\n	</button>\r\n	<button type=\"button\" class=\"btn list js-changemode\" data-mode=\"list\">\r\n		<i class=\"icon-th-list\"></i>\r\n		List\r\n	</button>\r\n</div>";};

this["JST"]["app/templates/footer-zoomLevel.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  


  return "<input type=\"range\"  min=\"0\" max=\"100\" id=\"zoom_level\" value=\"50\" />\r\n";};

this["JST"]["app/templates/footer.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  


  return "<div class=\"navbar-inner\">\r\n	<div class=\"copyright\">\r\n		<a href=\"http://iplanwebsites.com\">\r\n			Made with ♥ by THIN\r\n		</a>\r\n	</div>\r\n	\r\n	<div class=\"alert alert-info html-download span5 pull-left hide\">\r\n		<button type=\"button\" class=\"close stop\" >×</a>\r\n		<div class=\"progress progress-striped active download\">\r\n			<div class=\"bar\" style=\"width: 1%;\"></div>\r\n		</div>\r\n		Indexing websites for full text search ~ <strong>count</strong>\r\n	</div>\r\n	\r\n	<div class=\"alert alert-success html-download-complete span5 pull-left hide\">\r\n		<i class=\"icon-ok\"></i><strong>count</strong> pages indexed!\r\n		<button type=\"button\" class=\"close\" data-dismiss=\"alert\">×</button>\r\n	</div>\r\n</div>\r\n";};

this["JST"]["app/templates/header-typeBtn.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  var buffer = "", stack1, foundHelper, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\r\n	<a href=\"#\" class=\"tip\" rel=\"tooltip\" data-placement=\"bottom\" data-original-title=\"";
  foundHelper = helpers.label;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.label; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + " - ";
  foundHelper = helpers.count;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.count; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "\" >\r\n		<i class=\"";
  foundHelper = helpers.icon;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.icon; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + " icon-white\"></i>\r\n	</a>\r\n</li>\r\n";
  return buffer;};

this["JST"]["app/templates/header.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  


  return "<div class=\"navbar top navbar-inverse navbar-fixed-top\">\r\n	<div class=\"navbar-inner\">\r\n		\r\n		<a href=\"#\" class=\"js-clear-search starlogo tip\" rel=\"tooltip\" data-placement=\"left\" data-original-title=\"All Bookmarks\">\r\n			<img src=\"../img/logo2.png\" >\r\n		</a>\r\n\r\n		<ul class=\"nav pull-right dropdown-section\">\r\n			\r\n		</ul>\r\n	</div>\r\n</div>\r\n";};

this["JST"]["app/templates/options-menu.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  


  return "<li class=\"options\">\r\n	<a class=\"dropdown-toggle tip\" data-toggle=\"dropdown\" href=\"#\" rel=\"tooltip\" data-placement=\"bottom\" data-original-title=\"Add source\">\r\n		<img src=\"../img/white/19-gear@2x.png\" class=\"cog\">\r\n	</a>\r\n\r\n	<ul class=\"dropdown-menu options_menu\">\r\n	\r\n		<li class=\"all_bookmarks\">\r\n			<a href=\"#options\">\r\n				<i class=\"icon-home\"></i> Stats (former option page)\r\n			</a>\r\n		</li>\r\n		\r\n		<li class=\"divider\"></li>\r\n		<li class=\"all_bookmarks\">\r\n			<a href=\"#\" class=\"js-clear-search\">\r\n				<i class=\"icon-home\"></i> View all\r\n			</a>\r\n		</li>\r\n		\r\n		<li class=\"divider\"></li>\r\n		<li>\r\n			<a href=\"#twitter_modal\" role=\"button\" class=\"btn2\" data-toggle=\"modal\" class=\"bt_modal222\">\r\n				<i class=\"icon-star\"></i> Add Twitter\r\n			</a>\r\n		</li>\r\n		<li>\r\n			<a href=\"\">\r\n				<i class=\"icon-retweet\"></i> Add Facebook\r\n			</a>\r\n		</li>\r\n		<li>\r\n			<a href=\"\" class=\"js-add-delicious\">\r\n				<i class=\"icon-th-large\"></i> Add Delicious\r\n			</a>\r\n		</li>\r\n		<li>\r\n			<a href=\"\" >\r\n				<i class=\"icon-th-large\"></i> Add Pinboard\r\n			</a>\r\n		</li>\r\n		\r\n		<li class=\"divider\"></li>\r\n		<li>\r\n			<a href=\"#\">\r\n				<i class=\"icon-info\"></i> About... (modal)\r\n			</a>\r\n		</li>\r\n		\r\n	</ul>\r\n</li>\r\n";};

this["JST"]["app/templates/options-page.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  var buffer = "", stack1, foundHelper, functionType="function", escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = "", stack1, foundHelper;
  buffer += "\r\n			<div class=\"connected\">\r\n				<p>\r\n					<strong class=\"count\">";
  foundHelper = helpers.deliciousCount;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.deliciousCount; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "</strong>\r\n					Delicious bookmarks indexed\r\n				</p>\r\n				<button class=\"btn btn-mini  remove\"><i class=\"icon-trash \"></i>Remove</button>\r\n			</div>\r\n		";
  return buffer;}

function program3(depth0,data) {
  
  
  return "\r\n			<div class=\"start\">\r\n				<p>\r\n					Include your public Delicious bookmarks\r\n				</p>\r\n				<input type=\"text\" class=\"input-medium input search-query\" placeholder=\"userlicious\">\r\n				<button class=\"btn btn-success add\" data-loading-text=\"Importing...\">\r\n					<i class=\"icon-plus icon-white\"></i>\r\n					Add it\r\n				</button>\r\n			</div>\r\n		";}

  buffer += "<div class=\"container\">\r\n	\r\n	<br><br>\r\n	\r\n	<div class=\"well totals span12\">\r\n		\r\n		<h1><strong>";
  foundHelper = helpers.total;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.total; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "</strong> sites and articles</h1>\r\n		<p>Add Tweeted articles and websites</p>\r\n		\r\n	</div>\r\n  \r\n	<div class=\"alert alert-info service chrome span7\">\r\n		<img src=\"../img/chrome logo.png\" class=\"logo pull-left span1\" />\r\n		<h4>Chrome</h4>\r\n		<p>\r\n			<strong class=\"count\">";
  foundHelper = helpers.chromeCount;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.chromeCount; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "</strong>\r\n			browser bookmarks indexed\r\n		</p>\r\n		<button class=\"btn btn-mini refresh\">\r\n			<i class=\"icon-refresh\"></i>\r\n			Refresh\r\n		</button>\r\n	</div>\r\n	\r\n	<p>\r\n		<a target=\"_blank\" id=\"fb_connect\" href=\"";
  foundHelper = helpers.facebookAuthUrl;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.facebookAuthUrl; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "\" class=\"btn btn-primary\">\r\n			<i class=\"icon-user icon-white\"></i>\r\n			Facebook Connect\r\n		</a>\r\n	</p>\r\n	\r\n	<div class=\"alert alert-info service twitter span7\">\r\n		<img src=\"../img/twitter-bird-light-bgs.png\" class=\"logo pull-left span1\" />\r\n		<h4>Twitter</h4>\r\n		<p>Add Tweeted articles and websites</p>\r\n		<form class=\"form-search\">\r\n		<input type=\"text\" class=\"input-medium input search-query\" placeholder=\"@you\">\r\n		<button class=\"btn btn-info add\"><i class=\"icon-plus icon-white\"></i>Add Twitter</button>\r\n		</form>\r\n	</div>\r\n\r\n	<div class=\"alert alert-success service delicious span7\">\r\n		<img src=\"../img/del_logo.png\" class=\"logo pull-left span1\" />\r\n		<h4>Delicious</h4>\r\n		\r\n		";
  stack1 = depth0.delicious_user;
  stack1 = helpers['if'].call(depth0, stack1, {hash:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data)});
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n		\r\n	</div>\r\n  \r\n	<button class=\"btn btn-mini  remove_all\">\r\n		<i class=\"icon-trash \"></i>\r\n		Reset everything\r\n	</button>\r\n	\r\n	config: toggle class \"3dfx\" on body to disable crazy 3d FX\r\n  \r\n</div>";
  return buffer;};

this["JST"]["app/templates/searchBar.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  


  return "<div class=\"input-append search_form\">\r\n	<input id=\"search\"  type=\"search\" placeholder=\"Search\">\r\n	<button class=\"btn btn-success\" type=\"button\">\r\n		<i class=\"icon-search icon-white\"></i>\r\n	</button>\r\n</div>";};

this["JST"]["app/templates/single-bookmark.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  var buffer = "", stack1, foundHelper, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<a href=\"";
  foundHelper = helpers.url;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.url; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "\">\r\n	<div class=\"thumb_wrap\">\r\n		<img src=\"../img/grey_photo.gif\" data-original=\"";
  foundHelper = helpers.thumbnail_url;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.thumbnail_url; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "\" class=\"thumb\" width=\"205\" height=\"154\">\r\n	</div>\r\n	<div class=\"meta\">\r\n		<img src=\"chrome://favicon/";
  foundHelper = helpers.url;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.url; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "\" class=\"favicon\" />\r\n		";
  foundHelper = helpers.title;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.title; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "\r\n		~\r\n		<em class=\"domain\">";
  foundHelper = helpers.domain;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.domain; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "</em>\r\n	</div>\r\n</a>\r\n";
  return buffer;};

this["JST"]["app/templates/source-item.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  helpers = helpers || Handlebars.helpers;
  var buffer = "", stack1, foundHelper, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\r\n	<a href=\"#\">\r\n		<i class=\"";
  foundHelper = helpers.icon;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.icon; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + "\"></i> ";
  foundHelper = helpers.name;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + " (";
  foundHelper = helpers.quantity;
  if (foundHelper) { stack1 = foundHelper.call(depth0, {hash:{}}); }
  else { stack1 = depth0.quantity; stack1 = typeof stack1 === functionType ? stack1() : stack1; }
  buffer += escapeExpression(stack1) + ")\r\n	</a>\r\n</li>\r\n";
  return buffer;};;require.config({waitSeconds:30}),function(e,t){function _(e){var t=M[e]={};return v.each(e.split(y),function(e,n){t[n]=!0}),t}function H(e,n,r){if(r===t&&e.nodeType===1){var i="data-"+n.replace(P,"-$1").toLowerCase();r=e.getAttribute(i);if(typeof r=="string"){try{r=r==="true"?!0:r==="false"?!1:r==="null"?null:+r+""===r?+r:D.test(r)?v.parseJSON(r):r}catch(s){}v.data(e,n,r)}else r=t}return r}function B(e){var t;for(t in e){if(t==="data"&&v.isEmptyObject(e[t]))continue;if(t!=="toJSON")return!1}return!0}function et(){return!1}function tt(){return!0}function ut(e){return!e||!e.parentNode||e.parentNode.nodeType===11}function at(e,t){do e=e[t];while(e&&e.nodeType!==1);return e}function ft(e,t,n){t=t||0;if(v.isFunction(t))return v.grep(e,function(e,r){var i=!!t.call(e,r,e);return i===n});if(t.nodeType)return v.grep(e,function(e,r){return e===t===n});if(typeof t=="string"){var r=v.grep(e,function(e){return e.nodeType===1});if(it.test(t))return v.filter(t,r,!n);t=v.filter(t,r)}return v.grep(e,function(e,r){return v.inArray(e,t)>=0===n})}function lt(e){var t=ct.split("|"),n=e.createDocumentFragment();if(n.createElement)while(t.length)n.createElement(t.pop());return n}function Lt(e,t){return e.getElementsByTagName(t)[0]||e.appendChild(e.ownerDocument.createElement(t))}function At(e,t){if(t.nodeType!==1||!v.hasData(e))return;var n,r,i,s=v._data(e),o=v._data(t,s),u=s.events;if(u){delete o.handle,o.events={};for(n in u)for(r=0,i=u[n].length;r<i;r++)v.event.add(t,n,u[n][r])}o.data&&(o.data=v.extend({},o.data))}function Ot(e,t){var n;if(t.nodeType!==1)return;t.clearAttributes&&t.clearAttributes(),t.mergeAttributes&&t.mergeAttributes(e),n=t.nodeName.toLowerCase(),n==="object"?(t.parentNode&&(t.outerHTML=e.outerHTML),v.support.html5Clone&&e.innerHTML&&!v.trim(t.innerHTML)&&(t.innerHTML=e.innerHTML)):n==="input"&&Et.test(e.type)?(t.defaultChecked=t.checked=e.checked,t.value!==e.value&&(t.value=e.value)):n==="option"?t.selected=e.defaultSelected:n==="input"||n==="textarea"?t.defaultValue=e.defaultValue:n==="script"&&t.text!==e.text&&(t.text=e.text),t.removeAttribute(v.expando)}function Mt(e){return typeof e.getElementsByTagName!="undefined"?e.getElementsByTagName("*"):typeof e.querySelectorAll!="undefined"?e.querySelectorAll("*"):[]}function _t(e){Et.test(e.type)&&(e.defaultChecked=e.checked)}function Qt(e,t){if(t in e)return t;var n=t.charAt(0).toUpperCase()+t.slice(1),r=t,i=Jt.length;while(i--){t=Jt[i]+n;if(t in e)return t}return r}function Gt(e,t){return e=t||e,v.css(e,"display")==="none"||!v.contains(e.ownerDocument,e)}function Yt(e,t){var n,r,i=[],s=0,o=e.length;for(;s<o;s++){n=e[s];if(!n.style)continue;i[s]=v._data(n,"olddisplay"),t?(!i[s]&&n.style.display==="none"&&(n.style.display=""),n.style.display===""&&Gt(n)&&(i[s]=v._data(n,"olddisplay",nn(n.nodeName)))):(r=Dt(n,"display"),!i[s]&&r!=="none"&&v._data(n,"olddisplay",r))}for(s=0;s<o;s++){n=e[s];if(!n.style)continue;if(!t||n.style.display==="none"||n.style.display==="")n.style.display=t?i[s]||"":"none"}return e}function Zt(e,t,n){var r=Rt.exec(t);return r?Math.max(0,r[1]-(n||0))+(r[2]||"px"):t}function en(e,t,n,r){var i=n===(r?"border":"content")?4:t==="width"?1:0,s=0;for(;i<4;i+=2)n==="margin"&&(s+=v.css(e,n+$t[i],!0)),r?(n==="content"&&(s-=parseFloat(Dt(e,"padding"+$t[i]))||0),n!=="margin"&&(s-=parseFloat(Dt(e,"border"+$t[i]+"Width"))||0)):(s+=parseFloat(Dt(e,"padding"+$t[i]))||0,n!=="padding"&&(s+=parseFloat(Dt(e,"border"+$t[i]+"Width"))||0));return s}function tn(e,t,n){var r=t==="width"?e.offsetWidth:e.offsetHeight,i=!0,s=v.support.boxSizing&&v.css(e,"boxSizing")==="border-box";if(r<=0||r==null){r=Dt(e,t);if(r<0||r==null)r=e.style[t];if(Ut.test(r))return r;i=s&&(v.support.boxSizingReliable||r===e.style[t]),r=parseFloat(r)||0}return r+en(e,t,n||(s?"border":"content"),i)+"px"}function nn(e){if(Wt[e])return Wt[e];var t=v("<"+e+">").appendTo(i.body),n=t.css("display");t.remove();if(n==="none"||n===""){Pt=i.body.appendChild(Pt||v.extend(i.createElement("iframe"),{frameBorder:0,width:0,height:0}));if(!Ht||!Pt.createElement)Ht=(Pt.contentWindow||Pt.contentDocument).document,Ht.write("<!doctype html><html><body>"),Ht.close();t=Ht.body.appendChild(Ht.createElement(e)),n=Dt(t,"display"),i.body.removeChild(Pt)}return Wt[e]=n,n}function fn(e,t,n,r){var i;if(v.isArray(t))v.each(t,function(t,i){n||sn.test(e)?r(e,i):fn(e+"["+(typeof i=="object"?t:"")+"]",i,n,r)});else if(!n&&v.type(t)==="object")for(i in t)fn(e+"["+i+"]",t[i],n,r);else r(e,t)}function Cn(e){return function(t,n){typeof t!="string"&&(n=t,t="*");var r,i,s,o=t.toLowerCase().split(y),u=0,a=o.length;if(v.isFunction(n))for(;u<a;u++)r=o[u],s=/^\+/.test(r),s&&(r=r.substr(1)||"*"),i=e[r]=e[r]||[],i[s?"unshift":"push"](n)}}function kn(e,n,r,i,s,o){s=s||n.dataTypes[0],o=o||{},o[s]=!0;var u,a=e[s],f=0,l=a?a.length:0,c=e===Sn;for(;f<l&&(c||!u);f++)u=a[f](n,r,i),typeof u=="string"&&(!c||o[u]?u=t:(n.dataTypes.unshift(u),u=kn(e,n,r,i,u,o)));return(c||!u)&&!o["*"]&&(u=kn(e,n,r,i,"*",o)),u}function Ln(e,n){var r,i,s=v.ajaxSettings.flatOptions||{};for(r in n)n[r]!==t&&((s[r]?e:i||(i={}))[r]=n[r]);i&&v.extend(!0,e,i)}function An(e,n,r){var i,s,o,u,a=e.contents,f=e.dataTypes,l=e.responseFields;for(s in l)s in r&&(n[l[s]]=r[s]);while(f[0]==="*")f.shift(),i===t&&(i=e.mimeType||n.getResponseHeader("content-type"));if(i)for(s in a)if(a[s]&&a[s].test(i)){f.unshift(s);break}if(f[0]in r)o=f[0];else{for(s in r){if(!f[0]||e.converters[s+" "+f[0]]){o=s;break}u||(u=s)}o=o||u}if(o)return o!==f[0]&&f.unshift(o),r[o]}function On(e,t){var n,r,i,s,o=e.dataTypes.slice(),u=o[0],a={},f=0;e.dataFilter&&(t=e.dataFilter(t,e.dataType));if(o[1])for(n in e.converters)a[n.toLowerCase()]=e.converters[n];for(;i=o[++f];)if(i!=="*"){if(u!=="*"&&u!==i){n=a[u+" "+i]||a["* "+i];if(!n)for(r in a){s=r.split(" ");if(s[1]===i){n=a[u+" "+s[0]]||a["* "+s[0]];if(n){n===!0?n=a[r]:a[r]!==!0&&(i=s[0],o.splice(f--,0,i));break}}}if(n!==!0)if(n&&e["throws"])t=n(t);else try{t=n(t)}catch(l){return{state:"parsererror",error:n?l:"No conversion from "+u+" to "+i}}}u=i}return{state:"success",data:t}}function Fn(){try{return new e.XMLHttpRequest}catch(t){}}function In(){try{return new e.ActiveXObject("Microsoft.XMLHTTP")}catch(t){}}function $n(){return setTimeout(function(){qn=t},0),qn=v.now()}function Jn(e,t){v.each(t,function(t,n){var r=(Vn[t]||[]).concat(Vn["*"]),i=0,s=r.length;for(;i<s;i++)if(r[i].call(e,t,n))return})}function Kn(e,t,n){var r,i=0,s=0,o=Xn.length,u=v.Deferred().always(function(){delete a.elem}),a=function(){var t=qn||$n(),n=Math.max(0,f.startTime+f.duration-t),r=n/f.duration||0,i=1-r,s=0,o=f.tweens.length;for(;s<o;s++)f.tweens[s].run(i);return u.notifyWith(e,[f,i,n]),i<1&&o?n:(u.resolveWith(e,[f]),!1)},f=u.promise({elem:e,props:v.extend({},t),opts:v.extend(!0,{specialEasing:{}},n),originalProperties:t,originalOptions:n,startTime:qn||$n(),duration:n.duration,tweens:[],createTween:function(t,n,r){var i=v.Tween(e,f.opts,t,n,f.opts.specialEasing[t]||f.opts.easing);return f.tweens.push(i),i},stop:function(t){var n=0,r=t?f.tweens.length:0;for(;n<r;n++)f.tweens[n].run(1);return t?u.resolveWith(e,[f,t]):u.rejectWith(e,[f,t]),this}}),l=f.props;Qn(l,f.opts.specialEasing);for(;i<o;i++){r=Xn[i].call(f,e,l,f.opts);if(r)return r}return Jn(f,l),v.isFunction(f.opts.start)&&f.opts.start.call(e,f),v.fx.timer(v.extend(a,{anim:f,queue:f.opts.queue,elem:e})),f.progress(f.opts.progress).done(f.opts.done,f.opts.complete).fail(f.opts.fail).always(f.opts.always)}function Qn(e,t){var n,r,i,s,o;for(n in e){r=v.camelCase(n),i=t[r],s=e[n],v.isArray(s)&&(i=s[1],s=e[n]=s[0]),n!==r&&(e[r]=s,delete e[n]),o=v.cssHooks[r];if(o&&"expand"in o){s=o.expand(s),delete e[r];for(n in s)n in e||(e[n]=s[n],t[n]=i)}else t[r]=i}}function Gn(e,t,n){var r,i,s,o,u,a,f,l,c,h=this,p=e.style,d={},m=[],g=e.nodeType&&Gt(e);n.queue||(l=v._queueHooks(e,"fx"),l.unqueued==null&&(l.unqueued=0,c=l.empty.fire,l.empty.fire=function(){l.unqueued||c()}),l.unqueued++,h.always(function(){h.always(function(){l.unqueued--,v.queue(e,"fx").length||l.empty.fire()})})),e.nodeType===1&&("height"in t||"width"in t)&&(n.overflow=[p.overflow,p.overflowX,p.overflowY],v.css(e,"display")==="inline"&&v.css(e,"float")==="none"&&(!v.support.inlineBlockNeedsLayout||nn(e.nodeName)==="inline"?p.display="inline-block":p.zoom=1)),n.overflow&&(p.overflow="hidden",v.support.shrinkWrapBlocks||h.done(function(){p.overflow=n.overflow[0],p.overflowX=n.overflow[1],p.overflowY=n.overflow[2]}));for(r in t){s=t[r];if(Un.exec(s)){delete t[r],a=a||s==="toggle";if(s===(g?"hide":"show"))continue;m.push(r)}}o=m.length;if(o){u=v._data(e,"fxshow")||v._data(e,"fxshow",{}),"hidden"in u&&(g=u.hidden),a&&(u.hidden=!g),g?v(e).show():h.done(function(){v(e).hide()}),h.done(function(){var t;v.removeData(e,"fxshow",!0);for(t in d)v.style(e,t,d[t])});for(r=0;r<o;r++)i=m[r],f=h.createTween(i,g?u[i]:0),d[i]=u[i]||v.style(e,i),i in u||(u[i]=f.start,g&&(f.end=f.start,f.start=i==="width"||i==="height"?1:0))}}function Yn(e,t,n,r,i){return new Yn.prototype.init(e,t,n,r,i)}function Zn(e,t){var n,r={height:e},i=0;t=t?1:0;for(;i<4;i+=2-t)n=$t[i],r["margin"+n]=r["padding"+n]=e;return t&&(r.opacity=r.width=e),r}function tr(e){return v.isWindow(e)?e:e.nodeType===9?e.defaultView||e.parentWindow:!1}var n,r,i=e.document,s=e.location,o=e.navigator,u=e.jQuery,a=e.$,f=Array.prototype.push,l=Array.prototype.slice,c=Array.prototype.indexOf,h=Object.prototype.toString,p=Object.prototype.hasOwnProperty,d=String.prototype.trim,v=function(e,t){return new v.fn.init(e,t,n)},m=/[\-+]?(?:\d*\.|)\d+(?:[eE][\-+]?\d+|)/.source,g=/\S/,y=/\s+/,b=/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,w=/^(?:[^#<]*(<[\w\W]+>)[^>]*$|#([\w\-]*)$)/,E=/^<(\w+)\s*\/?>(?:<\/\1>|)$/,S=/^[\],:{}\s]*$/,x=/(?:^|:|,)(?:\s*\[)+/g,T=/\\(?:["\\\/bfnrt]|u[\da-fA-F]{4})/g,N=/"[^"\\\r\n]*"|true|false|null|-?(?:\d\d*\.|)\d+(?:[eE][\-+]?\d+|)/g,C=/^-ms-/,k=/-([\da-z])/gi,L=function(e,t){return(t+"").toUpperCase()},A=function(){i.addEventListener?(i.removeEventListener("DOMContentLoaded",A,!1),v.ready()):i.readyState==="complete"&&(i.detachEvent("onreadystatechange",A),v.ready())},O={};v.fn=v.prototype={constructor:v,init:function(e,n,r){var s,o,u,a;if(!e)return this;if(e.nodeType)return this.context=this[0]=e,this.length=1,this;if(typeof e=="string"){e.charAt(0)==="<"&&e.charAt(e.length-1)===">"&&e.length>=3?s=[null,e,null]:s=w.exec(e);if(s&&(s[1]||!n)){if(s[1])return n=n instanceof v?n[0]:n,a=n&&n.nodeType?n.ownerDocument||n:i,e=v.parseHTML(s[1],a,!0),E.test(s[1])&&v.isPlainObject(n)&&this.attr.call(e,n,!0),v.merge(this,e);o=i.getElementById(s[2]);if(o&&o.parentNode){if(o.id!==s[2])return r.find(e);this.length=1,this[0]=o}return this.context=i,this.selector=e,this}return!n||n.jquery?(n||r).find(e):this.constructor(n).find(e)}return v.isFunction(e)?r.ready(e):(e.selector!==t&&(this.selector=e.selector,this.context=e.context),v.makeArray(e,this))},selector:"",jquery:"1.8.3",length:0,size:function(){return this.length},toArray:function(){return l.call(this)},get:function(e){return e==null?this.toArray():e<0?this[this.length+e]:this[e]},pushStack:function(e,t,n){var r=v.merge(this.constructor(),e);return r.prevObject=this,r.context=this.context,t==="find"?r.selector=this.selector+(this.selector?" ":"")+n:t&&(r.selector=this.selector+"."+t+"("+n+")"),r},each:function(e,t){return v.each(this,e,t)},ready:function(e){return v.ready.promise().done(e),this},eq:function(e){return e=+e,e===-1?this.slice(e):this.slice(e,e+1)},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},slice:function(){return this.pushStack(l.apply(this,arguments),"slice",l.call(arguments).join(","))},map:function(e){return this.pushStack(v.map(this,function(t,n){return e.call(t,n,t)}))},end:function(){return this.prevObject||this.constructor(null)},push:f,sort:[].sort,splice:[].splice},v.fn.init.prototype=v.fn,v.extend=v.fn.extend=function(){var e,n,r,i,s,o,u=arguments[0]||{},a=1,f=arguments.length,l=!1;typeof u=="boolean"&&(l=u,u=arguments[1]||{},a=2),typeof u!="object"&&!v.isFunction(u)&&(u={}),f===a&&(u=this,--a);for(;a<f;a++)if((e=arguments[a])!=null)for(n in e){r=u[n],i=e[n];if(u===i)continue;l&&i&&(v.isPlainObject(i)||(s=v.isArray(i)))?(s?(s=!1,o=r&&v.isArray(r)?r:[]):o=r&&v.isPlainObject(r)?r:{},u[n]=v.extend(l,o,i)):i!==t&&(u[n]=i)}return u},v.extend({noConflict:function(t){return e.$===v&&(e.$=a),t&&e.jQuery===v&&(e.jQuery=u),v},isReady:!1,readyWait:1,holdReady:function(e){e?v.readyWait++:v.ready(!0)},ready:function(e){if(e===!0?--v.readyWait:v.isReady)return;if(!i.body)return setTimeout(v.ready,1);v.isReady=!0;if(e!==!0&&--v.readyWait>0)return;r.resolveWith(i,[v]),v.fn.trigger&&v(i).trigger("ready").off("ready")},isFunction:function(e){return v.type(e)==="function"},isArray:Array.isArray||function(e){return v.type(e)==="array"},isWindow:function(e){return e!=null&&e==e.window},isNumeric:function(e){return!isNaN(parseFloat(e))&&isFinite(e)},type:function(e){return e==null?String(e):O[h.call(e)]||"object"},isPlainObject:function(e){if(!e||v.type(e)!=="object"||e.nodeType||v.isWindow(e))return!1;try{if(e.constructor&&!p.call(e,"constructor")&&!p.call(e.constructor.prototype,"isPrototypeOf"))return!1}catch(n){return!1}var r;for(r in e);return r===t||p.call(e,r)},isEmptyObject:function(e){var t;for(t in e)return!1;return!0},error:function(e){throw new Error(e)},parseHTML:function(e,t,n){var r;return!e||typeof e!="string"?null:(typeof t=="boolean"&&(n=t,t=0),t=t||i,(r=E.exec(e))?[t.createElement(r[1])]:(r=v.buildFragment([e],t,n?null:[]),v.merge([],(r.cacheable?v.clone(r.fragment):r.fragment).childNodes)))},parseJSON:function(t){if(!t||typeof t!="string")return null;t=v.trim(t);if(e.JSON&&e.JSON.parse)return e.JSON.parse(t);if(S.test(t.replace(T,"@").replace(N,"]").replace(x,"")))return(new Function("return "+t))();v.error("Invalid JSON: "+t)},parseXML:function(n){var r,i;if(!n||typeof n!="string")return null;try{e.DOMParser?(i=new DOMParser,r=i.parseFromString(n,"text/xml")):(r=new ActiveXObject("Microsoft.XMLDOM"),r.async="false",r.loadXML(n))}catch(s){r=t}return(!r||!r.documentElement||r.getElementsByTagName("parsererror").length)&&v.error("Invalid XML: "+n),r},noop:function(){},globalEval:function(t){t&&g.test(t)&&(e.execScript||function(t){e.eval.call(e,t)})(t)},camelCase:function(e){return e.replace(C,"ms-").replace(k,L)},nodeName:function(e,t){return e.nodeName&&e.nodeName.toLowerCase()===t.toLowerCase()},each:function(e,n,r){var i,s=0,o=e.length,u=o===t||v.isFunction(e);if(r){if(u){for(i in e)if(n.apply(e[i],r)===!1)break}else for(;s<o;)if(n.apply(e[s++],r)===!1)break}else if(u){for(i in e)if(n.call(e[i],i,e[i])===!1)break}else for(;s<o;)if(n.call(e[s],s,e[s++])===!1)break;return e},trim:d&&!d.call("﻿ ")?function(e){return e==null?"":d.call(e)}:function(e){return e==null?"":(e+"").replace(b,"")},makeArray:function(e,t){var n,r=t||[];return e!=null&&(n=v.type(e),e.length==null||n==="string"||n==="function"||n==="regexp"||v.isWindow(e)?f.call(r,e):v.merge(r,e)),r},inArray:function(e,t,n){var r;if(t){if(c)return c.call(t,e,n);r=t.length,n=n?n<0?Math.max(0,r+n):n:0;for(;n<r;n++)if(n in t&&t[n]===e)return n}return-1},merge:function(e,n){var r=n.length,i=e.length,s=0;if(typeof r=="number")for(;s<r;s++)e[i++]=n[s];else while(n[s]!==t)e[i++]=n[s++];return e.length=i,e},grep:function(e,t,n){var r,i=[],s=0,o=e.length;n=!!n;for(;s<o;s++)r=!!t(e[s],s),n!==r&&i.push(e[s]);return i},map:function(e,n,r){var i,s,o=[],u=0,a=e.length,f=e instanceof v||a!==t&&typeof a=="number"&&(a>0&&e[0]&&e[a-1]||a===0||v.isArray(e));if(f)for(;u<a;u++)i=n(e[u],u,r),i!=null&&(o[o.length]=i);else for(s in e)i=n(e[s],s,r),i!=null&&(o[o.length]=i);return o.concat.apply([],o)},guid:1,proxy:function(e,n){var r,i,s;return typeof n=="string"&&(r=e[n],n=e,e=r),v.isFunction(e)?(i=l.call(arguments,2),s=function(){return e.apply(n,i.concat(l.call(arguments)))},s.guid=e.guid=e.guid||v.guid++,s):t},access:function(e,n,r,i,s,o,u){var a,f=r==null,l=0,c=e.length;if(r&&typeof r=="object"){for(l in r)v.access(e,n,l,r[l],1,o,i);s=1}else if(i!==t){a=u===t&&v.isFunction(i),f&&(a?(a=n,n=function(e,t,n){return a.call(v(e),n)}):(n.call(e,i),n=null));if(n)for(;l<c;l++)n(e[l],r,a?i.call(e[l],l,n(e[l],r)):i,u);s=1}return s?e:f?n.call(e):c?n(e[0],r):o},now:function(){return(new Date).getTime()}}),v.ready.promise=function(t){if(!r){r=v.Deferred();if(i.readyState==="complete")setTimeout(v.ready,1);else if(i.addEventListener)i.addEventListener("DOMContentLoaded",A,!1),e.addEventListener("load",v.ready,!1);else{i.attachEvent("onreadystatechange",A),e.attachEvent("onload",v.ready);var n=!1;try{n=e.frameElement==null&&i.documentElement}catch(s){}n&&n.doScroll&&function o(){if(!v.isReady){try{n.doScroll("left")}catch(e){return setTimeout(o,50)}v.ready()}}()}}return r.promise(t)},v.each("Boolean Number String Function Array Date RegExp Object".split(" "),function(e,t){O["[object "+t+"]"]=t.toLowerCase()}),n=v(i);var M={};v.Callbacks=function(e){e=typeof e=="string"?M[e]||_(e):v.extend({},e);var n,r,i,s,o,u,a=[],f=!e.once&&[],l=function(t){n=e.memory&&t,r=!0,u=s||0,s=0,o=a.length,i=!0;for(;a&&u<o;u++)if(a[u].apply(t[0],t[1])===!1&&e.stopOnFalse){n=!1;break}i=!1,a&&(f?f.length&&l(f.shift()):n?a=[]:c.disable())},c={add:function(){if(a){var t=a.length;(function r(t){v.each(t,function(t,n){var i=v.type(n);i==="function"?(!e.unique||!c.has(n))&&a.push(n):n&&n.length&&i!=="string"&&r(n)})})(arguments),i?o=a.length:n&&(s=t,l(n))}return this},remove:function(){return a&&v.each(arguments,function(e,t){var n;while((n=v.inArray(t,a,n))>-1)a.splice(n,1),i&&(n<=o&&o--,n<=u&&u--)}),this},has:function(e){return v.inArray(e,a)>-1},empty:function(){return a=[],this},disable:function(){return a=f=n=t,this},disabled:function(){return!a},lock:function(){return f=t,n||c.disable(),this},locked:function(){return!f},fireWith:function(e,t){return t=t||[],t=[e,t.slice?t.slice():t],a&&(!r||f)&&(i?f.push(t):l(t)),this},fire:function(){return c.fireWith(this,arguments),this},fired:function(){return!!r}};return c},v.extend({Deferred:function(e){var t=[["resolve","done",v.Callbacks("once memory"),"resolved"],["reject","fail",v.Callbacks("once memory"),"rejected"],["notify","progress",v.Callbacks("memory")]],n="pending",r={state:function(){return n},always:function(){return i.done(arguments).fail(arguments),this},then:function(){var e=arguments;return v.Deferred(function(n){v.each(t,function(t,r){var s=r[0],o=e[t];i[r[1]](v.isFunction(o)?function(){var e=o.apply(this,arguments);e&&v.isFunction(e.promise)?e.promise().done(n.resolve).fail(n.reject).progress(n.notify):n[s+"With"](this===i?n:this,[e])}:n[s])}),e=null}).promise()},promise:function(e){return e!=null?v.extend(e,r):r}},i={};return r.pipe=r.then,v.each(t,function(e,s){var o=s[2],u=s[3];r[s[1]]=o.add,u&&o.add(function(){n=u},t[e^1][2].disable,t[2][2].lock),i[s[0]]=o.fire,i[s[0]+"With"]=o.fireWith}),r.promise(i),e&&e.call(i,i),i},when:function(e){var t=0,n=l.call(arguments),r=n.length,i=r!==1||e&&v.isFunction(e.promise)?r:0,s=i===1?e:v.Deferred(),o=function(e,t,n){return function(r){t[e]=this,n[e]=arguments.length>1?l.call(arguments):r,n===u?s.notifyWith(t,n):--i||s.resolveWith(t,n)}},u,a,f;if(r>1){u=new Array(r),a=new Array(r),f=new Array(r);for(;t<r;t++)n[t]&&v.isFunction(n[t].promise)?n[t].promise().done(o(t,f,n)).fail(s.reject).progress(o(t,a,u)):--i}return i||s.resolveWith(f,n),s.promise()}}),v.support=function(){var t,n,r,s,o,u,a,f,l,c,h,p=i.createElement("div");p.setAttribute("className","t"),p.innerHTML="  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>",n=p.getElementsByTagName("*"),r=p.getElementsByTagName("a")[0];if(!n||!r||!n.length)return{};s=i.createElement("select"),o=s.appendChild(i.createElement("option")),u=p.getElementsByTagName("input")[0],r.style.cssText="top:1px;float:left;opacity:.5",t={leadingWhitespace:p.firstChild.nodeType===3,tbody:!p.getElementsByTagName("tbody").length,htmlSerialize:!!p.getElementsByTagName("link").length,style:/top/.test(r.getAttribute("style")),hrefNormalized:r.getAttribute("href")==="/a",opacity:/^0.5/.test(r.style.opacity),cssFloat:!!r.style.cssFloat,checkOn:u.value==="on",optSelected:o.selected,getSetAttribute:p.className!=="t",enctype:!!i.createElement("form").enctype,html5Clone:i.createElement("nav").cloneNode(!0).outerHTML!=="<:nav></:nav>",boxModel:i.compatMode==="CSS1Compat",submitBubbles:!0,changeBubbles:!0,focusinBubbles:!1,deleteExpando:!0,noCloneEvent:!0,inlineBlockNeedsLayout:!1,shrinkWrapBlocks:!1,reliableMarginRight:!0,boxSizingReliable:!0,pixelPosition:!1},u.checked=!0,t.noCloneChecked=u.cloneNode(!0).checked,s.disabled=!0,t.optDisabled=!o.disabled;try{delete p.test}catch(d){t.deleteExpando=!1}!p.addEventListener&&p.attachEvent&&p.fireEvent&&(p.attachEvent("onclick",h=function(){t.noCloneEvent=!1}),p.cloneNode(!0).fireEvent("onclick"),p.detachEvent("onclick",h)),u=i.createElement("input"),u.value="t",u.setAttribute("type","radio"),t.radioValue=u.value==="t",u.setAttribute("checked","checked"),u.setAttribute("name","t"),p.appendChild(u),a=i.createDocumentFragment(),a.appendChild(p.lastChild),t.checkClone=a.cloneNode(!0).cloneNode(!0).lastChild.checked,t.appendChecked=u.checked,a.removeChild(u),a.appendChild(p);if(p.attachEvent)for(l in{submit:!0,change:!0,focusin:!0})f="on"+l,c=f in p,c||(p.setAttribute(f,"return;"),c=typeof p[f]=="function"),t[l+"Bubbles"]=c;return v(function(){var n,r,s,o,u="padding:0;margin:0;border:0;display:block;overflow:hidden;",a=i.getElementsByTagName("body")[0];if(!a)return;n=i.createElement("div"),n.style.cssText="visibility:hidden;border:0;width:0;height:0;position:static;top:0;margin-top:1px",a.insertBefore(n,a.firstChild),r=i.createElement("div"),n.appendChild(r),r.innerHTML="<table><tr><td></td><td>t</td></tr></table>",s=r.getElementsByTagName("td"),s[0].style.cssText="padding:0;margin:0;border:0;display:none",c=s[0].offsetHeight===0,s[0].style.display="",s[1].style.display="none",t.reliableHiddenOffsets=c&&s[0].offsetHeight===0,r.innerHTML="",r.style.cssText="box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%;",t.boxSizing=r.offsetWidth===4,t.doesNotIncludeMarginInBodyOffset=a.offsetTop!==1,e.getComputedStyle&&(t.pixelPosition=(e.getComputedStyle(r,null)||{}).top!=="1%",t.boxSizingReliable=(e.getComputedStyle(r,null)||{width:"4px"}).width==="4px",o=i.createElement("div"),o.style.cssText=r.style.cssText=u,o.style.marginRight=o.style.width="0",r.style.width="1px",r.appendChild(o),t.reliableMarginRight=!parseFloat((e.getComputedStyle(o,null)||{}).marginRight)),typeof r.style.zoom!="undefined"&&(r.innerHTML="",r.style.cssText=u+"width:1px;padding:1px;display:inline;zoom:1",t.inlineBlockNeedsLayout=r.offsetWidth===3,r.style.display="block",r.style.overflow="visible",r.innerHTML="<div></div>",r.firstChild.style.width="5px",t.shrinkWrapBlocks=r.offsetWidth!==3,n.style.zoom=1),a.removeChild(n),n=r=s=o=null}),a.removeChild(p),n=r=s=o=u=a=p=null,t}();var D=/(?:\{[\s\S]*\}|\[[\s\S]*\])$/,P=/([A-Z])/g;v.extend({cache:{},deletedIds:[],uuid:0,expando:"jQuery"+(v.fn.jquery+Math.random()).replace(/\D/g,""),noData:{embed:!0,object:"clsid:D27CDB6E-AE6D-11cf-96B8-444553540000",applet:!0},hasData:function(e){return e=e.nodeType?v.cache[e[v.expando]]:e[v.expando],!!e&&!B(e)},data:function(e,n,r,i){if(!v.acceptData(e))return;var s,o,u=v.expando,a=typeof n=="string",f=e.nodeType,l=f?v.cache:e,c=f?e[u]:e[u]&&u;if((!c||!l[c]||!i&&!l[c].data)&&a&&r===t)return;c||(f?e[u]=c=v.deletedIds.pop()||v.guid++:c=u),l[c]||(l[c]={},f||(l[c].toJSON=v.noop));if(typeof n=="object"||typeof n=="function")i?l[c]=v.extend(l[c],n):l[c].data=v.extend(l[c].data,n);return s=l[c],i||(s.data||(s.data={}),s=s.data),r!==t&&(s[v.camelCase(n)]=r),a?(o=s[n],o==null&&(o=s[v.camelCase(n)])):o=s,o},removeData:function(e,t,n){if(!v.acceptData(e))return;var r,i,s,o=e.nodeType,u=o?v.cache:e,a=o?e[v.expando]:v.expando;if(!u[a])return;if(t){r=n?u[a]:u[a].data;if(r){v.isArray(t)||(t in r?t=[t]:(t=v.camelCase(t),t in r?t=[t]:t=t.split(" ")));for(i=0,s=t.length;i<s;i++)delete r[t[i]];if(!(n?B:v.isEmptyObject)(r))return}}if(!n){delete u[a].data;if(!B(u[a]))return}o?v.cleanData([e],!0):v.support.deleteExpando||u!=u.window?delete u[a]:u[a]=null},_data:function(e,t,n){return v.data(e,t,n,!0)},acceptData:function(e){var t=e.nodeName&&v.noData[e.nodeName.toLowerCase()];return!t||t!==!0&&e.getAttribute("classid")===t}}),v.fn.extend({data:function(e,n){var r,i,s,o,u,a=this[0],f=0,l=null;if(e===t){if(this.length){l=v.data(a);if(a.nodeType===1&&!v._data(a,"parsedAttrs")){s=a.attributes;for(u=s.length;f<u;f++)o=s[f].name,o.indexOf("data-")||(o=v.camelCase(o.substring(5)),H(a,o,l[o]));v._data(a,"parsedAttrs",!0)}}return l}return typeof e=="object"?this.each(function(){v.data(this,e)}):(r=e.split(".",2),r[1]=r[1]?"."+r[1]:"",i=r[1]+"!",v.access(this,function(n){if(n===t)return l=this.triggerHandler("getData"+i,[r[0]]),l===t&&a&&(l=v.data(a,e),l=H(a,e,l)),l===t&&r[1]?this.data(r[0]):l;r[1]=n,this.each(function(){var t=v(this);t.triggerHandler("setData"+i,r),v.data(this,e,n),t.triggerHandler("changeData"+i,r)})},null,n,arguments.length>1,null,!1))},removeData:function(e){return this.each(function(){v.removeData(this,e)})}}),v.extend({queue:function(e,t,n){var r;if(e)return t=(t||"fx")+"queue",r=v._data(e,t),n&&(!r||v.isArray(n)?r=v._data(e,t,v.makeArray(n)):r.push(n)),r||[]},dequeue:function(e,t){t=t||"fx";var n=v.queue(e,t),r=n.length,i=n.shift(),s=v._queueHooks(e,t),o=function(){v.dequeue(e,t)};i==="inprogress"&&(i=n.shift(),r--),i&&(t==="fx"&&n.unshift("inprogress"),delete s.stop,i.call(e,o,s)),!r&&s&&s.empty.fire()},_queueHooks:function(e,t){var n=t+"queueHooks";return v._data(e,n)||v._data(e,n,{empty:v.Callbacks("once memory").add(function(){v.removeData(e,t+"queue",!0),v.removeData(e,n,!0)})})}}),v.fn.extend({queue:function(e,n){var r=2;return typeof e!="string"&&(n=e,e="fx",r--),arguments.length<r?v.queue(this[0],e):n===t?this:this.each(function(){var t=v.queue(this,e,n);v._queueHooks(this,e),e==="fx"&&t[0]!=="inprogress"&&v.dequeue(this,e)})},dequeue:function(e){return this.each(function(){v.dequeue(this,e)})},delay:function(e,t){return e=v.fx?v.fx.speeds[e]||e:e,t=t||"fx",this.queue(t,function(t,n){var r=setTimeout(t,e);n.stop=function(){clearTimeout(r)}})},clearQueue:function(e){return this.queue(e||"fx",[])},promise:function(e,n){var r,i=1,s=v.Deferred(),o=this,u=this.length,a=function(){--i||s.resolveWith(o,[o])};typeof e!="string"&&(n=e,e=t),e=e||"fx";while(u--)r=v._data(o[u],e+"queueHooks"),r&&r.empty&&(i++,r.empty.add(a));return a(),s.promise(n)}});var j,F,I,q=/[\t\r\n]/g,R=/\r/g,U=/^(?:button|input)$/i,z=/^(?:button|input|object|select|textarea)$/i,W=/^a(?:rea|)$/i,X=/^(?:autofocus|autoplay|async|checked|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped|selected)$/i,V=v.support.getSetAttribute;v.fn.extend({attr:function(e,t){return v.access(this,v.attr,e,t,arguments.length>1)},removeAttr:function(e){return this.each(function(){v.removeAttr(this,e)})},prop:function(e,t){return v.access(this,v.prop,e,t,arguments.length>1)},removeProp:function(e){return e=v.propFix[e]||e,this.each(function(){try{this[e]=t,delete this[e]}catch(n){}})},addClass:function(e){var t,n,r,i,s,o,u;if(v.isFunction(e))return this.each(function(t){v(this).addClass(e.call(this,t,this.className))});if(e&&typeof e=="string"){t=e.split(y);for(n=0,r=this.length;n<r;n++){i=this[n];if(i.nodeType===1)if(!i.className&&t.length===1)i.className=e;else{s=" "+i.className+" ";for(o=0,u=t.length;o<u;o++)s.indexOf(" "+t[o]+" ")<0&&(s+=t[o]+" ");i.className=v.trim(s)}}}return this},removeClass:function(e){var n,r,i,s,o,u,a;if(v.isFunction(e))return this.each(function(t){v(this).removeClass(e.call(this,t,this.className))});if(e&&typeof e=="string"||e===t){n=(e||"").split(y);for(u=0,a=this.length;u<a;u++){i=this[u];if(i.nodeType===1&&i.className){r=(" "+i.className+" ").replace(q," ");for(s=0,o=n.length;s<o;s++)while(r.indexOf(" "+n[s]+" ")>=0)r=r.replace(" "+n[s]+" "," ");i.className=e?v.trim(r):""}}}return this},toggleClass:function(e,t){var n=typeof e,r=typeof t=="boolean";return v.isFunction(e)?this.each(function(n){v(this).toggleClass(e.call(this,n,this.className,t),t)}):this.each(function(){if(n==="string"){var i,s=0,o=v(this),u=t,a=e.split(y);while(i=a[s++])u=r?u:!o.hasClass(i),o[u?"addClass":"removeClass"](i)}else if(n==="undefined"||n==="boolean")this.className&&v._data(this,"__className__",this.className),this.className=this.className||e===!1?"":v._data(this,"__className__")||""})},hasClass:function(e){var t=" "+e+" ",n=0,r=this.length;for(;n<r;n++)if(this[n].nodeType===1&&(" "+this[n].className+" ").replace(q," ").indexOf(t)>=0)return!0;return!1},val:function(e){var n,r,i,s=this[0];if(!arguments.length){if(s)return n=v.valHooks[s.type]||v.valHooks[s.nodeName.toLowerCase()],n&&"get"in n&&(r=n.get(s,"value"))!==t?r:(r=s.value,typeof r=="string"?r.replace(R,""):r==null?"":r);return}return i=v.isFunction(e),this.each(function(r){var s,o=v(this);if(this.nodeType!==1)return;i?s=e.call(this,r,o.val()):s=e,s==null?s="":typeof s=="number"?s+="":v.isArray(s)&&(s=v.map(s,function(e){return e==null?"":e+""})),n=v.valHooks[this.type]||v.valHooks[this.nodeName.toLowerCase()];if(!n||!("set"in n)||n.set(this,s,"value")===t)this.value=s})}}),v.extend({valHooks:{option:{get:function(e){var t=e.attributes.value;return!t||t.specified?e.value:e.text}},select:{get:function(e){var t,n,r=e.options,i=e.selectedIndex,s=e.type==="select-one"||i<0,o=s?null:[],u=s?i+1:r.length,a=i<0?u:s?i:0;for(;a<u;a++){n=r[a];if((n.selected||a===i)&&(v.support.optDisabled?!n.disabled:n.getAttribute("disabled")===null)&&(!n.parentNode.disabled||!v.nodeName(n.parentNode,"optgroup"))){t=v(n).val();if(s)return t;o.push(t)}}return o},set:function(e,t){var n=v.makeArray(t);return v(e).find("option").each(function(){this.selected=v.inArray(v(this).val(),n)>=0}),n.length||(e.selectedIndex=-1),n}}},attrFn:{},attr:function(e,n,r,i){var s,o,u,a=e.nodeType;if(!e||a===3||a===8||a===2)return;if(i&&v.isFunction(v.fn[n]))return v(e)[n](r);if(typeof e.getAttribute=="undefined")return v.prop(e,n,r);u=a!==1||!v.isXMLDoc(e),u&&(n=n.toLowerCase(),o=v.attrHooks[n]||(X.test(n)?F:j));if(r!==t){if(r===null){v.removeAttr(e,n);return}return o&&"set"in o&&u&&(s=o.set(e,r,n))!==t?s:(e.setAttribute(n,r+""),r)}return o&&"get"in o&&u&&(s=o.get(e,n))!==null?s:(s=e.getAttribute(n),s===null?t:s)},removeAttr:function(e,t){var n,r,i,s,o=0;if(t&&e.nodeType===1){r=t.split(y);for(;o<r.length;o++)i=r[o],i&&(n=v.propFix[i]||i,s=X.test(i),s||v.attr(e,i,""),e.removeAttribute(V?i:n),s&&n in e&&(e[n]=!1))}},attrHooks:{type:{set:function(e,t){if(U.test(e.nodeName)&&e.parentNode)v.error("type property can't be changed");else if(!v.support.radioValue&&t==="radio"&&v.nodeName(e,"input")){var n=e.value;return e.setAttribute("type",t),n&&(e.value=n),t}}},value:{get:function(e,t){return j&&v.nodeName(e,"button")?j.get(e,t):t in e?e.value:null},set:function(e,t,n){if(j&&v.nodeName(e,"button"))return j.set(e,t,n);e.value=t}}},propFix:{tabindex:"tabIndex",readonly:"readOnly","for":"htmlFor","class":"className",maxlength:"maxLength",cellspacing:"cellSpacing",cellpadding:"cellPadding",rowspan:"rowSpan",colspan:"colSpan",usemap:"useMap",frameborder:"frameBorder",contenteditable:"contentEditable"},prop:function(e,n,r){var i,s,o,u=e.nodeType;if(!e||u===3||u===8||u===2)return;return o=u!==1||!v.isXMLDoc(e),o&&(n=v.propFix[n]||n,s=v.propHooks[n]),r!==t?s&&"set"in s&&(i=s.set(e,r,n))!==t?i:e[n]=r:s&&"get"in s&&(i=s.get(e,n))!==null?i:e[n]},propHooks:{tabIndex:{get:function(e){var n=e.getAttributeNode("tabindex");return n&&n.specified?parseInt(n.value,10):z.test(e.nodeName)||W.test(e.nodeName)&&e.href?0:t}}}}),F={get:function(e,n){var r,i=v.prop(e,n);return i===!0||typeof i!="boolean"&&(r=e.getAttributeNode(n))&&r.nodeValue!==!1?n.toLowerCase():t},set:function(e,t,n){var r;return t===!1?v.removeAttr(e,n):(r=v.propFix[n]||n,r in e&&(e[r]=!0),e.setAttribute(n,n.toLowerCase())),n}},V||(I={name:!0,id:!0,coords:!0},j=v.valHooks.button={get:function(e,n){var r;return r=e.getAttributeNode(n),r&&(I[n]?r.value!=="":r.specified)?r.value:t},set:function(e,t,n){var r=e.getAttributeNode(n);return r||(r=i.createAttribute(n),e.setAttributeNode(r)),r.value=t+""}},v.each(["width","height"],function(e,t){v.attrHooks[t]=v.extend(v.attrHooks[t],{set:function(e,n){if(n==="")return e.setAttribute(t,"auto"),n}})}),v.attrHooks.contenteditable={get:j.get,set:function(e,t,n){t===""&&(t="false"),j.set(e,t,n)}}),v.support.hrefNormalized||v.each(["href","src","width","height"],function(e,n){v.attrHooks[n]=v.extend(v.attrHooks[n],{get:function(e){var r=e.getAttribute(n,2);return r===null?t:r}})}),v.support.style||(v.attrHooks.style={get:function(e){return e.style.cssText.toLowerCase()||t},set:function(e,t){return e.style.cssText=t+""}}),v.support.optSelected||(v.propHooks.selected=v.extend(v.propHooks.selected,{get:function(e){var t=e.parentNode;return t&&(t.selectedIndex,t.parentNode&&t.parentNode.selectedIndex),null}})),v.support.enctype||(v.propFix.enctype="encoding"),v.support.checkOn||v.each(["radio","checkbox"],function(){v.valHooks[this]={get:function(e){return e.getAttribute("value")===null?"on":e.value}}}),v.each(["radio","checkbox"],function(){v.valHooks[this]=v.extend(v.valHooks[this],{set:function(e,t){if(v.isArray(t))return e.checked=v.inArray(v(e).val(),t)>=0}})});var $=/^(?:textarea|input|select)$/i,J=/^([^\.]*|)(?:\.(.+)|)$/,K=/(?:^|\s)hover(\.\S+|)\b/,Q=/^key/,G=/^(?:mouse|contextmenu)|click/,Y=/^(?:focusinfocus|focusoutblur)$/,Z=function(e){return v.event.special.hover?e:e.replace(K,"mouseenter$1 mouseleave$1")};v.event={add:function(e,n,r,i,s){var o,u,a,f,l,c,h,p,d,m,g;if(e.nodeType===3||e.nodeType===8||!n||!r||!(o=v._data(e)))return;r.handler&&(d=r,r=d.handler,s=d.selector),r.guid||(r.guid=v.guid++),a=o.events,a||(o.events=a={}),u=o.handle,u||(o.handle=u=function(e){return typeof v=="undefined"||!!e&&v.event.triggered===e.type?t:v.event.dispatch.apply(u.elem,arguments)},u.elem=e),n=v.trim(Z(n)).split(" ");for(f=0;f<n.length;f++){l=J.exec(n[f])||[],c=l[1],h=(l[2]||"").split(".").sort(),g=v.event.special[c]||{},c=(s?g.delegateType:g.bindType)||c,g=v.event.special[c]||{},p=v.extend({type:c,origType:l[1],data:i,handler:r,guid:r.guid,selector:s,needsContext:s&&v.expr.match.needsContext.test(s),namespace:h.join(".")},d),m=a[c];if(!m){m=a[c]=[],m.delegateCount=0;if(!g.setup||g.setup.call(e,i,h,u)===!1)e.addEventListener?e.addEventListener(c,u,!1):e.attachEvent&&e.attachEvent("on"+c,u)}g.add&&(g.add.call(e,p),p.handler.guid||(p.handler.guid=r.guid)),s?m.splice(m.delegateCount++,0,p):m.push(p),v.event.global[c]=!0}e=null},global:{},remove:function(e,t,n,r,i){var s,o,u,a,f,l,c,h,p,d,m,g=v.hasData(e)&&v._data(e);if(!g||!(h=g.events))return;t=v.trim(Z(t||"")).split(" ");for(s=0;s<t.length;s++){o=J.exec(t[s])||[],u=a=o[1],f=o[2];if(!u){for(u in h)v.event.remove(e,u+t[s],n,r,!0);continue}p=v.event.special[u]||{},u=(r?p.delegateType:p.bindType)||u,d=h[u]||[],l=d.length,f=f?new RegExp("(^|\\.)"+f.split(".").sort().join("\\.(?:.*\\.|)")+"(\\.|$)"):null;for(c=0;c<d.length;c++)m=d[c],(i||a===m.origType)&&(!n||n.guid===m.guid)&&(!f||f.test(m.namespace))&&(!r||r===m.selector||r==="**"&&m.selector)&&(d.splice(c--,1),m.selector&&d.delegateCount--,p.remove&&p.remove.call(e,m));d.length===0&&l!==d.length&&((!p.teardown||p.teardown.call(e,f,g.handle)===!1)&&v.removeEvent(e,u,g.handle),delete h[u])}v.isEmptyObject(h)&&(delete g.handle,v.removeData(e,"events",!0))},customEvent:{getData:!0,setData:!0,changeData:!0},trigger:function(n,r,s,o){if(!s||s.nodeType!==3&&s.nodeType!==8){var u,a,f,l,c,h,p,d,m,g,y=n.type||n,b=[];if(Y.test(y+v.event.triggered))return;y.indexOf("!")>=0&&(y=y.slice(0,-1),a=!0),y.indexOf(".")>=0&&(b=y.split("."),y=b.shift(),b.sort());if((!s||v.event.customEvent[y])&&!v.event.global[y])return;n=typeof n=="object"?n[v.expando]?n:new v.Event(y,n):new v.Event(y),n.type=y,n.isTrigger=!0,n.exclusive=a,n.namespace=b.join("."),n.namespace_re=n.namespace?new RegExp("(^|\\.)"+b.join("\\.(?:.*\\.|)")+"(\\.|$)"):null,h=y.indexOf(":")<0?"on"+y:"";if(!s){u=v.cache;for(f in u)u[f].events&&u[f].events[y]&&v.event.trigger(n,r,u[f].handle.elem,!0);return}n.result=t,n.target||(n.target=s),r=r!=null?v.makeArray(r):[],r.unshift(n),p=v.event.special[y]||{};if(p.trigger&&p.trigger.apply(s,r)===!1)return;m=[[s,p.bindType||y]];if(!o&&!p.noBubble&&!v.isWindow(s)){g=p.delegateType||y,l=Y.test(g+y)?s:s.parentNode;for(c=s;l;l=l.parentNode)m.push([l,g]),c=l;c===(s.ownerDocument||i)&&m.push([c.defaultView||c.parentWindow||e,g])}for(f=0;f<m.length&&!n.isPropagationStopped();f++)l=m[f][0],n.type=m[f][1],d=(v._data(l,"events")||{})[n.type]&&v._data(l,"handle"),d&&d.apply(l,r),d=h&&l[h],d&&v.acceptData(l)&&d.apply&&d.apply(l,r)===!1&&n.preventDefault();return n.type=y,!o&&!n.isDefaultPrevented()&&(!p._default||p._default.apply(s.ownerDocument,r)===!1)&&(y!=="click"||!v.nodeName(s,"a"))&&v.acceptData(s)&&h&&s[y]&&(y!=="focus"&&y!=="blur"||n.target.offsetWidth!==0)&&!v.isWindow(s)&&(c=s[h],c&&(s[h]=null),v.event.triggered=y,s[y](),v.event.triggered=t,c&&(s[h]=c)),n.result}return},dispatch:function(n){n=v.event.fix(n||e.event);var r,i,s,o,u,a,f,c,h,p,d=(v._data(this,"events")||{})[n.type]||[],m=d.delegateCount,g=l.call(arguments),y=!n.exclusive&&!n.namespace,b=v.event.special[n.type]||{},w=[];g[0]=n,n.delegateTarget=this;if(b.preDispatch&&b.preDispatch.call(this,n)===!1)return;if(m&&(!n.button||n.type!=="click"))for(s=n.target;s!=this;s=s.parentNode||this)if(s.disabled!==!0||n.type!=="click"){u={},f=[];for(r=0;r<m;r++)c=d[r],h=c.selector,u[h]===t&&(u[h]=c.needsContext?v(h,this).index(s)>=0:v.find(h,this,null,[s]).length),u[h]&&f.push(c);f.length&&w.push({elem:s,matches:f})}d.length>m&&w.push({elem:this,matches:d.slice(m)});for(r=0;r<w.length&&!n.isPropagationStopped();r++){a=w[r],n.currentTarget=a.elem;for(i=0;i<a.matches.length&&!n.isImmediatePropagationStopped();i++){c=a.matches[i];if(y||!n.namespace&&!c.namespace||n.namespace_re&&n.namespace_re.test(c.namespace))n.data=c.data,n.handleObj=c,o=((v.event.special[c.origType]||{}).handle||c.handler).apply(a.elem,g),o!==t&&(n.result=o,o===!1&&(n.preventDefault(),n.stopPropagation()))}}return b.postDispatch&&b.postDispatch.call(this,n),n.result},props:"attrChange attrName relatedNode srcElement altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),fixHooks:{},keyHooks:{props:"char charCode key keyCode".split(" "),filter:function(e,t){return e.which==null&&(e.which=t.charCode!=null?t.charCode:t.keyCode),e}},mouseHooks:{props:"button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),filter:function(e,n){var r,s,o,u=n.button,a=n.fromElement;return e.pageX==null&&n.clientX!=null&&(r=e.target.ownerDocument||i,s=r.documentElement,o=r.body,e.pageX=n.clientX+(s&&s.scrollLeft||o&&o.scrollLeft||0)-(s&&s.clientLeft||o&&o.clientLeft||0),e.pageY=n.clientY+(s&&s.scrollTop||o&&o.scrollTop||0)-(s&&s.clientTop||o&&o.clientTop||0)),!e.relatedTarget&&a&&(e.relatedTarget=a===e.target?n.toElement:a),!e.which&&u!==t&&(e.which=u&1?1:u&2?3:u&4?2:0),e}},fix:function(e){if(e[v.expando])return e;var t,n,r=e,s=v.event.fixHooks[e.type]||{},o=s.props?this.props.concat(s.props):this.props;e=v.Event(r);for(t=o.length;t;)n=o[--t],e[n]=r[n];return e.target||(e.target=r.srcElement||i),e.target.nodeType===3&&(e.target=e.target.parentNode),e.metaKey=!!e.metaKey,s.filter?s.filter(e,r):e},special:{load:{noBubble:!0},focus:{delegateType:"focusin"},blur:{delegateType:"focusout"},beforeunload:{setup:function(e,t,n){v.isWindow(this)&&(this.onbeforeunload=n)},teardown:function(e,t){this.onbeforeunload===t&&(this.onbeforeunload=null)}}},simulate:function(e,t,n,r){var i=v.extend(new v.Event,n,{type:e,isSimulated:!0,originalEvent:{}});r?v.event.trigger(i,null,t):v.event.dispatch.call(t,i),i.isDefaultPrevented()&&n.preventDefault()}},v.event.handle=v.event.dispatch,v.removeEvent=i.removeEventListener?function(e,t,n){e.removeEventListener&&e.removeEventListener(t,n,!1)}:function(e,t,n){var r="on"+t;e.detachEvent&&(typeof e[r]=="undefined"&&(e[r]=null),e.detachEvent(r,n))},v.Event=function(e,t){if(!(this instanceof v.Event))return new v.Event(e,t);e&&e.type?(this.originalEvent=e,this.type=e.type,this.isDefaultPrevented=e.defaultPrevented||e.returnValue===!1||e.getPreventDefault&&e.getPreventDefault()?tt:et):this.type=e,t&&v.extend(this,t),this.timeStamp=e&&e.timeStamp||v.now(),this[v.expando]=!0},v.Event.prototype={preventDefault:function(){this.isDefaultPrevented=tt;var e=this.originalEvent;if(!e)return;e.preventDefault?e.preventDefault():e.returnValue=!1},stopPropagation:function(){this.isPropagationStopped=tt;var e=this.originalEvent;if(!e)return;e.stopPropagation&&e.stopPropagation(),e.cancelBubble=!0},stopImmediatePropagation:function(){this.isImmediatePropagationStopped=tt,this.stopPropagation()},isDefaultPrevented:et,isPropagationStopped:et,isImmediatePropagationStopped:et},v.each({mouseenter:"mouseover",mouseleave:"mouseout"},function(e,t){v.event.special[e]={delegateType:t,bindType:t,handle:function(e){var n,r=this,i=e.relatedTarget,s=e.handleObj,o=s.selector;if(!i||i!==r&&!v.contains(r,i))e.type=s.origType,n=s.handler.apply(this,arguments),e.type=t;return n}}}),v.support.submitBubbles||(v.event.special.submit={setup:function(){if(v.nodeName(this,"form"))return!1;v.event.add(this,"click._submit keypress._submit",function(e){var n=e.target,r=v.nodeName(n,"input")||v.nodeName(n,"button")?n.form:t;r&&!v._data(r,"_submit_attached")&&(v.event.add(r,"submit._submit",function(e){e._submit_bubble=!0}),v._data(r,"_submit_attached",!0))})},postDispatch:function(e){e._submit_bubble&&(delete e._submit_bubble,this.parentNode&&!e.isTrigger&&v.event.simulate("submit",this.parentNode,e,!0))},teardown:function(){if(v.nodeName(this,"form"))return!1;v.event.remove(this,"._submit")}}),v.support.changeBubbles||(v.event.special.change={setup:function(){if($.test(this.nodeName)){if(this.type==="checkbox"||this.type==="radio")v.event.add(this,"propertychange._change",function(e){e.originalEvent.propertyName==="checked"&&(this._just_changed=!0)}),v.event.add(this,"click._change",function(e){this._just_changed&&!e.isTrigger&&(this._just_changed=!1),v.event.simulate("change",this,e,!0)});return!1}v.event.add(this,"beforeactivate._change",function(e){var t=e.target;$.test(t.nodeName)&&!v._data(t,"_change_attached")&&(v.event.add(t,"change._change",function(e){this.parentNode&&!e.isSimulated&&!e.isTrigger&&v.event.simulate("change",this.parentNode,e,!0)}),v._data(t,"_change_attached",!0))})},handle:function(e){var t=e.target;if(this!==t||e.isSimulated||e.isTrigger||t.type!=="radio"&&t.type!=="checkbox")return e.handleObj.handler.apply(this,arguments)},teardown:function(){return v.event.remove(this,"._change"),!$.test(this.nodeName)}}),v.support.focusinBubbles||v.each({focus:"focusin",blur:"focusout"},function(e,t){var n=0,r=function(e){v.event.simulate(t,e.target,v.event.fix(e),!0)};v.event.special[t]={setup:function(){n++===0&&i.addEventListener(e,r,!0)},teardown:function(){--n===0&&i.removeEventListener(e,r,!0)}}}),v.fn.extend({on:function(e,n,r,i,s){var o,u;if(typeof e=="object"){typeof n!="string"&&(r=r||n,n=t);for(u in e)this.on(u,n,r,e[u],s);return this}r==null&&i==null?(i=n,r=n=t):i==null&&(typeof n=="string"?(i=r,r=t):(i=r,r=n,n=t));if(i===!1)i=et;else if(!i)return this;return s===1&&(o=i,i=function(e){return v().off(e),o.apply(this,arguments)},i.guid=o.guid||(o.guid=v.guid++)),this.each(function(){v.event.add(this,e,i,r,n)})},one:function(e,t,n,r){return this.on(e,t,n,r,1)},off:function(e,n,r){var i,s;if(e&&e.preventDefault&&e.handleObj)return i=e.handleObj,v(e.delegateTarget).off(i.namespace?i.origType+"."+i.namespace:i.origType,i.selector,i.handler),this;if(typeof e=="object"){for(s in e)this.off(s,n,e[s]);return this}if(n===!1||typeof n=="function")r=n,n=t;return r===!1&&(r=et),this.each(function(){v.event.remove(this,e,r,n)})},bind:function(e,t,n){return this.on(e,null,t,n)},unbind:function(e,t){return this.off(e,null,t)},live:function(e,t,n){return v(this.context).on(e,this.selector,t,n),this},die:function(e,t){return v(this.context).off(e,this.selector||"**",t),this},delegate:function(e,t,n,r){return this.on(t,e,n,r)},undelegate:function(e,t,n){return arguments.length===1?this.off(e,"**"):this.off(t,e||"**",n)},trigger:function(e,t){return this.each(function(){v.event.trigger(e,t,this)})},triggerHandler:function(e,t){if(this[0])return v.event.trigger(e,t,this[0],!0)},toggle:function(e){var t=arguments,n=e.guid||v.guid++,r=0,i=function(n){var i=(v._data(this,"lastToggle"+e.guid)||0)%r;return v._data(this,"lastToggle"+e.guid,i+1),n.preventDefault(),t[i].apply(this,arguments)||!1};i.guid=n;while(r<t.length)t[r++].guid=n;return this.click(i)},hover:function(e,t){return this.mouseenter(e).mouseleave(t||e)}}),v.each("blur focus focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup error contextmenu".split(" "),function(e,t){v.fn[t]=function(e,n){return n==null&&(n=e,e=null),arguments.length>0?this.on(t,null,e,n):this.trigger(t)},Q.test(t)&&(v.event.fixHooks[t]=v.event.keyHooks),G.test(t)&&(v.event.fixHooks[t]=v.event.mouseHooks)}),function(e,t){function nt(e,t,n,r){n=n||[],t=t||g;var i,s,a,f,l=t.nodeType;if(!e||typeof e!="string")return n;if(l!==1&&l!==9)return[];a=o(t);if(!a&&!r)if(i=R.exec(e))if(f=i[1]){if(l===9){s=t.getElementById(f);if(!s||!s.parentNode)return n;if(s.id===f)return n.push(s),n}else if(t.ownerDocument&&(s=t.ownerDocument.getElementById(f))&&u(t,s)&&s.id===f)return n.push(s),n}else{if(i[2])return S.apply(n,x.call(t.getElementsByTagName(e),0)),n;if((f=i[3])&&Z&&t.getElementsByClassName)return S.apply(n,x.call(t.getElementsByClassName(f),0)),n}return vt(e.replace(j,"$1"),t,n,r,a)}function rt(e){return function(t){var n=t.nodeName.toLowerCase();return n==="input"&&t.type===e}}function it(e){return function(t){var n=t.nodeName.toLowerCase();return(n==="input"||n==="button")&&t.type===e}}function st(e){return N(function(t){return t=+t,N(function(n,r){var i,s=e([],n.length,t),o=s.length;while(o--)n[i=s[o]]&&(n[i]=!(r[i]=n[i]))})})}function ot(e,t,n){if(e===t)return n;var r=e.nextSibling;while(r){if(r===t)return-1;r=r.nextSibling}return 1}function ut(e,t){var n,r,s,o,u,a,f,l=L[d][e+" "];if(l)return t?0:l.slice(0);u=e,a=[],f=i.preFilter;while(u){if(!n||(r=F.exec(u)))r&&(u=u.slice(r[0].length)||u),a.push(s=[]);n=!1;if(r=I.exec(u))s.push(n=new m(r.shift())),u=u.slice(n.length),n.type=r[0].replace(j," ");for(o in i.filter)(r=J[o].exec(u))&&(!f[o]||(r=f[o](r)))&&(s.push(n=new m(r.shift())),u=u.slice(n.length),n.type=o,n.matches=r);if(!n)break}return t?u.length:u?nt.error(e):L(e,a).slice(0)}function at(e,t,r){var i=t.dir,s=r&&t.dir==="parentNode",o=w++;return t.first?function(t,n,r){while(t=t[i])if(s||t.nodeType===1)return e(t,n,r)}:function(t,r,u){if(!u){var a,f=b+" "+o+" ",l=f+n;while(t=t[i])if(s||t.nodeType===1){if((a=t[d])===l)return t.sizset;if(typeof a=="string"&&a.indexOf(f)===0){if(t.sizset)return t}else{t[d]=l;if(e(t,r,u))return t.sizset=!0,t;t.sizset=!1}}}else while(t=t[i])if(s||t.nodeType===1)if(e(t,r,u))return t}}function ft(e){return e.length>1?function(t,n,r){var i=e.length;while(i--)if(!e[i](t,n,r))return!1;return!0}:e[0]}function lt(e,t,n,r,i){var s,o=[],u=0,a=e.length,f=t!=null;for(;u<a;u++)if(s=e[u])if(!n||n(s,r,i))o.push(s),f&&t.push(u);return o}function ct(e,t,n,r,i,s){return r&&!r[d]&&(r=ct(r)),i&&!i[d]&&(i=ct(i,s)),N(function(s,o,u,a){var f,l,c,h=[],p=[],d=o.length,v=s||dt(t||"*",u.nodeType?[u]:u,[]),m=e&&(s||!t)?lt(v,h,e,u,a):v,g=n?i||(s?e:d||r)?[]:o:m;n&&n(m,g,u,a);if(r){f=lt(g,p),r(f,[],u,a),l=f.length;while(l--)if(c=f[l])g[p[l]]=!(m[p[l]]=c)}if(s){if(i||e){if(i){f=[],l=g.length;while(l--)(c=g[l])&&f.push(m[l]=c);i(null,g=[],f,a)}l=g.length;while(l--)(c=g[l])&&(f=i?T.call(s,c):h[l])>-1&&(s[f]=!(o[f]=c))}}else g=lt(g===o?g.splice(d,g.length):g),i?i(null,o,g,a):S.apply(o,g)})}function ht(e){var t,n,r,s=e.length,o=i.relative[e[0].type],u=o||i.relative[" "],a=o?1:0,f=at(function(e){return e===t},u,!0),l=at(function(e){return T.call(t,e)>-1},u,!0),h=[function(e,n,r){return!o&&(r||n!==c)||((t=n).nodeType?f(e,n,r):l(e,n,r))}];for(;a<s;a++)if(n=i.relative[e[a].type])h=[at(ft(h),n)];else{n=i.filter[e[a].type].apply(null,e[a].matches);if(n[d]){r=++a;for(;r<s;r++)if(i.relative[e[r].type])break;return ct(a>1&&ft(h),a>1&&e.slice(0,a-1).join("").replace(j,"$1"),n,a<r&&ht(e.slice(a,r)),r<s&&ht(e=e.slice(r)),r<s&&e.join(""))}h.push(n)}return ft(h)}function pt(e,t){var r=t.length>0,s=e.length>0,o=function(u,a,f,l,h){var p,d,v,m=[],y=0,w="0",x=u&&[],T=h!=null,N=c,C=u||s&&i.find.TAG("*",h&&a.parentNode||a),k=b+=N==null?1:Math.E;T&&(c=a!==g&&a,n=o.el);for(;(p=C[w])!=null;w++){if(s&&p){for(d=0;v=e[d];d++)if(v(p,a,f)){l.push(p);break}T&&(b=k,n=++o.el)}r&&((p=!v&&p)&&y--,u&&x.push(p))}y+=w;if(r&&w!==y){for(d=0;v=t[d];d++)v(x,m,a,f);if(u){if(y>0)while(w--)!x[w]&&!m[w]&&(m[w]=E.call(l));m=lt(m)}S.apply(l,m),T&&!u&&m.length>0&&y+t.length>1&&nt.uniqueSort(l)}return T&&(b=k,c=N),x};return o.el=0,r?N(o):o}function dt(e,t,n){var r=0,i=t.length;for(;r<i;r++)nt(e,t[r],n);return n}function vt(e,t,n,r,s){var o,u,f,l,c,h=ut(e),p=h.length;if(!r&&h.length===1){u=h[0]=h[0].slice(0);if(u.length>2&&(f=u[0]).type==="ID"&&t.nodeType===9&&!s&&i.relative[u[1].type]){t=i.find.ID(f.matches[0].replace($,""),t,s)[0];if(!t)return n;e=e.slice(u.shift().length)}for(o=J.POS.test(e)?-1:u.length-1;o>=0;o--){f=u[o];if(i.relative[l=f.type])break;if(c=i.find[l])if(r=c(f.matches[0].replace($,""),z.test(u[0].type)&&t.parentNode||t,s)){u.splice(o,1),e=r.length&&u.join("");if(!e)return S.apply(n,x.call(r,0)),n;break}}}return a(e,h)(r,t,s,n,z.test(e)),n}function mt(){}var n,r,i,s,o,u,a,f,l,c,h=!0,p="undefined",d=("sizcache"+Math.random()).replace(".",""),m=String,g=e.document,y=g.documentElement,b=0,w=0,E=[].pop,S=[].push,x=[].slice,T=[].indexOf||function(e){var t=0,n=this.length;for(;t<n;t++)if(this[t]===e)return t;return-1},N=function(e,t){return e[d]=t==null||t,e},C=function(){var e={},t=[];return N(function(n,r){return t.push(n)>i.cacheLength&&delete e[t.shift()],e[n+" "]=r},e)},k=C(),L=C(),A=C(),O="[\\x20\\t\\r\\n\\f]",M="(?:\\\\.|[-\\w]|[^\\x00-\\xa0])+",_=M.replace("w","w#"),D="([*^$|!~]?=)",P="\\["+O+"*("+M+")"+O+"*(?:"+D+O+"*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|("+_+")|)|)"+O+"*\\]",H=":("+M+")(?:\\((?:(['\"])((?:\\\\.|[^\\\\])*?)\\2|([^()[\\]]*|(?:(?:"+P+")|[^:]|\\\\.)*|.*))\\)|)",B=":(even|odd|eq|gt|lt|nth|first|last)(?:\\("+O+"*((?:-\\d)?\\d*)"+O+"*\\)|)(?=[^-]|$)",j=new RegExp("^"+O+"+|((?:^|[^\\\\])(?:\\\\.)*)"+O+"+$","g"),F=new RegExp("^"+O+"*,"+O+"*"),I=new RegExp("^"+O+"*([\\x20\\t\\r\\n\\f>+~])"+O+"*"),q=new RegExp(H),R=/^(?:#([\w\-]+)|(\w+)|\.([\w\-]+))$/,U=/^:not/,z=/[\x20\t\r\n\f]*[+~]/,W=/:not\($/,X=/h\d/i,V=/input|select|textarea|button/i,$=/\\(?!\\)/g,J={ID:new RegExp("^#("+M+")"),CLASS:new RegExp("^\\.("+M+")"),NAME:new RegExp("^\\[name=['\"]?("+M+")['\"]?\\]"),TAG:new RegExp("^("+M.replace("w","w*")+")"),ATTR:new RegExp("^"+P),PSEUDO:new RegExp("^"+H),POS:new RegExp(B,"i"),CHILD:new RegExp("^:(only|nth|first|last)-child(?:\\("+O+"*(even|odd|(([+-]|)(\\d*)n|)"+O+"*(?:([+-]|)"+O+"*(\\d+)|))"+O+"*\\)|)","i"),needsContext:new RegExp("^"+O+"*[>+~]|"+B,"i")},K=function(e){var t=g.createElement("div");try{return e(t)}catch(n){return!1}finally{t=null}},Q=K(function(e){return e.appendChild(g.createComment("")),!e.getElementsByTagName("*").length}),G=K(function(e){return e.innerHTML="<a href='#'></a>",e.firstChild&&typeof e.firstChild.getAttribute!==p&&e.firstChild.getAttribute("href")==="#"}),Y=K(function(e){e.innerHTML="<select></select>";var t=typeof e.lastChild.getAttribute("multiple");return t!=="boolean"&&t!=="string"}),Z=K(function(e){return e.innerHTML="<div class='hidden e'></div><div class='hidden'></div>",!e.getElementsByClassName||!e.getElementsByClassName("e").length?!1:(e.lastChild.className="e",e.getElementsByClassName("e").length===2)}),et=K(function(e){e.id=d+0,e.innerHTML="<a name='"+d+"'></a><div name='"+d+"'></div>",y.insertBefore(e,y.firstChild);var t=g.getElementsByName&&g.getElementsByName(d).length===2+g.getElementsByName(d+0).length;return r=!g.getElementById(d),y.removeChild(e),t});try{x.call(y.childNodes,0)[0].nodeType}catch(tt){x=function(e){var t,n=[];for(;t=this[e];e++)n.push(t);return n}}nt.matches=function(e,t){return nt(e,null,null,t)},nt.matchesSelector=function(e,t){return nt(t,null,null,[e]).length>0},s=nt.getText=function(e){var t,n="",r=0,i=e.nodeType;if(i){if(i===1||i===9||i===11){if(typeof e.textContent=="string")return e.textContent;for(e=e.firstChild;e;e=e.nextSibling)n+=s(e)}else if(i===3||i===4)return e.nodeValue}else for(;t=e[r];r++)n+=s(t);return n},o=nt.isXML=function(e){var t=e&&(e.ownerDocument||e).documentElement;return t?t.nodeName!=="HTML":!1},u=nt.contains=y.contains?function(e,t){var n=e.nodeType===9?e.documentElement:e,r=t&&t.parentNode;return e===r||!!(r&&r.nodeType===1&&n.contains&&n.contains(r))}:y.compareDocumentPosition?function(e,t){return t&&!!(e.compareDocumentPosition(t)&16)}:function(e,t){while(t=t.parentNode)if(t===e)return!0;return!1},nt.attr=function(e,t){var n,r=o(e);return r||(t=t.toLowerCase()),(n=i.attrHandle[t])?n(e):r||Y?e.getAttribute(t):(n=e.getAttributeNode(t),n?typeof e[t]=="boolean"?e[t]?t:null:n.specified?n.value:null:null)},i=nt.selectors={cacheLength:50,createPseudo:N,match:J,attrHandle:G?{}:{href:function(e){return e.getAttribute("href",2)},type:function(e){return e.getAttribute("type")}},find:{ID:r?function(e,t,n){if(typeof t.getElementById!==p&&!n){var r=t.getElementById(e);return r&&r.parentNode?[r]:[]}}:function(e,n,r){if(typeof n.getElementById!==p&&!r){var i=n.getElementById(e);return i?i.id===e||typeof i.getAttributeNode!==p&&i.getAttributeNode("id").value===e?[i]:t:[]}},TAG:Q?function(e,t){if(typeof t.getElementsByTagName!==p)return t.getElementsByTagName(e)}:function(e,t){var n=t.getElementsByTagName(e);if(e==="*"){var r,i=[],s=0;for(;r=n[s];s++)r.nodeType===1&&i.push(r);return i}return n},NAME:et&&function(e,t){if(typeof t.getElementsByName!==p)return t.getElementsByName(name)},CLASS:Z&&function(e,t,n){if(typeof t.getElementsByClassName!==p&&!n)return t.getElementsByClassName(e)}},relative:{">":{dir:"parentNode",first:!0}," ":{dir:"parentNode"},"+":{dir:"previousSibling",first:!0},"~":{dir:"previousSibling"}},preFilter:{ATTR:function(e){return e[1]=e[1].replace($,""),e[3]=(e[4]||e[5]||"").replace($,""),e[2]==="~="&&(e[3]=" "+e[3]+" "),e.slice(0,4)},CHILD:function(e){return e[1]=e[1].toLowerCase(),e[1]==="nth"?(e[2]||nt.error(e[0]),e[3]=+(e[3]?e[4]+(e[5]||1):2*(e[2]==="even"||e[2]==="odd")),e[4]=+(e[6]+e[7]||e[2]==="odd")):e[2]&&nt.error(e[0]),e},PSEUDO:function(e){var t,n;if(J.CHILD.test(e[0]))return null;if(e[3])e[2]=e[3];else if(t=e[4])q.test(t)&&(n=ut(t,!0))&&(n=t.indexOf(")",t.length-n)-t.length)&&(t=t.slice(0,n),e[0]=e[0].slice(0,n)),e[2]=t;return e.slice(0,3)}},filter:{ID:r?function(e){return e=e.replace($,""),function(t){return t.getAttribute("id")===e}}:function(e){return e=e.replace($,""),function(t){var n=typeof t.getAttributeNode!==p&&t.getAttributeNode("id");return n&&n.value===e}},TAG:function(e){return e==="*"?function(){return!0}:(e=e.replace($,"").toLowerCase(),function(t){return t.nodeName&&t.nodeName.toLowerCase()===e})},CLASS:function(e){var t=k[d][e+" "];return t||(t=new RegExp("(^|"+O+")"+e+"("+O+"|$)"))&&k(e,function(e){return t.test(e.className||typeof e.getAttribute!==p&&e.getAttribute("class")||"")})},ATTR:function(e,t,n){return function(r,i){var s=nt.attr(r,e);return s==null?t==="!=":t?(s+="",t==="="?s===n:t==="!="?s!==n:t==="^="?n&&s.indexOf(n)===0:t==="*="?n&&s.indexOf(n)>-1:t==="$="?n&&s.substr(s.length-n.length)===n:t==="~="?(" "+s+" ").indexOf(n)>-1:t==="|="?s===n||s.substr(0,n.length+1)===n+"-":!1):!0}},CHILD:function(e,t,n,r){return e==="nth"?function(e){var t,i,s=e.parentNode;if(n===1&&r===0)return!0;if(s){i=0;for(t=s.firstChild;t;t=t.nextSibling)if(t.nodeType===1){i++;if(e===t)break}}return i-=r,i===n||i%n===0&&i/n>=0}:function(t){var n=t;switch(e){case"only":case"first":while(n=n.previousSibling)if(n.nodeType===1)return!1;if(e==="first")return!0;n=t;case"last":while(n=n.nextSibling)if(n.nodeType===1)return!1;return!0}}},PSEUDO:function(e,t){var n,r=i.pseudos[e]||i.setFilters[e.toLowerCase()]||nt.error("unsupported pseudo: "+e);return r[d]?r(t):r.length>1?(n=[e,e,"",t],i.setFilters.hasOwnProperty(e.toLowerCase())?N(function(e,n){var i,s=r(e,t),o=s.length;while(o--)i=T.call(e,s[o]),e[i]=!(n[i]=s[o])}):function(e){return r(e,0,n)}):r}},pseudos:{not:N(function(e){var t=[],n=[],r=a(e.replace(j,"$1"));return r[d]?N(function(e,t,n,i){var s,o=r(e,null,i,[]),u=e.length;while(u--)if(s=o[u])e[u]=!(t[u]=s)}):function(e,i,s){return t[0]=e,r(t,null,s,n),!n.pop()}}),has:N(function(e){return function(t){return nt(e,t).length>0}}),contains:N(function(e){return function(t){return(t.textContent||t.innerText||s(t)).indexOf(e)>-1}}),enabled:function(e){return e.disabled===!1},disabled:function(e){return e.disabled===!0},checked:function(e){var t=e.nodeName.toLowerCase();return t==="input"&&!!e.checked||t==="option"&&!!e.selected},selected:function(e){return e.parentNode&&e.parentNode.selectedIndex,e.selected===!0},parent:function(e){return!i.pseudos.empty(e)},empty:function(e){var t;e=e.firstChild;while(e){if(e.nodeName>"@"||(t=e.nodeType)===3||t===4)return!1;e=e.nextSibling}return!0},header:function(e){return X.test(e.nodeName)},text:function(e){var t,n;return e.nodeName.toLowerCase()==="input"&&(t=e.type)==="text"&&((n=e.getAttribute("type"))==null||n.toLowerCase()===t)},radio:rt("radio"),checkbox:rt("checkbox"),file:rt("file"),password:rt("password"),image:rt("image"),submit:it("submit"),reset:it("reset"),button:function(e){var t=e.nodeName.toLowerCase();return t==="input"&&e.type==="button"||t==="button"},input:function(e){return V.test(e.nodeName)},focus:function(e){var t=e.ownerDocument;return e===t.activeElement&&(!t.hasFocus||t.hasFocus())&&!!(e.type||e.href||~e.tabIndex)},active:function(e){return e===e.ownerDocument.activeElement},first:st(function(){return[0]}),last:st(function(e,t){return[t-1]}),eq:st(function(e,t,n){return[n<0?n+t:n]}),even:st(function(e,t){for(var n=0;n<t;n+=2)e.push(n);return e}),odd:st(function(e,t){for(var n=1;n<t;n+=2)e.push(n);return e}),lt:st(function(e,t,n){for(var r=n<0?n+t:n;--r>=0;)e.push(r);return e}),gt:st(function(e,t,n){for(var r=n<0?n+t:n;++r<t;)e.push(r);return e})}},f=y.compareDocumentPosition?function(e,t){return e===t?(l=!0,0):(!e.compareDocumentPosition||!t.compareDocumentPosition?e.compareDocumentPosition:e.compareDocumentPosition(t)&4)?-1:1}:function(e,t){if(e===t)return l=!0,0;if(e.sourceIndex&&t.sourceIndex)return e.sourceIndex-t.sourceIndex;var n,r,i=[],s=[],o=e.parentNode,u=t.parentNode,a=o;if(o===u)return ot(e,t);if(!o)return-1;if(!u)return 1;while(a)i.unshift(a),a=a.parentNode;a=u;while(a)s.unshift(a),a=a.parentNode;n=i.length,r=s.length;for(var f=0;f<n&&f<r;f++)if(i[f]!==s[f])return ot(i[f],s[f]);return f===n?ot(e,s[f],-1):ot(i[f],t,1)},[0,0].sort(f),h=!l,nt.uniqueSort=function(e){var t,n=[],r=1,i=0;l=h,e.sort(f);if(l){for(;t=e[r];r++)t===e[r-1]&&(i=n.push(r));while(i--)e.splice(n[i],1)}return e},nt.error=function(e){throw new Error("Syntax error, unrecognized expression: "+e)},a=nt.compile=function(e,t){var n,r=[],i=[],s=A[d][e+" "];if(!s){t||(t=ut(e)),n=t.length;while(n--)s=ht(t[n]),s[d]?r.push(s):i.push(s);s=A(e,pt(i,r))}return s},g.querySelectorAll&&function(){var e,t=vt,n=/'|\\/g,r=/\=[\x20\t\r\n\f]*([^'"\]]*)[\x20\t\r\n\f]*\]/g,i=[":focus"],s=[":active"],u=y.matchesSelector||y.mozMatchesSelector||y.webkitMatchesSelector||y.oMatchesSelector||y.msMatchesSelector;K(function(e){e.innerHTML="<select><option selected=''></option></select>",e.querySelectorAll("[selected]").length||i.push("\\["+O+"*(?:checked|disabled|ismap|multiple|readonly|selected|value)"),e.querySelectorAll(":checked").length||i.push(":checked")}),K(function(e){e.innerHTML="<p test=''></p>",e.querySelectorAll("[test^='']").length&&i.push("[*^$]="+O+"*(?:\"\"|'')"),e.innerHTML="<input type='hidden'/>",e.querySelectorAll(":enabled").length||i.push(":enabled",":disabled")}),i=new RegExp(i.join("|")),vt=function(e,r,s,o,u){if(!o&&!u&&!i.test(e)){var a,f,l=!0,c=d,h=r,p=r.nodeType===9&&e;if(r.nodeType===1&&r.nodeName.toLowerCase()!=="object"){a=ut(e),(l=r.getAttribute("id"))?c=l.replace(n,"\\$&"):r.setAttribute("id",c),c="[id='"+c+"'] ",f=a.length;while(f--)a[f]=c+a[f].join("");h=z.test(e)&&r.parentNode||r,p=a.join(",")}if(p)try{return S.apply(s,x.call(h.querySelectorAll(p),0)),s}catch(v){}finally{l||r.removeAttribute("id")}}return t(e,r,s,o,u)},u&&(K(function(t){e=u.call(t,"div");try{u.call(t,"[test!='']:sizzle"),s.push("!=",H)}catch(n){}}),s=new RegExp(s.join("|")),nt.matchesSelector=function(t,n){n=n.replace(r,"='$1']");if(!o(t)&&!s.test(n)&&!i.test(n))try{var a=u.call(t,n);if(a||e||t.document&&t.document.nodeType!==11)return a}catch(f){}return nt(n,null,null,[t]).length>0})}(),i.pseudos.nth=i.pseudos.eq,i.filters=mt.prototype=i.pseudos,i.setFilters=new mt,nt.attr=v.attr,v.find=nt,v.expr=nt.selectors,v.expr[":"]=v.expr.pseudos,v.unique=nt.uniqueSort,v.text=nt.getText,v.isXMLDoc=nt.isXML,v.contains=nt.contains}(e);var nt=/Until$/,rt=/^(?:parents|prev(?:Until|All))/,it=/^.[^:#\[\.,]*$/,st=v.expr.match.needsContext,ot={children:!0,contents:!0,next:!0,prev:!0};v.fn.extend({find:function(e){var t,n,r,i,s,o,u=this;if(typeof e!="string")return v(e).filter(function(){for(t=0,n=u.length;t<n;t++)if(v.contains(u[t],this))return!0});o=this.pushStack("","find",e);for(t=0,n=this.length;t<n;t++){r=o.length,v.find(e,this[t],o);if(t>0)for(i=r;i<o.length;i++)for(s=0;s<r;s++)if(o[s]===o[i]){o.splice(i--,1);break}}return o},has:function(e){var t,n=v(e,this),r=n.length;return this.filter(function(){for(t=0;t<r;t++)if(v.contains(this,n[t]))return!0})},not:function(e){return this.pushStack(ft(this,e,!1),"not",e)},filter:function(e){return this.pushStack(ft(this,e,!0),"filter",e)},is:function(e){return!!e&&(typeof e=="string"?st.test(e)?v(e,this.context).index(this[0])>=0:v.filter(e,this).length>0:this.filter(e).length>0)},closest:function(e,t){var n,r=0,i=this.length,s=[],o=st.test(e)||typeof e!="string"?v(e,t||this.context):0;for(;r<i;r++){n=this[r];while(n&&n.ownerDocument&&n!==t&&n.nodeType!==11){if(o?o.index(n)>-1:v.find.matchesSelector(n,e)){s.push(n);break}n=n.parentNode}}return s=s.length>1?v.unique(s):s,this.pushStack(s,"closest",e)},index:function(e){return e?typeof e=="string"?v.inArray(this[0],v(e)):v.inArray(e.jquery?e[0]:e,this):this[0]&&this[0].parentNode?this.prevAll().length:-1},add:function(e,t){var n=typeof e=="string"?v(e,t):v.makeArray(e&&e.nodeType?[e]:e),r=v.merge(this.get(),n);return this.pushStack(ut(n[0])||ut(r[0])?r:v.unique(r))},addBack:function(e){return this.add(e==null?this.prevObject:this.prevObject.filter(e))}}),v.fn.andSelf=v.fn.addBack,v.each({parent:function(e){var t=e.parentNode;return t&&t.nodeType!==11?t:null},parents:function(e){return v.dir(e,"parentNode")},parentsUntil:function(e,t,n){return v.dir(e,"parentNode",n)},next:function(e){return at(e,"nextSibling")},prev:function(e){return at(e,"previousSibling")},nextAll:function(e){return v.dir(e,"nextSibling")},prevAll:function(e){return v.dir(e,"previousSibling")},nextUntil:function(e,t,n){return v.dir(e,"nextSibling",n)},prevUntil:function(e,t,n){return v.dir(e,"previousSibling",n)},siblings:function(e){return v.sibling((e.parentNode||{}).firstChild,e)},children:function(e){return v.sibling(e.firstChild)},contents:function(e){return v.nodeName(e,"iframe")?e.contentDocument||e.contentWindow.document:v.merge([],e.childNodes)}},function(e,t){v.fn[e]=function(n,r){var i=v.map(this,t,n);return nt.test(e)||(r=n),r&&typeof r=="string"&&(i=v.filter(r,i)),i=this.length>1&&!ot[e]?v.unique(i):i,this.length>1&&rt.test(e)&&(i=i.reverse()),this.pushStack(i,e,l.call(arguments).join(","))}}),v.extend({filter:function(e,t,n){return n&&(e=":not("+e+")"),t.length===1?v.find.matchesSelector(t[0],e)?[t[0]]:[]:v.find.matches(e,t)},dir:function(e,n,r){var i=[],s=e[n];while(s&&s.nodeType!==9&&(r===t||s.nodeType!==1||!v(s).is(r)))s.nodeType===1&&i.push(s),s=s[n];return i},sibling:function(e,t){var n=[];for(;e;e=e.nextSibling)e.nodeType===1&&e!==t&&n.push(e);return n}});var ct="abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",ht=/ jQuery\d+="(?:null|\d+)"/g,pt=/^\s+/,dt=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,vt=/<([\w:]+)/,mt=/<tbody/i,gt=/<|&#?\w+;/,yt=/<(?:script|style|link)/i,bt=/<(?:script|object|embed|option|style)/i,wt=new RegExp("<(?:"+ct+")[\\s/>]","i"),Et=/^(?:checkbox|radio)$/,St=/checked\s*(?:[^=]|=\s*.checked.)/i,xt=/\/(java|ecma)script/i,Tt=/^\s*<!(?:\[CDATA\[|\-\-)|[\]\-]{2}>\s*$/g,Nt={option:[1,"<select multiple='multiple'>","</select>"],legend:[1,"<fieldset>","</fieldset>"],thead:[1,"<table>","</table>"],tr:[2,"<table><tbody>","</tbody></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],col:[2,"<table><tbody></tbody><colgroup>","</colgroup></table>"],area:[1,"<map>","</map>"],_default:[0,"",""]},Ct=lt(i),kt=Ct.appendChild(i.createElement("div"));Nt.optgroup=Nt.option,Nt.tbody=Nt.tfoot=Nt.colgroup=Nt.caption=Nt.thead,Nt.th=Nt.td,v.support.htmlSerialize||(Nt._default=[1,"X<div>","</div>"]),v.fn.extend({text:function(e){return v.access(this,function(e){return e===t?v.text(this):this.empty().append((this[0]&&this[0].ownerDocument||i).createTextNode(e))},null,e,arguments.length)},wrapAll:function(e){if(v.isFunction(e))return this.each(function(t){v(this).wrapAll(e.call(this,t))});if(this[0]){var t=v(e,this[0].ownerDocument).eq(0).clone(!0);this[0].parentNode&&t.insertBefore(this[0]),t.map(function(){var e=this;while(e.firstChild&&e.firstChild.nodeType===1)e=e.firstChild;return e}).append(this)}return this},wrapInner:function(e){return v.isFunction(e)?this.each(function(t){v(this).wrapInner(e.call(this,t))}):this.each(function(){var t=v(this),n=t.contents();n.length?n.wrapAll(e):t.append(e)})},wrap:function(e){var t=v.isFunction(e);return this.each(function(n){v(this).wrapAll(t?e.call(this,n):e)})},unwrap:function(){return this.parent().each(function(){v.nodeName(this,"body")||v(this).replaceWith(this.childNodes)}).end()},append:function(){return this.domManip(arguments,!0,function(e){(this.nodeType===1||this.nodeType===11)&&this.appendChild(e)})},prepend:function(){return this.domManip(arguments,!0,function(e){(this.nodeType===1||this.nodeType===11)&&this.insertBefore(e,this.firstChild)})},before:function(){if(!ut(this[0]))return this.domManip(arguments,!1,function(e){this.parentNode.insertBefore(e,this)});if(arguments.length){var e=v.clean(arguments);return this.pushStack(v.merge(e,this),"before",this.selector)}},after:function(){if(!ut(this[0]))return this.domManip(arguments,!1,function(e){this.parentNode.insertBefore(e,this.nextSibling)});if(arguments.length){var e=v.clean(arguments);return this.pushStack(v.merge(this,e),"after",this.selector)}},remove:function(e,t){var n,r=0;for(;(n=this[r])!=null;r++)if(!e||v.filter(e,[n]).length)!t&&n.nodeType===1&&(v.cleanData(n.getElementsByTagName("*")),v.cleanData([n])),n.parentNode&&n.parentNode.removeChild(n);return this},empty:function(){var e,t=0;for(;(e=this[t])!=null;t++){e.nodeType===1&&v.cleanData(e.getElementsByTagName("*"));while(e.firstChild)e.removeChild(e.firstChild)}return this},clone:function(e,t){return e=e==null?!1:e,t=t==null?e:t,this.map(function(){return v.clone(this,e,t)})},html:function(e){return v.access(this,function(e){var n=this[0]||{},r=0,i=this.length;if(e===t)return n.nodeType===1?n.innerHTML.replace(ht,""):t;if(typeof e=="string"&&!yt.test(e)&&(v.support.htmlSerialize||!wt.test(e))&&(v.support.leadingWhitespace||!pt.test(e))&&!Nt[(vt.exec(e)||["",""])[1].toLowerCase()]){e=e.replace(dt,"<$1></$2>");try{for(;r<i;r++)n=this[r]||{},n.nodeType===1&&(v.cleanData(n.getElementsByTagName("*")),n.innerHTML=e);n=0}catch(s){}}n&&this.empty().append(e)},null,e,arguments.length)},replaceWith:function(e){return ut(this[0])?this.length?this.pushStack(v(v.isFunction(e)?e():e),"replaceWith",e):this:v.isFunction(e)?this.each(function(t){var n=v(this),r=n.html();n.replaceWith(e.call(this,t,r))}):(typeof e!="string"&&(e=v(e).detach()),this.each(function(){var t=this.nextSibling,n=this.parentNode;v(this).remove(),t?v(t).before(e):v(n).append(e)}))},detach:function(e){return this.remove(e,!0)},domManip:function(e,n,r){e=[].concat.apply([],e);var i,s,o,u,a=0,f=e[0],l=[],c=this.length;if(!v.support.checkClone&&c>1&&typeof f=="string"&&St.test(f))return this.each(function(){v(this).domManip(e,n,r)});if(v.isFunction(f))return this.each(function(i){var s=v(this);e[0]=f.call(this,i,n?s.html():t),s.domManip(e,n,r)});if(this[0]){i=v.buildFragment(e,this,l),o=i.fragment,s=o.firstChild,o.childNodes.length===1&&(o=s);if(s){n=n&&v.nodeName(s,"tr");for(u=i.cacheable||c-1;a<c;a++)r.call(n&&v.nodeName(this[a],"table")?Lt(this[a],"tbody"):this[a],a===u?o:v.clone(o,!0,!0))}o=s=null,l.length&&v.each(l,function(e,t){t.src?v.ajax?v.ajax({url:t.src,type:"GET",dataType:"script",async:!1,global:!1,"throws":!0}):v.error("no ajax"):v.globalEval((t.text||t.textContent||t.innerHTML||"").replace(Tt,"")),t.parentNode&&t.parentNode.removeChild(t)})}return this}}),v.buildFragment=function(e,n,r){var s,o,u,a=e[0];return n=n||i,n=!n.nodeType&&n[0]||n,n=n.ownerDocument||n,e.length===1&&typeof a=="string"&&a.length<512&&n===i&&a.charAt(0)==="<"&&!bt.test(a)&&(v.support.checkClone||!St.test(a))&&(v.support.html5Clone||!wt.test(a))&&(o=!0,s=v.fragments[a],u=s!==t),s||(s=n.createDocumentFragment(),v.clean(e,n,s,r),o&&(v.fragments[a]=u&&s)),{fragment:s,cacheable:o}},v.fragments={},v.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(e,t){v.fn[e]=function(n){var r,i=0,s=[],o=v(n),u=o.length,a=this.length===1&&this[0].parentNode;if((a==null||a&&a.nodeType===11&&a.childNodes.length===1)&&u===1)return o[t](this[0]),this;for(;i<u;i++)r=(i>0?this.clone(!0):this).get(),v(o[i])[t](r),s=s.concat(r);return this.pushStack(s,e,o.selector)}}),v.extend({clone:function(e,t,n){var r,i,s,o;v.support.html5Clone||v.isXMLDoc(e)||!wt.test("<"+e.nodeName+">")?o=e.cloneNode(!0):(kt.innerHTML=e.outerHTML,kt.removeChild(o=kt.firstChild));if((!v.support.noCloneEvent||!v.support.noCloneChecked)&&(e.nodeType===1||e.nodeType===11)&&!v.isXMLDoc(e)){Ot(e,o),r=Mt(e),i=Mt(o);for(s=0;r[s];++s)i[s]&&Ot(r[s],i[s])}if(t){At(e,o);if(n){r=Mt(e),i=Mt(o);for(s=0;r[s];++s)At(r[s],i[s])}}return r=i=null,o},clean:function(e,t,n,r){var s,o,u,a,f,l,c,h,p,d,m,g,y=t===i&&Ct,b=[];if(!t||typeof t.createDocumentFragment=="undefined")t=i;for(s=0;(u=e[s])!=null;s++){typeof u=="number"&&(u+="");if(!u)continue;if(typeof u=="string")if(!gt.test(u))u=t.createTextNode(u);else{y=y||lt(t),c=t.createElement("div"),y.appendChild(c),u=u.replace(dt,"<$1></$2>"),a=(vt.exec(u)||["",""])[1].toLowerCase(),f=Nt[a]||Nt._default,l=f[0],c.innerHTML=f[1]+u+f[2];while(l--)c=c.lastChild;if(!v.support.tbody){h=mt.test(u),p=a==="table"&&!h?c.firstChild&&c.firstChild.childNodes:f[1]==="<table>"&&!h?c.childNodes:[];for(o=p.length-1;o>=0;--o)v.nodeName(p[o],"tbody")&&!p[o].childNodes.length&&p[o].parentNode.removeChild(p[o])}!v.support.leadingWhitespace&&pt.test(u)&&c.insertBefore(t.createTextNode(pt.exec(u)[0]),c.firstChild),u=c.childNodes,c.parentNode.removeChild(c)}u.nodeType?b.push(u):v.merge(b,u)}c&&(u=c=y=null);if(!v.support.appendChecked)for(s=0;(u=b[s])!=null;s++)v.nodeName(u,"input")?_t(u):typeof u.getElementsByTagName!="undefined"&&v.grep(u.getElementsByTagName("input"),_t);if(n){m=function(e){if(!e.type||xt.test(e.type))return r?r.push(e.parentNode?e.parentNode.removeChild(e):e):n.appendChild(e)};for(s=0;(u=b[s])!=null;s++)if(!v.nodeName(u,"script")||!m(u))n.appendChild(u),typeof u.getElementsByTagName!="undefined"&&(g=v.grep(v.merge([],u.getElementsByTagName("script")),m),b.splice.apply(b,[s+1,0].concat(g)),s+=g.length)}return b},cleanData:function(e,t){var n,r,i,s,o=0,u=v.expando,a=v.cache,f=v.support.deleteExpando,l=v.event.special;for(;(i=e[o])!=null;o++)if(t||v.acceptData(i)){r=i[u],n=r&&a[r];if(n){if(n.events)for(s in n.events)l[s]?v.event.remove(i,s):v.removeEvent(i,s,n.handle);a[r]&&(delete a[r],f?delete i[u]:i.removeAttribute?i.removeAttribute(u):i[u]=null,v.deletedIds.push(r))}}}}),function(){var e,t;v.uaMatch=function(e){e=e.toLowerCase();var t=/(chrome)[ \/]([\w.]+)/.exec(e)||/(webkit)[ \/]([\w.]+)/.exec(e)||/(opera)(?:.*version|)[ \/]([\w.]+)/.exec(e)||/(msie) ([\w.]+)/.exec(e)||e.indexOf("compatible")<0&&/(mozilla)(?:.*? rv:([\w.]+)|)/.exec(e)||[];return{browser:t[1]||"",version:t[2]||"0"}},e=v.uaMatch(o.userAgent),t={},e.browser&&(t[e.browser]=!0,t.version=e.version),t.chrome?t.webkit=!0:t.webkit&&(t.safari=!0),v.browser=t,v.sub=function(){function e(t,n){return new e.fn.init(t,n)}v.extend(!0,e,this),e.superclass=this,e.fn=e.prototype=this(),e.fn.constructor=e,e.sub=this.sub,e.fn.init=function(r,i){return i&&i instanceof v&&!(i instanceof e)&&(i=e(i)),v.fn.init.call(this,r,i,t)},e.fn.init.prototype=e.fn;var t=e(i);return e}}();var Dt,Pt,Ht,Bt=/alpha\([^)]*\)/i,jt=/opacity=([^)]*)/,Ft=/^(top|right|bottom|left)$/,It=/^(none|table(?!-c[ea]).+)/,qt=/^margin/,Rt=new RegExp("^("+m+")(.*)$","i"),Ut=new RegExp("^("+m+")(?!px)[a-z%]+$","i"),zt=new RegExp("^([-+])=("+m+")","i"),Wt={BODY:"block"},Xt={position:"absolute",visibility:"hidden",display:"block"},Vt={letterSpacing:0,fontWeight:400},$t=["Top","Right","Bottom","Left"],Jt=["Webkit","O","Moz","ms"],Kt=v.fn.toggle;v.fn.extend({css:function(e,n){return v.access(this,function(e,n,r){return r!==t?v.style(e,n,r):v.css(e,n)},e,n,arguments.length>1)},show:function(){return Yt(this,!0)},hide:function(){return Yt(this)},toggle:function(e,t){var n=typeof e=="boolean";return v.isFunction(e)&&v.isFunction(t)?Kt.apply(this,arguments):this.each(function(){(n?e:Gt(this))?v(this).show():v(this).hide()})}}),v.extend({cssHooks:{opacity:{get:function(e,t){if(t){var n=Dt(e,"opacity");return n===""?"1":n}}}},cssNumber:{fillOpacity:!0,fontWeight:!0,lineHeight:!0,opacity:!0,orphans:!0,widows:!0,zIndex:!0,zoom:!0},cssProps:{"float":v.support.cssFloat?"cssFloat":"styleFloat"},style:function(e,n,r,i){if(!e||e.nodeType===3||e.nodeType===8||!e.style)return;var s,o,u,a=v.camelCase(n),f=e.style;n=v.cssProps[a]||(v.cssProps[a]=Qt(f,a)),u=v.cssHooks[n]||v.cssHooks[a];if(r===t)return u&&"get"in u&&(s=u.get(e,!1,i))!==t?s:f[n];o=typeof r,o==="string"&&(s=zt.exec(r))&&(r=(s[1]+1)*s[2]+parseFloat(v.css(e,n)),o="number");if(r==null||o==="number"&&isNaN(r))return;o==="number"&&!v.cssNumber[a]&&(r+="px");if(!u||!("set"in u)||(r=u.set(e,r,i))!==t)try{f[n]=r}catch(l){}},css:function(e,n,r,i){var s,o,u,a=v.camelCase(n);return n=v.cssProps[a]||(v.cssProps[a]=Qt(e.style,a)),u=v.cssHooks[n]||v.cssHooks[a],u&&"get"in u&&(s=u.get(e,!0,i)),s===t&&(s=Dt(e,n)),s==="normal"&&n in Vt&&(s=Vt[n]),r||i!==t?(o=parseFloat(s),r||v.isNumeric(o)?o||0:s):s},swap:function(e,t,n){var r,i,s={};for(i in t)s[i]=e.style[i],e.style[i]=t[i];r=n.call(e);for(i in t)e.style[i]=s[i];return r}}),e.getComputedStyle?Dt=function(t,n){var r,i,s,o,u=e.getComputedStyle(t,null),a=t.style;return u&&(r=u.getPropertyValue(n)||u[n],r===""&&!v.contains(t.ownerDocument,t)&&(r=v.style(t,n)),Ut.test(r)&&qt.test(n)&&(i=a.width,s=a.minWidth,o=a.maxWidth,a.minWidth=a.maxWidth=a.width=r,r=u.width,a.width=i,a.minWidth=s,a.maxWidth=o)),r}:i.documentElement.currentStyle&&(Dt=function(e,t){var n,r,i=e.currentStyle&&e.currentStyle[t],s=e.style;return i==null&&s&&s[t]&&(i=s[t]),Ut.test(i)&&!Ft.test(t)&&(n=s.left,r=e.runtimeStyle&&e.runtimeStyle.left,r&&(e.runtimeStyle.left=e.currentStyle.left),s.left=t==="fontSize"?"1em":i,i=s.pixelLeft+"px",s.left=n,r&&(e.runtimeStyle.left=r)),i===""?"auto":i}),v.each(["height","width"],function(e,t){v.cssHooks[t]={get:function(e,n,r){if(n)return e.offsetWidth===0&&It.test(Dt(e,"display"))?v.swap(e,Xt,function(){return tn(e,t,r)}):tn(e,t,r)},set:function(e,n,r){return Zt(e,n,r?en(e,t,r,v.support.boxSizing&&v.css(e,"boxSizing")==="border-box"):0)}}}),v.support.opacity||(v.cssHooks.opacity={get:function(e,t){return jt.test((t&&e.currentStyle?e.currentStyle.filter:e.style.filter)||"")?.01*parseFloat(RegExp.$1)+"":t?"1":""},set:function(e,t){var n=e.style,r=e.currentStyle,i=v.isNumeric(t)?"alpha(opacity="+t*100+")":"",s=r&&r.filter||n.filter||"";n.zoom=1;if(t>=1&&v.trim(s.replace(Bt,""))===""&&n.removeAttribute){n.removeAttribute("filter");if(r&&!r.filter)return}n.filter=Bt.test(s)?s.replace(Bt,i):s+" "+i}}),v(function(){v.support.reliableMarginRight||(v.cssHooks.marginRight={get:function(e,t){return v.swap(e,{display:"inline-block"},function(){if(t)return Dt(e,"marginRight")})}}),!v.support.pixelPosition&&v.fn.position&&v.each(["top","left"],function(e,t){v.cssHooks[t]={get:function(e,n){if(n){var r=Dt(e,t);return Ut.test(r)?v(e).position()[t]+"px":r}}}})}),v.expr&&v.expr.filters&&(v.expr.filters.hidden=function(e){return e.offsetWidth===0&&e.offsetHeight===0||!v.support.reliableHiddenOffsets&&(e.style&&e.style.display||Dt(e,"display"))==="none"},v.expr.filters.visible=function(e){return!v.expr.filters.hidden(e)}),v.each({margin:"",padding:"",border:"Width"},function(e,t){v.cssHooks[e+t]={expand:function(n){var r,i=typeof n=="string"?n.split(" "):[n],s={};for(r=0;r<4;r++)s[e+$t[r]+t]=i[r]||i[r-2]||i[0];return s}},qt.test(e)||(v.cssHooks[e+t].set=Zt)});var rn=/%20/g,sn=/\[\]$/,on=/\r?\n/g,un=/^(?:color|date|datetime|datetime-local|email|hidden|month|number|password|range|search|tel|text|time|url|week)$/i,an=/^(?:select|textarea)/i;v.fn.extend({serialize:function(){return v.param(this.serializeArray())},serializeArray:function(){return this.map(function(){return this.elements?v.makeArray(this.elements):this}).filter(function(){return this.name&&!this.disabled&&(this.checked||an.test(this.nodeName)||un.test(this.type))}).map(function(e,t){var n=v(this).val();return n==null?null:v.isArray(n)?v.map(n,function(e,n){return{name:t.name,value:e.replace(on,"\r\n")}}):{name:t.name,value:n.replace(on,"\r\n")}}).get()}}),v.param=function(e,n){var r,i=[],s=function(e,t){t=v.isFunction(t)?t():t==null?"":t,i[i.length]=encodeURIComponent(e)+"="+encodeURIComponent(t)};n===t&&(n=v.ajaxSettings&&v.ajaxSettings.traditional);if(v.isArray(e)||e.jquery&&!v.isPlainObject(e))v.each(e,function(){s(this.name,this.value)});else for(r in e)fn(r,e[r],n,s);return i.join("&").replace(rn,"+")};var ln,cn,hn=/#.*$/,pn=/^(.*?):[ \t]*([^\r\n]*)\r?$/mg,dn=/^(?:about|app|app\-storage|.+\-extension|file|res|widget):$/,vn=/^(?:GET|HEAD)$/,mn=/^\/\//,gn=/\?/,yn=/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,bn=/([?&])_=[^&]*/,wn=/^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,En=v.fn.load,Sn={},xn={},Tn=["*/"]+["*"];try{cn=s.href}catch(Nn){cn=i.createElement("a"),cn.href="",cn=cn.href}ln=wn.exec(cn.toLowerCase())||[],v.fn.load=function(e,n,r){if(typeof e!="string"&&En)return En.apply(this,arguments);if(!this.length)return this;var i,s,o,u=this,a=e.indexOf(" ");return a>=0&&(i=e.slice(a,e.length),e=e.slice(0,a)),v.isFunction(n)?(r=n,n=t):n&&typeof n=="object"&&(s="POST"),v.ajax({url:e,type:s,dataType:"html",data:n,complete:function(e,t){r&&u.each(r,o||[e.responseText,t,e])}}).done(function(e){o=arguments,u.html(i?v("<div>").append(e.replace(yn,"")).find(i):e)}),this},v.each("ajaxStart ajaxStop ajaxComplete ajaxError ajaxSuccess ajaxSend".split(" "),function(e,t){v.fn[t]=function(e){return this.on(t,e)}}),v.each(["get","post"],function(e,n){v[n]=function(e,r,i,s){return v.isFunction(r)&&(s=s||i,i=r,r=t),v.ajax({type:n,url:e,data:r,success:i,dataType:s})}}),v.extend({getScript:function(e,n){return v.get(e,t,n,"script")},getJSON:function(e,t,n){return v.get(e,t,n,"json")},ajaxSetup:function(e,t){return t?Ln(e,v.ajaxSettings):(t=e,e=v.ajaxSettings),Ln(e,t),e},ajaxSettings:{url:cn,isLocal:dn.test(ln[1]),global:!0,type:"GET",contentType:"application/x-www-form-urlencoded; charset=UTF-8",processData:!0,async:!0,accepts:{xml:"application/xml, text/xml",html:"text/html",text:"text/plain",json:"application/json, text/javascript","*":Tn},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText"},converters:{"* text":e.String,"text html":!0,"text json":v.parseJSON,"text xml":v.parseXML},flatOptions:{context:!0,url:!0}},ajaxPrefilter:Cn(Sn),ajaxTransport:Cn(xn),ajax:function(e,n){function T(e,n,s,a){var l,y,b,w,S,T=n;if(E===2)return;E=2,u&&clearTimeout(u),o=t,i=a||"",x.readyState=e>0?4:0,s&&(w=An(c,x,s));if(e>=200&&e<300||e===304)c.ifModified&&(S=x.getResponseHeader("Last-Modified"),S&&(v.lastModified[r]=S),S=x.getResponseHeader("Etag"),S&&(v.etag[r]=S)),e===304?(T="notmodified",l=!0):(l=On(c,w),T=l.state,y=l.data,b=l.error,l=!b);else{b=T;if(!T||e)T="error",e<0&&(e=0)}x.status=e,x.statusText=(n||T)+"",l?d.resolveWith(h,[y,T,x]):d.rejectWith(h,[x,T,b]),x.statusCode(g),g=t,f&&p.trigger("ajax"+(l?"Success":"Error"),[x,c,l?y:b]),m.fireWith(h,[x,T]),f&&(p.trigger("ajaxComplete",[x,c]),--v.active||v.event.trigger("ajaxStop"))}typeof e=="object"&&(n=e,e=t),n=n||{};var r,i,s,o,u,a,f,l,c=v.ajaxSetup({},n),h=c.context||c,p=h!==c&&(h.nodeType||h instanceof v)?v(h):v.event,d=v.Deferred(),m=v.Callbacks("once memory"),g=c.statusCode||{},b={},w={},E=0,S="canceled",x={readyState:0,setRequestHeader:function(e,t){if(!E){var n=e.toLowerCase();e=w[n]=w[n]||e,b[e]=t}return this},getAllResponseHeaders:function(){return E===2?i:null},getResponseHeader:function(e){var n;if(E===2){if(!s){s={};while(n=pn.exec(i))s[n[1].toLowerCase()]=n[2]}n=s[e.toLowerCase()]}return n===t?null:n},overrideMimeType:function(e){return E||(c.mimeType=e),this},abort:function(e){return e=e||S,o&&o.abort(e),T(0,e),this}};d.promise(x),x.success=x.done,x.error=x.fail,x.complete=m.add,x.statusCode=function(e){if(e){var t;if(E<2)for(t in e)g[t]=[g[t],e[t]];else t=e[x.status],x.always(t)}return this},c.url=((e||c.url)+"").replace(hn,"").replace(mn,ln[1]+"//"),c.dataTypes=v.trim(c.dataType||"*").toLowerCase().split(y),c.crossDomain==null&&(a=wn.exec(c.url.toLowerCase()),c.crossDomain=!(!a||a[1]===ln[1]&&a[2]===ln[2]&&(a[3]||(a[1]==="http:"?80:443))==(ln[3]||(ln[1]==="http:"?80:443)))),c.data&&c.processData&&typeof c.data!="string"&&(c.data=v.param(c.data,c.traditional)),kn(Sn,c,n,x);if(E===2)return x;f=c.global,c.type=c.type.toUpperCase(),c.hasContent=!vn.test(c.type),f&&v.active++===0&&v.event.trigger("ajaxStart");if(!c.hasContent){c.data&&(c.url+=(gn.test(c.url)?"&":"?")+c.data,delete c.data),r=c.url;if(c.cache===!1){var N=v.now(),C=c.url.replace(bn,"$1_="+N);c.url=C+(C===c.url?(gn.test(c.url)?"&":"?")+"_="+N:"")}}(c.data&&c.hasContent&&c.contentType!==!1||n.contentType)&&x.setRequestHeader("Content-Type",c.contentType),c.ifModified&&(r=r||c.url,v.lastModified[r]&&x.setRequestHeader("If-Modified-Since",v.lastModified[r]),v.etag[r]&&x.setRequestHeader("If-None-Match",v.etag[r])),x.setRequestHeader("Accept",c.dataTypes[0]&&c.accepts[c.dataTypes[0]]?c.accepts[c.dataTypes[0]]+(c.dataTypes[0]!=="*"?", "+Tn+"; q=0.01":""):c.accepts["*"]);for(l in c.headers)x.setRequestHeader(l,c.headers[l]);if(!c.beforeSend||c.beforeSend.call(h,x,c)!==!1&&E!==2){S="abort";for(l in{success:1,error:1,complete:1})x[l](c[l]);o=kn(xn,c,n,x);if(!o)T(-1,"No Transport");else{x.readyState=1,f&&p.trigger("ajaxSend",[x,c]),c.async&&c.timeout>0&&(u=setTimeout(function(){x.abort("timeout")},c.timeout));try{E=1,o.send(b,T)}catch(k){if(!(E<2))throw k;T(-1,k)}}return x}return x.abort()},active:0,lastModified:{},etag:{}});var Mn=[],_n=/\?/,Dn=/(=)\?(?=&|$)|\?\?/,Pn=v.now();v.ajaxSetup({jsonp:"callback",jsonpCallback:function(){var e=Mn.pop()||v.expando+"_"+Pn++;return this[e]=!0,e}}),v.ajaxPrefilter("json jsonp",function(n,r,i){var s,o,u,a=n.data,f=n.url,l=n.jsonp!==!1,c=l&&Dn.test(f),h=l&&!c&&typeof a=="string"&&!(n.contentType||"").indexOf("application/x-www-form-urlencoded")&&Dn.test(a);if(n.dataTypes[0]==="jsonp"||c||h)return s=n.jsonpCallback=v.isFunction(n.jsonpCallback)?n.jsonpCallback():n.jsonpCallback,o=e[s],c?n.url=f.replace(Dn,"$1"+s):h?n.data=a.replace(Dn,"$1"+s):l&&(n.url+=(_n.test(f)?"&":"?")+n.jsonp+"="+s),n.converters["script json"]=function(){return u||v.error(s+" was not called"),u[0]},n.dataTypes[0]="json",e[s]=function(){u=arguments},i.always(function(){e[s]=o,n[s]&&(n.jsonpCallback=r.jsonpCallback,Mn.push(s)),u&&v.isFunction(o)&&o(u[0]),u=o=t}),"script"}),v.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/javascript|ecmascript/},converters:{"text script":function(e){return v.globalEval(e),e}}}),v.ajaxPrefilter("script",function(e){e.cache===t&&(e.cache=!1),e.crossDomain&&(e.type="GET",e.global=!1)}),v.ajaxTransport("script",function(e){if(e.crossDomain){var n,r=i.head||i.getElementsByTagName("head")[0]||i.documentElement;return{send:function(s,o){n=i.createElement("script"),n.async="async",e.scriptCharset&&(n.charset=e.scriptCharset),n.src=e.url,n.onload=n.onreadystatechange=function(e,i){if(i||!n.readyState||/loaded|complete/.test(n.readyState))n.onload=n.onreadystatechange=null,r&&n.parentNode&&r.removeChild(n),n=t,i||o(200,"success")},r.insertBefore(n,r.firstChild)},abort:function(){n&&n.onload(0,1)}}}});var Hn,Bn=e.ActiveXObject?function(){for(var e in Hn)Hn[e](0,1)}:!1,jn=0;v.ajaxSettings.xhr=e.ActiveXObject?function(){return!this.isLocal&&Fn()||In()}:Fn,function(e){v.extend(v.support,{ajax:!!e,cors:!!e&&"withCredentials"in e})}(v.ajaxSettings.xhr()),v.support.ajax&&v.ajaxTransport(function(n){if(!n.crossDomain||v.support.cors){var r;return{send:function(i,s){var o,u,a=n.xhr();n.username?a.open(n.type,n.url,n.async,n.username,n.password):a.open(n.type,n.url,n.async);if(n.xhrFields)for(u in n.xhrFields)a[u]=n.xhrFields[u];n.mimeType&&a.overrideMimeType&&a.overrideMimeType(n.mimeType),!n.crossDomain&&!i["X-Requested-With"]&&(i["X-Requested-With"]="XMLHttpRequest");try{for(u in i)a.setRequestHeader(u,i[u])}catch(f){}a.send(n.hasContent&&n.data||null),r=function(e,i){var u,f,l,c,h;try{if(r&&(i||a.readyState===4)){r=t,o&&(a.onreadystatechange=v.noop,Bn&&delete Hn[o]);if(i)a.readyState!==4&&a.abort();else{u=a.status,l=a.getAllResponseHeaders(),c={},h=a.responseXML,h&&h.documentElement&&(c.xml=h);try{c.text=a.responseText}catch(p){}try{f=a.statusText}catch(p){f=""}!u&&n.isLocal&&!n.crossDomain?u=c.text?200:404:u===1223&&(u=204)}}}catch(d){i||s(-1,d)}c&&s(u,f,c,l)},n.async?a.readyState===4?setTimeout(r,0):(o=++jn,Bn&&(Hn||(Hn={},v(e).unload(Bn)),Hn[o]=r),a.onreadystatechange=r):r()},abort:function(){r&&r(0,1)}}}});var qn,Rn,Un=/^(?:toggle|show|hide)$/,zn=new RegExp("^(?:([-+])=|)("+m+")([a-z%]*)$","i"),Wn=/queueHooks$/,Xn=[Gn],Vn={"*":[function(e,t){var n,r,i=this.createTween(e,t),s=zn.exec(t),o=i.cur(),u=+o||0,a=1,f=20;if(s){n=+s[2],r=s[3]||(v.cssNumber[e]?"":"px");if(r!=="px"&&u){u=v.css(i.elem,e,!0)||n||1;do a=a||".5",u/=a,v.style(i.elem,e,u+r);while(a!==(a=i.cur()/o)&&a!==1&&--f)}i.unit=r,i.start=u,i.end=s[1]?u+(s[1]+1)*n:n}return i}]};v.Animation=v.extend(Kn,{tweener:function(e,t){v.isFunction(e)?(t=e,e=["*"]):e=e.split(" ");var n,r=0,i=e.length;for(;r<i;r++)n=e[r],Vn[n]=Vn[n]||[],Vn[n].unshift(t)},prefilter:function(e,t){t?Xn.unshift(e):Xn.push(e)}}),v.Tween=Yn,Yn.prototype={constructor:Yn,init:function(e,t,n,r,i,s){this.elem=e,this.prop=n,this.easing=i||"swing",this.options=t,this.start=this.now=this.cur(),this.end=r,this.unit=s||(v.cssNumber[n]?"":"px")},cur:function(){var e=Yn.propHooks[this.prop];return e&&e.get?e.get(this):Yn.propHooks._default.get(this)},run:function(e){var t,n=Yn.propHooks[this.prop];return this.options.duration?this.pos=t=v.easing[this.easing](e,this.options.duration*e,0,1,this.options.duration):this.pos=t=e,this.now=(this.end-this.start)*t+this.start,this.options.step&&this.options.step.call(this.elem,this.now,this),n&&n.set?n.set(this):Yn.propHooks._default.set(this),this}},Yn.prototype.init.prototype=Yn.prototype,Yn.propHooks={_default:{get:function(e){var t;return e.elem[e.prop]==null||!!e.elem.style&&e.elem.style[e.prop]!=null?(t=v.css(e.elem,e.prop,!1,""),!t||t==="auto"?0:t):e.elem[e.prop]},set:function(e){v.fx.step[e.prop]?v.fx.step[e.prop](e):e.elem.style&&(e.elem.style[v.cssProps[e.prop]]!=null||v.cssHooks[e.prop])?v.style(e.elem,e.prop,e.now+e.unit):e.elem[e.prop]=e.now}}},Yn.propHooks.scrollTop=Yn.propHooks.scrollLeft={set:function(e){e.elem.nodeType&&e.elem.parentNode&&(e.elem[e.prop]=e.now)}},v.each(["toggle","show","hide"],function(e,t){var n=v.fn[t];v.fn[t]=function(r,i,s){return r==null||typeof r=="boolean"||!e&&v.isFunction(r)&&v.isFunction(i)?n.apply(this,arguments):this.animate(Zn(t,!0),r,i,s)}}),v.fn.extend({fadeTo:function(e,t,n,r){return this.filter(Gt).css("opacity",0).show().end().animate({opacity:t},e,n,r)},animate:function(e,t,n,r){var i=v.isEmptyObject(e),s=v.speed(t,n,r),o=function(){var t=Kn(this,v.extend({},e),s);i&&t.stop(!0)};return i||s.queue===!1?this.each(o):this.queue(s.queue,o)},stop:function(e,n,r){var i=function(e){var t=e.stop;delete e.stop,t(r)};return typeof e!="string"&&(r=n,n=e,e=t),n&&e!==!1&&this.queue(e||"fx",[]),this.each(function(){var t=!0,n=e!=null&&e+"queueHooks",s=v.timers,o=v._data(this);if(n)o[n]&&o[n].stop&&i(o[n]);else for(n in o)o[n]&&o[n].stop&&Wn.test(n)&&i(o[n]);for(n=s.length;n--;)s[n].elem===this&&(e==null||s[n].queue===e)&&(s[n].anim.stop(r),t=!1,s.splice(n,1));(t||!r)&&v.dequeue(this,e)})}}),v.each({slideDown:Zn("show"),slideUp:Zn("hide"),slideToggle:Zn("toggle"),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(e,t){v.fn[e]=function(e,n,r){return this.animate(t,e,n,r)}}),v.speed=function(e,t,n){var r=e&&typeof e=="object"?v.extend({},e):{complete:n||!n&&t||v.isFunction(e)&&e,duration:e,easing:n&&t||t&&!v.isFunction(t)&&t};r.duration=v.fx.off?0:typeof r.duration=="number"?r.duration:r.duration in v.fx.speeds?v.fx.speeds[r.duration]:v.fx.speeds._default;if(r.queue==null||r.queue===!0)r.queue="fx";return r.old=r.complete,r.complete=function(){v.isFunction(r.old)&&r.old.call(this),r.queue&&v.dequeue(this,r.queue)},r},v.easing={linear:function(e){return e},swing:function(e){return.5-Math.cos(e*Math.PI)/2}},v.timers=[],v.fx=Yn.prototype.init,v.fx.tick=function(){var e,n=v.timers,r=0;qn=v.now();for(;r<n.length;r++)e=n[r],!e()&&n[r]===e&&n.splice(r--,1);n.length||v.fx.stop(),qn=t},v.fx.timer=function(e){e()&&v.timers.push(e)&&!Rn&&(Rn=setInterval(v.fx.tick,v.fx.interval))},v.fx.interval=13,v.fx.stop=function(){clearInterval(Rn),Rn=null},v.fx.speeds={slow:600,fast:200,_default:400},v.fx.step={},v.expr&&v.expr.filters&&(v.expr.filters.animated=function(e){return v.grep(v.timers,function(t){return e===t.elem}).length});var er=/^(?:body|html)$/i;v.fn.offset=function(e){if(arguments.length)return e===t?this:this.each(function(t){v.offset.setOffset(this,e,t)});var n,r,i,s,o,u,a,f={top:0,left:0},l=this[0],c=l&&l.ownerDocument;if(!c)return;return(r=c.body)===l?v.offset.bodyOffset(l):(n=c.documentElement,v.contains(n,l)?(typeof l.getBoundingClientRect!="undefined"&&(f=l.getBoundingClientRect()),i=tr(c),s=n.clientTop||r.clientTop||0,o=n.clientLeft||r.clientLeft||0,u=i.pageYOffset||n.scrollTop,a=i.pageXOffset||n.scrollLeft,{top:f.top+u-s,left:f.left+a-o}):f)},v.offset={bodyOffset:function(e){var t=e.offsetTop,n=e.offsetLeft;return v.support.doesNotIncludeMarginInBodyOffset&&(t+=parseFloat(v.css(e,"marginTop"))||0,n+=parseFloat(v.css(e,"marginLeft"))||0),{top:t,left:n}},setOffset:function(e,t,n){var r=v.css(e,"position");r==="static"&&(e.style.position="relative");var i=v(e),s=i.offset(),o=v.css(e,"top"),u=v.css(e,"left"),a=(r==="absolute"||r==="fixed")&&v.inArray("auto",[o,u])>-1,f={},l={},c,h;a?(l=i.position(),c=l.top,h=l.left):(c=parseFloat(o)||0,h=parseFloat(u)||0),v.isFunction(t)&&(t=t.call(e,n,s)),t.top!=null&&(f.top=t.top-s.top+c),t.left!=null&&(f.left=t.left-s.left+h),"using"in t?t.using.call(e,f):i.css(f)}},v.fn.extend({position:function(){if(!this[0])return;var e=this[0],t=this.offsetParent(),n=this.offset(),r=er.test(t[0].nodeName)?{top:0,left:0}:t.offset();return n.top-=parseFloat(v.css(e,"marginTop"))||0,n.left-=parseFloat(v.css(e,"marginLeft"))||0,r.top+=parseFloat(v.css(t[0],"borderTopWidth"))||0,r.left+=parseFloat(v.css(t[0],"borderLeftWidth"))||0,{top:n.top-r.top,left:n.left-r.left}},offsetParent:function(){return this.map(function(){var e=this.offsetParent||i.body;while(e&&!er.test(e.nodeName)&&v.css(e,"position")==="static")e=e.offsetParent;return e||i.body})}}),v.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(e,n){var r=/Y/.test(n);v.fn[e]=function(i){return v.access(this,function(e,i,s){var o=tr(e);if(s===t)return o?n in o?o[n]:o.document.documentElement[i]:e[i];o?o.scrollTo(r?v(o).scrollLeft():s,r?s:v(o).scrollTop()):e[i]=s},e,i,arguments.length,null)}}),v.each({Height:"height",Width:"width"},function(e,n){v.each({padding:"inner"+e,content:n,"":"outer"+e},function(r,i){v.fn[i]=function(i,s){var o=arguments.length&&(r||typeof i!="boolean"),u=r||(i===!0||s===!0?"margin":"border");return v.access(this,function(n,r,i){var s;return v.isWindow(n)?n.document.documentElement["client"+e]:n.nodeType===9?(s=n.documentElement,Math.max(n.body["scroll"+e],s["scroll"+e],n.body["offset"+e],s["offset"+e],s["client"+e])):i===t?v.css(n,r,i,u):v.style(n,r,i,u)},n,o?i:t,o,null)}})}),e.jQuery=e.$=v,typeof define=="function"&&define.amd&&define.amd.jQuery&&define("jquery",[],function(){return v})}(window),function(e,t){function st(e){if(e&&typeof e=="object"&&e.__wrapped__)return e;if(!(this instanceof st))return new st(e);this.__wrapped__=e}function ft(e){return e.charCodeAt(0)}function lt(e,t){var n=e.index,r=t.index;e=e.criteria,t=t.criteria;if(e!==t){if(e>t||typeof e=="undefined")return 1;if(e<t||typeof t=="undefined")return-1}return n<r?-1:1}function ct(e,t,n){function r(){var i=arguments,s=t;n.length&&(i=i.length?n.concat(bt(i)):n);if(this instanceof r){yt.prototype=e.prototype,s=new yt,yt.prototype=null;var o=e.apply(s,i);return Ut(o)?o:s}return e.apply(s,i)}return r}function ht(e,t,n){return e?typeof e!="function"?function(t){return t[e]}:typeof t!="undefined"?n?function(n,r,i,s){return e.call(t,n,r,i,s)}:function(n,r,i){return e.call(t,n,r,i)}:e:Qn}function pt(){var e={arrayLoop:"",bottom:"",hasDontEnumBug:hasDontEnumBug,objectLoop:"",nonEnumArgs:nonEnumArgs,noCharByIndex:et,shadowed:S,top:"",useHas:!0};for(var t,n=0;t=arguments[n];n++)for(var r in t)e[r]=t[r];var i=e.args;e.firstArg=/^[^,]+/.exec(i)[0];var s=Function("createCallback, hasOwnProperty, isString, objectTypes, nativeKeys, propertyIsEnumerable","return function("+i+") {\n"+e+"\n}");return s(ht,L,$t,rt,B,O)}function vt(e){return"\\"+it[e]}function mt(e){return kt[e]}function gt(e){return typeof e.toString!="function"&&typeof (e+"")=="string"}function yt(){}function bt(e,t,n){t||(t=0),typeof n=="undefined"&&(n=e?e.length:0);var r=-1,i=n-t||0,s=Array(i<0?0:i);while(++r<i)s[r]=e[t+r];return s}function wt(e){return Lt[e]}function Et(e){if(!e)return e;for(var t=1,n=arguments.length;t<n;t++){var r=arguments[t];if(r)for(var i in r)e[i]=r[i]}return e}function Nt(e){var t=!1;if(!e||typeof e!="object"||isArguments(e))return t;var n=e.constructor;return!Rt(n)||n instanceof n?(St(e,function(e,n){t=n}),t===!1||L.call(e,t)):t}function Ct(e){var t=[];return xt(e,function(e,n){t.push(n)}),t}function At(e){return e&&rt[typeof e]?Pt(e)?bt(e):Et({},e):e}function Ot(e){if(!e)return e;for(var t=1,n=arguments.length;t<n;t++){var r=arguments[t];if(r)for(var i in r)e[i]==null&&(e[i]=r[i])}return e}function Mt(e){var t=[];return St(e,function(e,n){Rt(e)&&t.push(n)}),t.sort()}function _t(e,t){return e?L.call(e,t):!1}function Dt(e){var t=-1,n=Tt(e),r=n.length,i={};while(++t<r){var s=n[t];i[e[s]]=s}return i}function Ht(e){return e===!0||e===!1||M.call(e)==U}function Bt(e){return e instanceof Date||M.call(e)==z}function jt(e){return e?e.nodeType===1:!1}function Ft(e){if(!e)return!0;if(Pt(e)||$t(e))return!e.length;for(var t in e)if(L.call(e,t))return!1;return!0}function It(e,t,n,r){if(e===t)return e!==0||1/e==1/t;if(e==null||t==null)return e===t;var i=M.call(e),s=M.call(t);if(i!=s)return!1;switch(i){case U:case z:return+e==+t;case X:return e!=+e?t!=+t:e==0?1/e==1/t:e==+t;case $:case J:return e==t+""}var o=i==R;if(!o){if(e.__wrapped__||t.__wrapped__)return It(e.__wrapped__||e,t.__wrapped__||t);if(i!=V)return!1;var a=e.constructor,f=t.constructor;if(a!=f&&!(Rt(a)&&a instanceof a&&Rt(f)&&f instanceof f))return!1}n||(n=[]),r||(r=[]);var l=n.length;while(l--)if(n[l]==e)return r[l]==t;var c=!0,h=0;n.push(e),r.push(t);if(o){h=e.length,c=h==t.length;if(c)while(h--)if(!(c=It(e[h],t[h],n,r)))break;return c}return St(e,function(e,i,s){if(L.call(s,i))return h++,!(c=L.call(t,i)&&It(e,t[i],n,r))&&u}),c&&St(t,function(e,t,n){if(L.call(n,t))return!(c=--h>-1)&&u}),c}function qt(e){return P(e)&&!H(parseFloat(e))}function Rt(e){return typeof e=="function"}function Ut(e){return e?rt[typeof e]:!1}function zt(e){return Xt(e)&&e!=+e}function Wt(e){return e===null}function Xt(e){return typeof e=="number"||M.call(e)==X}function Vt(e){return e instanceof RegExp||M.call(e)==$}function $t(e){return typeof e=="string"||M.call(e)==J}function Jt(e){return typeof e=="undefined"}function Kt(e){var t=N.apply(i,arguments),n={};return St(e,function(e,r){Nn(t,r,1)<0&&(n[r]=e)}),n}function Qt(e){var t=-1,n=Tt(e),r=n.length,i=Array(r);while(++t<r){var s=n[t];i[t]=[s,e[s]]}return i}function Gt(e){var t=0,n=N.apply(i,arguments),r=n.length,s={};while(++t<r){var o=n[t];o in e&&(s[o]=e[o])}return s}function Yt(e){var t=-1,n=Tt(e),r=n.length,i=Array(r);while(++t<r)i[t]=e[n[t]];return i}function Zt(e,t){var n=e?e.length:0,r=!1;return typeof n=="number"?r=Nn(e,t)>-1:dt(e,function(e){return(r=e===t)&&u}),r}function en(e,t,n){var r={};return t=ht(t,n),sn(e,function(e,n,i){n=t(e,n,i)+"",L.call(r,n)?r[n]++:r[n]=1}),r}function tn(e,t,n){var r=!0;t=ht(t,n);if(Pt(e)){var i=-1,s=e.length;while(++i<s)if(!(r=!!t(e[i],i,e)))break}else dt(e,function(e,n,i){return!(r=!!t(e,n,i))&&u});return r}function nn(e,t,n){var r=[];t=ht(t,n);if(Pt(e)){var i=-1,s=e.length;while(++i<s){var o=e[i];t(o,i,e)&&r.push(o)}}else dt(e,function(e,n,i){t(e,n,i)&&r.push(e)});return r}function rn(e,t,n){var r;return t=ht(t,n),sn(e,function(e,n,i){if(t(e,n,i))return r=e,u}),r}function sn(e,t,n){if(t&&typeof n=="undefined"&&Pt(e)){var r=-1,i=e.length;while(++r<i)if(t(e[r],r,e)===u)break}else dt(e,t,n)}function on(e,t,n){var r={};return t=ht(t,n),sn(e,function(e,n,i){n=t(e,n,i)+"",(L.call(r,n)?r[n]:r[n]=[]).push(e)}),r}function un(e,t){var n=bt(arguments,2),r=-1,i=typeof t=="function",s=e?e.length:0,o=Array(typeof s=="number"?s:0);return sn(e,function(e){o[++r]=(i?t:e[t]).apply(e,n)}),o}function an(e,t,n){var r=-1,i=e?e.length:0,s=Array(typeof i=="number"?i:0);t=ht(t,n);if(Pt(e))while(++r<i)s[r]=t(e[r],r,e);else dt(e,function(e,n,i){s[++r]=t(e,n,i)});return s}function fn(e,t,n){var r=-Infinity,i=r;if(!t&&Pt(e)){var s=-1,o=e.length;while(++s<o){var u=e[s];u>i&&(i=u)}}else t=ht(t,n),dt(e,function(e,n,s){var o=t(e,n,s);o>r&&(r=o,i=e)});return i}function ln(e,t,n){var r=Infinity,i=r;if(!t&&Pt(e)){var s=-1,o=e.length;while(++s<o){var u=e[s];u<i&&(i=u)}}else t=ht(t,n),dt(e,function(e,n,s){var o=t(e,n,s);o<r&&(r=o,i=e)});return i}function cn(e,t){return an(e,t+"")}function hn(e,t,n,r){var i=arguments.length<3;t=ht(t,r,u);if(Pt(e)){var s=-1,o=e.length;i&&(n=e[++s]);while(++s<o)n=t(n,e[s],s,e)}else dt(e,function(e,r,s){n=i?(i=!1,e):t(n,e,r,s)});return n}function pn(e,t,n,r){var i=e,s=e?e.length:0,o=arguments.length<3;if(typeof s!="number"){var a=Tt(e);s=a.length}return t=ht(t,r,u),sn(e,function(e,r,u){r=a?a[--s]:--s,n=o?(o=!1,i[r]):t(n,i[r],r,u)}),n}function dn(e,t,n){return t=ht(t,n),nn(e,function(e,n,r){return!t(e,n,r)})}function vn(e){var t=-1,n=e?e.length:0,r=Array(typeof n=="number"?n:0);return sn(e,function(e){var n=C(I()*(++t+1));r[t]=r[n],r[n]=e}),r}function mn(e){var t=e?e.length:0;return typeof t=="number"?t:Tt(e).length}function gn(e,t,n){var r;t=ht(t,n);if(Pt(e)){var i=-1,s=e.length;while(++i<s)if(r=t(e[i],i,e))break}else dt(e,function(e,n,i){return(r=t(e,n,i))&&u});return!!r}function yn(e,t,n){var r=-1,i=e?e.length:0,s=Array(typeof i=="number"?i:0);t=ht(t,n),sn(e,function(e,n,i){s[++r]={criteria:t(e,n,i),index:r,value:e}}),i=s.length,s.sort(lt);while(i--)s[i]=s[i].value;return s}function bn(e){return e&&typeof e.length=="number"?bt(e):Yt(e)}function wn(e,t){var n=Tt(t);return nn(e,function(e){var r=n.length;while(r--){var i=e[n[r]]===t[n[r]];if(!i)break}return!!i})}function En(e){var t=-1,n=e?e.length:0,r=[];while(++t<n){var i=e[t];i&&r.push(i)}return r}function Sn(e){var t=-1,n=e.length,r=N.apply(i,arguments),s=[];while(++t<n){var o=e[t];Nn(r,o,n)<0&&s.push(o)}return s}function xn(e,t,n){if(e){var r=e.length;return t==null||n?e[0]:bt(e,0,F(j(0,t),r))}}function Tn(e,t){var n=-1,r=e?e.length:0,i=[];while(++n<r){var s=e[n];Pt(s)?A.apply(i,t?s:Tn(s)):i.push(s)}return i}function Nn(e,t,n){var r=-1,i=e?e.length:0;if(typeof n=="number")r=(n<0?j(0,i+n):n||0)-1;else if(n)return r=Dn(e,t),e[r]===t?r:-1;while(++r<i)if(e[r]===t)return r;return-1}function Cn(e,t,n){if(!e)return[];var r=e.length;return t=t==null||n?1:t||0,bt(e,0,F(j(0,r-t),r))}function kn(e){var t=arguments,n=t.length,r=-1,i=e?e.length:0,s=[];e:while(++r<i){var o=e[r];if(Nn(s,o)<0){var u=n;while(--u)if(Nn(t[u],o)<0)continue e;s.push(o)}}return s}function Ln(e,t,n){if(e){var r=e.length;return t==null||n?e[r-1]:bt(e,j(0,r-t))}}function An(e,t,n){var r=e?e.length:0;typeof n=="number"&&(r=(n<0?j(0,r+n):F(n,r-1))+1);while(r--)if(e[r]===t)return r;return-1}function On(e,t){var n=-1,r=e?e.length:0,i={};while(++n<r){var s=e[n];t?i[s]=t[n]:i[s[0]]=s[1]}return i}function Mn(e,t,n){e=+e||0,n=+n||1,t==null&&(t=e,e=0);var r=-1,i=j(0,T((t-e)/n)),s=Array(i);while(++r<i)s[r]=e,e+=n;return s}function _n(e,t,n){return bt(e,t==null||n?1:j(0,t))}function Dn(e,t,n,r){var i=0,s=e?e.length:i;n=n?ht(n,r):Qn,t=n(t);while(i<s){var o=i+s>>>1;n(e[o])<t?i=o+1:s=o}return i}function Pn(){return Hn(N.apply(i,arguments))}function Hn(e,t,n,r){var i=-1,s=e?e.length:0,o=[],u=o;typeof t=="function"&&(r=n,n=t,t=!1),n&&(u=[],n=ht(n,r));while(++i<s){var a=e[i],f=n?n(a,i,e):a;if(t?!i||u[u.length-1]!==f:Nn(u,f)<0)n&&u.push(f),o.push(a)}return o}function Bn(e){var t=-1,n=e.length,r=[];while(++t<n){var i=e[t];Nn(arguments,i,1)<0&&r.push(i)}return r}function jn(e){var t=-1,n=e?fn(cn(arguments,"length")):0,r=Array(n);while(++t<n)r[t]=cn(arguments,t);return r}function Fn(e,t){return e<1?t():function(){if(--e<1)return t.apply(this,arguments)}}function In(e,t){return G||_&&arguments.length>2?_.call.apply(_,arguments):ct(e,t,bt(arguments,2))}function qn(e){var t=arguments,n=t.length>1?0:(t=Mt(e),-1),r=t.length;while(++n<r){var i=t[n];e[i]=In(e[i],e)}return e}function Rn(){var e=arguments;return function(){var t=arguments,n=e.length;while(n--)t=[e[n].apply(this,t)];return t[0]}}function Un(e,t,n){function u(){o=null,n||(i=e.apply(s,r))}var r,i,s,o;return function(){var a=n&&!o;return r=arguments,s=this,clearTimeout(o),o=setTimeout(u,t),a&&(i=e.apply(s,r)),i}}function zn(e,n){var r=bt(arguments,2);return setTimeout(function(){e.apply(t,r)},n)}function Wn(e){var n=bt(arguments,1);return setTimeout(function(){e.apply(t,n)},1)}function Xn(e,t){var n={};return function(){var r=(t?t.apply(this,arguments):arguments[0])+"";return L.call(n,r)?n[r]:n[r]=e.apply(this,arguments)}}function Vn(e){var t,n;return function(){return t?n:(t=!0,n=e.apply(this,arguments),e=null,n)}}function $n(e,t){function u(){o=new Date,s=null,r=e.apply(i,n)}var n,r,i,s,o=0;return function(){var a=new Date,f=t-(a-o);return n=arguments,i=this,f<=0?(clearTimeout(s),s=null,o=a,r=e.apply(i,n)):s||(s=setTimeout(u,f)),r}}function Jn(e,t){return function(){var n=[e];return A.apply(n,arguments),t.apply(this,n)}}function Kn(e){return e==null?"":(e+"").replace(w,mt)}function Qn(e){return e}function Gn(e){sn(Mt(e),function(t){var n=st[t]=e[t];st.prototype[t]=function(){var e=[this.__wrapped__];A.apply(e,arguments);var t=n.apply(st,e);return this.__chain__&&(t=new st(t),t.__chain__=!0),t}})}function Yn(){return e._=a,this}function Zn(e,t){return e==null&&t==null&&(t=1),e=+e||0,t==null&&(t=e,e=0),e+C(I()*((+t||0)-e+1))}function er(e,t){var n=e?e[t]:null;return Rt(n)?e[t]():n}function tr(e,t,n){e||(e=""),n=Ot({},n,st.templateSettings);var r=0,i="__p += '",s=n.variable,o=RegExp((n.escape||b).source+"|"+(n.interpolate||b).source+"|"+(n.evaluate||b).source+"|$","g");e.replace(o,function(t,n,s,o,u){i+=e.slice(r,u).replace(E,vt),i+=n?"' +\n_.escape("+n+") +\n'":o?"';\n"+o+";\n__p += '":s?"' +\n((__t = ("+s+")) == null ? '' : __t) +\n'":"",r=u+t.length}),i+="';\n",s||(s="obj",i="with ("+s+" || {}) {\n"+i+"\n}\n"),i="function("+s+") {\n"+"var __t, __p = '', __j = Array.prototype.join;\n"+"function print() { __p += __j.call(arguments, '') }\n"+i+"return __p\n}";try{var u=Function("_","return "+i)(st)}catch(a){throw a.source=i,a}return t?u(t):(u.source=i,u)}function nr(e,t,n){e=+e||0;var r=-1,i=Array(e);while(++r<e)i[r]=t.call(n,r);return i}function rr(e){return e==null?"":(e+"").replace(l,wt)}function ir(e){var t=++o+"";return e?e+t:t}function sr(e){return e=new st(e),e.__chain__=!0,e}function or(e,t){return t(e),e}function ur(){return this.__chain__=!0,this}function ar(){return this.__wrapped__+""}function fr(){return this.__wrapped__}var n=typeof exports=="object"&&exports,r=typeof global=="object"&&global;r.global===r&&(e=r);var i=[],s=new function(){},o=0,u=s,a=e._,f=/[-?+=!~*%&^<>|{(\/]|\[\D|\b(?:delete|in|instanceof|new|typeof|void)\b/,l=/&(?:amp|lt|gt|quot|#x27);/g,c=/\b__p \+= '';/g,h=/\b(__p \+=) '' \+/g,p=/(__e\(.*?\)|\b__t\)) \+\n'';/g,d=/\w*$/,v=/(?:__e|__t = )\(\s*(?![\d\s"']|this\.)/g,m=RegExp("^"+(s.valueOf+"").replace(/[.*+?^=!:${}()|[\]\/\\]/g,"\\$&").replace(/valueOf|for [^\]]+/g,".+?")+"$"),g=/\$\{((?:(?=\\?)\\?[\s\S])*?)}/g,y=/<%=([\s\S]+?)%>/g,b=/($^)/,w=/[&<>"']/g,E=/['\n\r\t\u2028\u2029\\]/g,S=["constructor","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","toLocaleString","toString","valueOf"],x=0,T=Math.ceil,N=i.concat,C=Math.floor,k=m.test(k=Object.getPrototypeOf)&&k,L=s.hasOwnProperty,A=i.push,O=s.propertyIsEnumerable,M=s.toString,_=m.test(_=bt.bind)&&_,D=m.test(D=Array.isArray)&&D,P=e.isFinite,H=e.isNaN,B=m.test(B=Object.keys)&&B,j=Math.max,F=Math.min,I=Math.random,q="[object Arguments]",R="[object Array]",U="[object Boolean]",z="[object Date]",W="[object Function]",X="[object Number]",V="[object Object]",$="[object RegExp]",J="[object String]",K=!!e.attachEvent,Q=_&&!/\n|true/.test(_+K),G=_&&!Q,Y=(Y={0:1,length:1},i.splice.call(Y,0,1),Y[0]),Z=arguments.constructor==Object,et="x"[0]+Object("x")[0]!="xx";try{var tt=(Function("//@")(),!K)}catch(nt){}var rt={"boolean":!1,"function":!0,object:!0,number:!1,string:!1,"undefined":!1},it={"\\":"\\","'":"'","\n":"n","\r":"r","	":"t","\u2028":"u2028","\u2029":"u2029"};st.templateSettings={escape:/<%-([\s\S]+?)%>/g,evaluate:/<%([\s\S]+?)%>/g,interpolate:y,variable:""};var ot={args:"object, source, guard",top:"for (var argsIndex = 1, argsLength = typeof guard == 'number' ? 2 : arguments.length; argsIndex < argsLength; argsIndex++) {\n  if ((iteratee = arguments[argsIndex])) {",objectLoop:"result[index] = iteratee[index]",bottom:"  }\n}"},ut={args:"collection, callback, thisArg",top:"callback = callback && typeof thisArg == 'undefined' ? callback : createCallback(callback, thisArg)",arrayLoop:"if (callback(iteratee[index], index, collection) === false) return result",objectLoop:"if (callback(iteratee[index], index, collection) === false) return result"},at={arrayLoop:null},dt=function(e,t,n){var r,i=e,s=e;if(!e)return s;t=t&&typeof n=="undefined"?t:ht(t,n);var o=i.length;r=-1;if(typeof o=="number"){while(++r<o)if(t(i[r],r,e)===u)return s}else for(r in i)if(L.call(i,r)&&t(i[r],r,e)===u)return s};st.isArguments=function(e){return M.call(e)==q},st.isArguments(arguments)||(st.isArguments=function(e){return e?L.call(e,"callee"):!1});var St=function(e,t){var n,r=e,i=e;if(!e)return i;t||(t=Qn);for(n in r)if(t(r[n],n,e)===u)return i;return i},xt=function(e,t){var n,r=e,i=e;if(!e)return i;t||(t=Qn);for(n in r)if(L.call(r,n)&&t(r[n],n,e)===u)return i;return i},Tt=B?function(e){return Ut(e)?B(e):[]}:Ct,kt={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;"},Lt=Dt(kt),Pt=D||function(e){return Z&&e instanceof Array||M.call(e)==R};Rt(/x/)&&(Rt=function(e){return e instanceof Function||M.call(e)==W}),st.after=Fn,st.bind=In,st.bindAll=qn,st.compact=En,st.compose=Rn,st.countBy=en,st.debounce=Un,st.defaults=Ot,st.defer=Wn,st.delay=zn,st.difference=Sn,st.filter=nn,st.flatten=Tn,st.forEach=sn,st.functions=Mt,st.groupBy=on,st.initial=Cn,st.intersection=kn,st.invert=Dt,st.invoke=un,st.keys=Tt,st.map=an,st.max=fn,st.memoize=Xn,st.min=ln,st.object=On,st.omit=Kt,st.once=Vn,st.pairs=Qt,st.pick=Gt,st.pluck=cn,st.range=Mn,st.reject=dn,st.rest=_n,st.shuffle=vn,st.sortBy=yn,st.tap=or,st.throttle=$n,st.times=nr,st.toArray=bn,st.union=Pn,st.uniq=Hn,st.values=Yt,st.where=wn,st.without=Bn,st.wrap=Jn,st.zip=jn,st.collect=an,st.drop=_n,st.each=sn,st.extend=Et,st.methods=Mt,st.select=nn,st.tail=_n,st.unique=Hn,st.clone=At,st.contains=Zt,st.escape=Kn,st.every=tn,st.find=rn,st.has=_t,st.identity=Qn,st.indexOf=Nn,st.isArray=Pt,st.isBoolean=Ht,st.isDate=Bt,st.isElement=jt,st.isEmpty=Ft,st.isEqual=It,st.isFinite=qt,st.isFunction=Rt,st.isNaN=zt,st.isNull=Wt,st.isNumber=Xt,st.isObject=Ut,st.isRegExp=Vt,st.isString=$t,st.isUndefined=Jt,st.lastIndexOf=An,st.mixin=Gn,st.noConflict=Yn,st.random=Zn,st.reduce=hn,st.reduceRight=pn,st.result=er,st.size=mn,st.some=gn,st.sortedIndex=Dn,st.template=tr,st.unescape=rr,st.uniqueId=ir,st.all=tn,st.any=gn,st.detect=rn,st.foldl=hn,st.foldr=pn,st.include=Zt,st.inject=hn,st.first=xn,st.last=Ln,st.take=xn,st.head=xn,st.chain=sr,st.VERSION="1.0.0-rc.3",Gn(st),st.prototype.chain=ur,st.prototype.value=fr,dt(["pop","push","reverse","shift","sort","splice","unshift"],function(e){var t=i[e];st.prototype[e]=function(){var e=this.__wrapped__;return t.apply(e,arguments),Y&&e.length===0&&delete e[0],this}}),dt(["concat","join","slice"],function(e){var t=i[e];st.prototype[e]=function(){var e=this.__wrapped__,n=t.apply(e,arguments);return this.__chain__&&(n=new st(n),n.__chain__=!0),n}}),n?typeof module=="object"&&module&&module.exports==n?(module.exports=st)._=st:n._=st:e._=st}(this),define("lodash",function(e){return function(){var t,n;return t||e._}}(this)),function(){var e=this,t=e.Backbone,n=[],r=n.push,i=n.slice,s=n.splice,o;typeof exports!="undefined"?o=exports:o=e.Backbone={},o.VERSION="0.9.9";var u=e._;!u&&typeof require!="undefined"&&(u=require("underscore")),o.$=e.jQuery||e.Zepto||e.ender,o.noConflict=function(){return e.Backbone=t,this},o.emulateHTTP=!1,o.emulateJSON=!1;var a=/\s+/,f=function(e,t,n,r){if(!n)return!0;if(typeof n=="object")for(var i in n)e[t].apply(e,[i,n[i]].concat(r));else{if(!a.test(n))return!0;var s=n.split(a);for(var o=0,u=s.length;o<u;o++)e[t].apply(e,[s[o]].concat(r))}},l=function(e,t,n){var r,i=-1,s=t.length;switch(n.length){case 0:while(++i<s)(r=t[i]).callback.call(r.ctx);return;case 1:while(++i<s)(r=t[i]).callback.call(r.ctx,n[0]);return;case 2:while(++i<s)(r=t[i]).callback.call(r.ctx,n[0],n[1]);return;case 3:while(++i<s)(r=t[i]).callback.call(r.ctx,n[0],n[1],n[2]);return;default:while(++i<s)(r=t[i]).callback.apply(r.ctx,n)}},c=o.Events={on:function(e,t,n){if(!f(this,"on",e,[t,n])||!t)return this;this._events||(this._events={});var r=this._events[e]||(this._events[e]=[]);return r.push({callback:t,context:n,ctx:n||this}),this},once:function(e,t,n){if(!f(this,"once",e,[t,n])||!t)return this;var r=this,i=u.once(function(){r.off(e,i),t.apply(this,arguments)});return i._callback=t,this.on(e,i,n),this},off:function(e,t,n){var r,i,s,o,a,l,c,h;if(!this._events||!f(this,"off",e,[t,n]))return this;if(!e&&!t&&!n)return this._events={},this;o=e?[e]:u.keys(this._events);for(a=0,l=o.length;a<l;a++){e=o[a];if(r=this._events[e]){s=[];if(t||n)for(c=0,h=r.length;c<h;c++)i=r[c],(t&&t!==(i.callback._callback||i.callback)||n&&n!==i.context)&&s.push(i);this._events[e]=s}}return this},trigger:function(e){if(!this._events)return this;var t=i.call(arguments,1);if(!f(this,"trigger",e,t))return this;var n=this._events[e],r=this._events.all;return n&&l(this,n,t),r&&l(this,r,arguments),this},listenTo:function(e,t,n){var r=this._listeners||(this._listeners={}),i=e._listenerId||(e._listenerId=u.uniqueId("l"));return r[i]=e,e.on(t,n||this,this),this},stopListening:function(e,t,n){var r=this._listeners;if(!r)return;if(e)e.off(t,n,this),!t&&!n&&delete r[e._listenerId];else{for(var i in r)r[i].off(null,null,this);this._listeners={}}return this}};c.bind=c.on,c.unbind=c.off,u.extend(o,c);var h=o.Model=function(e,t){var n,r=e||{};this.cid=u.uniqueId("c"),this.changed={},this.attributes={},this._changes=[],t&&t.collection&&(this.collection=t.collection),t&&t.parse&&(r=this.parse(r)),(n=u.result(this,"defaults"))&&u.defaults(r,n),this.set(r,{silent:!0}),this._currentAttributes=u.clone(this.attributes),this._previousAttributes=u.clone(this.attributes),this.initialize.apply(this,arguments)};u.extend(h.prototype,c,{changed:null,idAttribute:"id",initialize:function(){},toJSON:function(e){return u.clone(this.attributes)},sync:function(){return o.sync.apply(this,arguments)},get:function(e){return this.attributes[e]},escape:function(e){return u.escape(this.get(e))},has:function(e){return this.get(e)!=null},set:function(e,t,n){var r,i;if(e==null)return this;u.isObject(e)?(i=e,n=t):(i={})[e]=t;var s=n&&n.silent,o=n&&n.unset;if(!this._validate(i,n))return!1;this.idAttribute in i&&(this.id=i[this.idAttribute]);var a=this.attributes;for(r in i)t=i[r],o?delete a[r]:a[r]=t,this._changes.push(r,t);return this._hasComputed=!1,s||this.change(n),this},unset:function(e,t){return this.set(e,void 0,u.extend({},t,{unset:!0}))},clear:function(e){var t={};for(var n in this.attributes)t[n]=void 0;return this.set(t,u.extend({},e,{unset:!0}))},fetch:function(e){e=e?u.clone(e):{},e.parse===void 0&&(e.parse=!0);var t=this,n=e.success;return e.success=function(r,i,s){if(!t.set(t.parse(r),e))return!1;n&&n(t,r,e)},this.sync("read",this,e)},save:function(e,t,n){var r,i,s;e==null||u.isObject(e)?(r=e,n=t):e!=null&&((r={})[e]=t),n=n?u.clone(n):{};if(n.wait){if(r&&!this._validate(r,n))return!1;i=u.clone(this.attributes)}var o=u.extend({},n,{silent:!0});if(r&&!this.set(r,n.wait?o:n))return!1;if(!r&&!this._validate(null,n))return!1;var a=this,f=n.success;n.success=function(e,t,i){s=!0;var o=a.parse(e);n.wait&&(o=u.extend(r||{},o));if(!a.set(o,n))return!1;f&&f(a,e,n)};var l=this.isNew()?"create":n.patch?"patch":"update";l=="patch"&&(n.attrs=r);var c=this.sync(l,this,n);return!s&&n.wait&&(this.clear(o),this.set(i,o)),c},destroy:function(e){e=e?u.clone(e):{};var t=this,n=e.success,r=function(){t.trigger("destroy",t,t.collection,e)};e.success=function(i){(e.wait||t.isNew())&&r(),n&&n(t,i,e)};if(this.isNew())return e.success(),!1;var i=this.sync("delete",this,e);return e.wait||r(),i},url:function(){var e=u.result(this,"urlRoot")||u.result(this.collection,"url")||M();return this.isNew()?e:e+(e.charAt(e.length-1)==="/"?"":"/")+encodeURIComponent(this.id)},parse:function(e){return e},clone:function(){return new this.constructor(this.attributes)},isNew:function(){return this.id==null},change:function(e){var t=this._changing;this._changing=!0;var n=this._computeChanges(!0);this._pending=!!n.length;for(var r=n.length-2;r>=0;r-=2)this.trigger("change:"+n[r],this,n[r+1],e);if(t)return this;while(this._pending)this._pending=!1,this.trigger("change",this,e),this._previousAttributes=u.clone(this.attributes);return this._changing=!1,this},hasChanged:function(e){return this._hasComputed||this._computeChanges(),e==null?!u.isEmpty(this.changed):u.has(this.changed,e)},changedAttributes:function(e){if(!e)return this.hasChanged()?u.clone(this.changed):!1;var t,n=!1,r=this._previousAttributes;for(var i in e){if(u.isEqual(r[i],t=e[i]))continue;(n||(n={}))[i]=t}return n},_computeChanges:function(e){this.changed={};var t={},n=[],r=this._currentAttributes,i=this._changes;for(var s=i.length-2;s>=0;s-=2){var o=i[s],u=i[s+1];if(t[o])continue;t[o]=!0;if(r[o]!==u){this.changed[o]=u;if(!e)continue;n.push(o,u),r[o]=u}}return e&&(this._changes=[]),this._hasComputed=!0,n},previous:function(e){return e==null||!this._previousAttributes?null:this._previousAttributes[e]},previousAttributes:function(){return u.clone(this._previousAttributes)},_validate:function(e,t){if(!this.validate)return!0;e=u.extend({},this.attributes,e);var n=this.validate(e,t);return n?(t&&t.error&&t.error(this,n,t),this.trigger("error",this,n,t),!1):!0}});var p=o.Collection=function(e,t){t||(t={}),t.model&&(this.model=t.model),t.comparator!==void 0&&(this.comparator=t.comparator),this._reset(),this.initialize.apply(this,arguments),e&&this.reset(e,u.extend({silent:!0},t))};u.extend(p.prototype,c,{model:h,initialize:function(){},toJSON:function(e){return this.map(function(t){return t.toJSON(e)})},sync:function(){return o.sync.apply(this,arguments)},add:function(e,t){var n,i,o,a,f,l,c=t&&t.at,h=(t&&t.sort)==null?!0:t.sort;e=u.isArray(e)?e.slice():[e];for(n=e.length-1;n>=0;n--){if(!(a=this._prepareModel(e[n],t))){this.trigger("error",this,e[n],t),e.splice(n,1);continue}e[n]=a,f=a.id!=null&&this._byId[a.id];if(f||this._byCid[a.cid]){t&&t.merge&&f&&(f.set(a.attributes,t),l=h),e.splice(n,1);continue}a.on("all",this._onModelEvent,this),this._byCid[a.cid]=a,a.id!=null&&(this._byId[a.id]=a)}e.length&&(l=h),this.length+=e.length,i=[c!=null?c:this.models.length,0],r.apply(i,e),s.apply(this.models,i),l&&this.comparator&&c==null&&this.sort({silent:!0});if(t&&t.silent)return this;while(a=e.shift())a.trigger("add",a,this,t);return this},remove:function(e,t){var n,r,i,s;t||(t={}),e=u.isArray(e)?e.slice():[e];for(n=0,r=e.length;n<r;n++){s=this.get(e[n]);if(!s)continue;delete this._byId[s.id],delete this._byCid[s.cid],i=this.indexOf(s),this.models.splice(i,1),this.length--,t.silent||(t.index=i,s.trigger("remove",s,this,t)),this._removeReference(s)}return this},push:function(e,t){return e=this._prepareModel(e,t),this.add(e,u.extend({at:this.length},t)),e},pop:function(e){var t=this.at(this.length-1);return this.remove(t,e),t},unshift:function(e,t){return e=this._prepareModel(e,t),this.add(e,u.extend({at:0},t)),e},shift:function(e){var t=this.at(0);return this.remove(t,e),t},slice:function(e,t){return this.models.slice(e,t)},get:function(e){return e==null?void 0:this._byId[e.id!=null?e.id:e]||this._byCid[e.cid||e]},at:function(e){return this.models[e]},where:function(e){return u.isEmpty(e)?[]:this.filter(function(t){for(var n in e)if(e[n]!==t.get(n))return!1;return!0})},sort:function(e){if(!this.comparator)throw new Error("Cannot sort a set without a comparator");return u.isString(this.comparator)||this.comparator.length===1?this.models=this.sortBy(this.comparator,this):this.models.sort(u.bind(this.comparator,this)),(!e||!e.silent)&&this.trigger("sort",this,e),this},pluck:function(e){return u.invoke(this.models,"get",e)},update:function(e,t){var n,r,i,s,o=[],a=[],f={},l=this.model.prototype.idAttribute;t=u.extend({add:!0,merge:!0,remove:!0},t),t.parse&&(e=this.parse(e)),u.isArray(e)||(e=e?[e]:[]);if(t.add&&!t.remove)return this.add(e,t);for(r=0,i=e.length;r<i;r++)n=e[r],s=this.get(n.id||n.cid||n[l]),t.remove&&s&&(f[s.cid]=!0),(t.add&&!s||t.merge&&s)&&o.push(n);if(t.remove)for(r=0,i=this.models.length;r<i;r++)n=this.models[r],f[n.cid]||a.push(n);return a.length&&this.remove(a,t),o.length&&this.add(o,t),this},reset:function(e,t){t||(t={}),t.parse&&(e=this.parse(e));for(var n=0,r=this.models.length;n<r;n++)this._removeReference(this.models[n]);return t.previousModels=this.models,this._reset(),e&&this.add(e,u.extend({silent:!0},t)),t.silent||this.trigger("reset",this,t),this},fetch:function(e){e=e?u.clone(e):{},e.parse===void 0&&(e.parse=!0);var t=this,n=e.success;return e.success=function(r,i,s){var o=e.update?"update":"reset";t[o](r,e),n&&n(t,r,e)},this.sync("read",this,e)},create:function(e,t){var n=this;t=t?u.clone(t):{},e=this._prepareModel(e,t);if(!e)return!1;t.wait||n.add(e,t);var r=t.success;return t.success=function(e,t,i){i.wait&&n.add(e,i),r&&r(e,t,i)},e.save(null,t),e},parse:function(e){return e},clone:function(){return new this.constructor(this.models)},chain:function(){return u(this.models).chain()},_reset:function(){this.length=0,this.models=[],this._byId={},this._byCid={}},_prepareModel:function(e,t){if(e instanceof h)return e.collection||(e.collection=this),e;t||(t={}),t.collection=this;var n=new this.model(e,t);return n._validate(e,t)?n:!1},_removeReference:function(e){this===e.collection&&delete e.collection,e.off("all",this._onModelEvent,this)},_onModelEvent:function(e,t,n,r){if((e==="add"||e==="remove")&&n!==this)return;e==="destroy"&&this.remove(t,r),t&&e==="change:"+t.idAttribute&&(delete this._byId[t.previous(t.idAttribute)],t.id!=null&&(this._byId[t.id]=t)),this.trigger.apply(this,arguments)}});var d=["forEach","each","map","collect","reduce","foldl","inject","reduceRight","foldr","find","detect","filter","select","reject","every","all","some","any","include","contains","invoke","max","min","sortedIndex","toArray","size","first","head","take","initial","rest","tail","last","without","indexOf","shuffle","lastIndexOf","isEmpty"];u.each(d,function(e){p.prototype[e]=function(){var t=i.call(arguments);return t.unshift(this.models),u[e].apply(u,t)}});var v=["groupBy","countBy","sortBy"];u.each(v,function(e){p.prototype[e]=function(t,n){var r=u.isFunction(t)?t:function(e){return e.get(t)};return u[e](this.models,r,n)}});var m=o.Router=function(e){e||(e={}),e.routes&&(this.routes=e.routes),this._bindRoutes(),this.initialize.apply(this,arguments)},g=/\((.*?)\)/g,y=/:\w+/g,b=/\*\w+/g,w=/[\-{}\[\]+?.,\\\^$|#\s]/g;u.extend(m.prototype,c,{initialize:function(){},route:function(e,t,n){return u.isRegExp(e)||(e=this._routeToRegExp(e)),n||(n=this[t]),o.history.route(e,u.bind(function(r){var i=this._extractParameters(e,r);n&&n.apply(this,i),this.trigger.apply(this,["route:"+t].concat(i)),o.history.trigger("route",this,t,i)},this)),this},navigate:function(e,t){return o.history.navigate(e,t),this},_bindRoutes:function(){if(!this.routes)return;var e,t=u.keys(this.routes);while((e=t.pop())!=null)this.route(e,this.routes[e])},_routeToRegExp:function(e){return e=e.replace(w,"\\$&").replace(g,"(?:$1)?").replace(y,"([^/]+)").replace(b,"(.*?)"),new RegExp("^"+e+"$")},_extractParameters:function(e,t){return e.exec(t).slice(1)}});var E=o.History=function(){this.handlers=[],u.bindAll(this,"checkUrl"),typeof window!="undefined"&&(this.location=window.location,this.history=window.history)},S=/^[#\/]|\s+$/g,x=/^\/+|\/+$/g,T=/msie [\w.]+/,N=/\/$/;E.started=!1,u.extend(E.prototype,c,{interval:50,getHash:function(e){var t=(e||this).location.href.match(/#(.*)$/);return t?t[1]:""},getFragment:function(e,t){if(e==null)if(this._hasPushState||!this._wantsHashChange||t){e=this.location.pathname;var n=this.root.replace(N,"");e.indexOf(n)||(e=e.substr(n.length))}else e=this.getHash();return e.replace(S,"")},start:function(e){if(E.started)throw new Error("Backbone.history has already been started");E.started=!0,this.options=u.extend({},{root:"/"},this.options,e),this.root=this.options.root,this._wantsHashChange=this.options.hashChange!==!1,this._wantsPushState=!!this.options.pushState,this._hasPushState=!!(this.options.pushState&&this.history&&this.history.pushState);var t=this.getFragment(),n=document.documentMode,r=T.exec(navigator.userAgent.toLowerCase())&&(!n||n<=7);this.root=("/"+this.root+"/").replace(x,"/"),r&&this._wantsHashChange&&(this.iframe=o.$('<iframe src="javascript:0" tabindex="-1" />').hide().appendTo("body")[0].contentWindow,this.navigate(t)),this._hasPushState?o.$(window).bind("popstate",this.checkUrl):this._wantsHashChange&&"onhashchange"in window&&!r?o.$(window).bind("hashchange",this.checkUrl):this._wantsHashChange&&(this._checkUrlInterval=setInterval(this.checkUrl,this.interval)),this.fragment=t;var i=this.location,s=i.pathname.replace(/[^\/]$/,"$&/")===this.root;if(this._wantsHashChange&&this._wantsPushState&&!this._hasPushState&&!s)return this.fragment=this.getFragment(null,!0),this.location.replace(this.root+this.location.search+"#"+this.fragment),!0;this._wantsPushState&&this._hasPushState&&s&&i.hash&&(this.fragment=this.getHash().replace(S,""),this.history.replaceState({},document.title,this.root+this.fragment+i.search));if(!this.options.silent)return this.loadUrl()},stop:function(){o.$(window).unbind("popstate",this.checkUrl).unbind("hashchange",this.checkUrl),clearInterval(this._checkUrlInterval),E.started=!1},route:function(e,t){this.handlers.unshift({route:e,callback:t})},checkUrl:function(e){var t=this.getFragment();t===this.fragment&&this.iframe&&(t=this.getFragment(this.getHash(this.iframe)));if(t===this.fragment)return!1;this.iframe&&this.navigate(t),this.loadUrl()||this.loadUrl(this.getHash())},loadUrl:function(e){var t=this.fragment=this.getFragment(e),n=u.any(this.handlers,function(e){if(e.route.test(t))return e.callback(t),!0});return n},navigate:function(e,t){if(!E.started)return!1;if(!t||t===!0)t={trigger:t};e=this.getFragment(e||"");if(this.fragment===e)return;this.fragment=e;var n=this.root+e;if(this._hasPushState)this.history[t.replace?"replaceState":"pushState"]({},document.title,n);else{if(!this._wantsHashChange)return this.location.assign(n);this._updateHash(this.location,e,t.replace),this.iframe&&e!==this.getFragment(this.getHash(this.iframe))&&(t.replace||this.iframe.document.open().close(),this._updateHash(this.iframe.location,e,t.replace))}t.trigger&&this.loadUrl(e)},_updateHash:function(e,t,n){if(n){var r=e.href.replace(/(javascript:|#).*$/,"");e.replace(r+"#"+t)}else e.hash="#"+t}}),o.history=new E;var C=o.View=function(e){this.cid=u.uniqueId("view"),this._configure(e||{}),this._ensureElement(),this.initialize.apply(this,arguments),this.delegateEvents()},k=/^(\S+)\s*(.*)$/,L=["model","collection","el","id","attributes","className","tagName","events"];u.extend(C.prototype,c,{tagName:"div",$:function(e){return this.$el.find(e)},initialize:function(){},render:function(){return this},remove:function(){return this.$el.remove(),this.stopListening(),this},make:function(e,t,n){var r=document.createElement(e);return t&&o.$(r).attr(t),n!=null&&o.$(r).html(n),r},setElement:function(e,t){return this.$el&&this.undelegateEvents(),this.$el=e instanceof o.$?e:o.$(e),this.el=this.$el[0],t!==!1&&this.delegateEvents(),this},delegateEvents:function(e){if(!e&&!(e=u.result(this,"events")))return;this.undelegateEvents();for(var t in e){var n=e[t];u.isFunction(n)||(n=this[e[t]]);if(!n)throw new Error('Method "'+e[t]+'" does not exist');var r=t.match(k),i=r[1],s=r[2];n=u.bind(n,this),i+=".delegateEvents"+this.cid,s===""?this.$el.bind(i,n):this.$el.delegate(s,i,n)}},undelegateEvents:function(){this.$el.unbind(".delegateEvents"+this.cid)},_configure:function(e){this.options&&(e=u.extend({},u.result(this,"options"),e)),u.extend(this,u.pick(e,L)),this.options=e},_ensureElement:function(){if(!this.el){var e=u.extend({},u.result(this,"attributes"));this.id&&(e.id=u.result(this,"id")),this.className&&(e["class"]=u.result(this,"className")),this.setElement(this.make(u.result(this,"tagName"),e),!1)}else this.setElement(u.result(this,"el"),!1)}});var A={create:"POST",update:"PUT",patch:"PATCH","delete":"DELETE",read:"GET"};o.sync=function(e,t,n){var r=A[e];u.defaults(n||(n={}),{emulateHTTP:o.emulateHTTP,emulateJSON:o.emulateJSON});var i={type:r,dataType:"json"};n.url||(i.url=u.result(t,"url")||M()),n.data==null&&t&&(e==="create"||e==="update"||e==="patch")&&(i.contentType="application/json",i.data=JSON.stringify(n.attrs||t.toJSON(n))),n.emulateJSON&&(i.contentType="application/x-www-form-urlencoded",i.data=i.data?{model:i.data}:{});if(n.emulateHTTP&&(r==="PUT"||r==="DELETE"||r==="PATCH")){i.type="POST",n.emulateJSON&&(i.data._method=r);var s=n.beforeSend;n.beforeSend=function(e){e.setRequestHeader("X-HTTP-Method-Override",r);if(s)return s.apply(this,arguments)}}i.type!=="GET"&&!n.emulateJSON&&(i.processData=!1);var a=n.success;n.success=function(e,r,i){a&&a(e,r,i),t.trigger("sync",t,e,n)};var f=n.error;n.error=function(e,r,i){f&&f(t,e,n),t.trigger("error",t,e,n)};var l=o.ajax(u.extend(i,n));return t.trigger("request",t,l,n),l},o.ajax=function(){return o.$.ajax.apply(o.$,arguments)};var O=function(e,t){var n=this,r;e&&u.has(e,"constructor")?r=e.constructor:r=function(){n.apply(this,arguments)},u.extend(r,n,t);var i=function(){this.constructor=r};return i.prototype=n.prototype,r.prototype=new i,e&&u.extend(r.prototype,e),r.__super__=n.prototype,r};h.extend=p.extend=m.extend=C.extend=E.extend=O;var M=function(){throw new Error('A "url" property or function must be specified')}}.call(this),define("backbone",["underscore","jquery"],function(e){return function(){var t,n;return t||e.Backbone}}(this)),this.Handlebars={},function(e){e.VERSION="1.0.rc.1",e.helpers={},e.partials={},e.registerHelper=function(e,t,n){n&&(t.not=n),this.helpers[e]=t},e.registerPartial=function(e,t){this.partials[e]=t},e.registerHelper("helperMissing",function(e){if(arguments.length===2)return undefined;throw new Error("Could not find property '"+e+"'")});var t=Object.prototype.toString,n="[object Function]";e.registerHelper("blockHelperMissing",function(r,i){var s=i.inverse||function(){},o=i.fn,u="",a=t.call(r);return a===n&&(r=r.call(this)),r===!0?o(this):r===!1||r==null?s(this):a==="[object Array]"?r.length>0?e.helpers.each(r,i):s(this):o(r)}),e.K=function(){},e.createFrame=Object.create||function(t){e.K.prototype=t;var n=new e.K;return e.K.prototype=null,n},e.registerHelper("each",function(t,n){var r=n.fn,i=n.inverse,s="",o;n.data&&(o=e.createFrame(n.data));if(t&&t.length>0)for(var u=0,a=t.length;u<a;u++)o&&(o.index=u),s+=r(t[u],{data:o});else s=i(this);return s}),e.registerHelper("if",function(r,i){var s=t.call(r);return s===n&&(r=r.call(this)),!r||e.Utils.isEmpty(r)?i.inverse(this):i.fn(this)}),e.registerHelper("unless",function(t,n){var r=n.fn,i=n.inverse;return n.fn=i,n.inverse=r,e.helpers["if"].call(this,t,n)}),e.registerHelper("with",function(e,t){return t.fn(e)}),e.registerHelper("log",function(t){e.log(t)})}(this.Handlebars),Handlebars.Exception=function(e){var t=Error.prototype.constructor.apply(this,arguments);for(var n in t)t.hasOwnProperty(n)&&(this[n]=t[n]);this.message=t.message},Handlebars.Exception.prototype=new Error,Handlebars.SafeString=function(e){this.string=e},Handlebars.SafeString.prototype.toString=function(){return this.string.toString()},function(){var e={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;","`":"&#x60;"},t=/[&<>"'`]/g,n=/[&<>"'`]/,r=function(t){return e[t]||"&amp;"};Handlebars.Utils={escapeExpression:function(e){return e instanceof Handlebars.SafeString?e.toString():e==null||e===!1?"":n.test(e)?e.replace(t,r):e},isEmpty:function(e){return typeof e=="undefined"?!0:e===null?!0:e===!1?!0:Object.prototype.toString.call(e)==="[object Array]"&&e.length===0?!0:!1}}}(),Handlebars.VM={template:function(e){var t={escapeExpression:Handlebars.Utils.escapeExpression,invokePartial:Handlebars.VM.invokePartial,programs:[],program:function(e,t,n){var r=this.programs[e];return n?Handlebars.VM.program(t,n):r?r:(r=this.programs[e]=Handlebars.VM.program(t),r)},programWithDepth:Handlebars.VM.programWithDepth,noop:Handlebars.VM.noop};return function(n,r){return r=r||{},e.call(t,Handlebars,n,r.helpers,r.partials,r.data)}},programWithDepth:function(e,t,n){var r=Array.prototype.slice.call(arguments,2);return function(n,i){return i=i||{},e.apply(this,[n,i.data||t].concat(r))}},program:function(e,t){return function(n,r){return r=r||{},e(n,r.data||t)}},noop:function(){return""},invokePartial:function(e,t,n,r,i,s){var o={helpers:r,partials:i,data:s};if(e===undefined)throw new Handlebars.Exception("The partial "+t+" could not be found");if(e instanceof Function)return e(n,o);if(!Handlebars.compile)throw new Handlebars.Exception("The partial "+t+" could not be compiled when running in runtime-only mode");return i[t]=Handlebars.compile(e,{data:s!==undefined}),i[t](n,o)}},Handlebars.template=Handlebars.VM.template,define("handlebars",function(e){return function(){var t,n;return t||e.Handlebars}}(this)),function(e){var t,n=e.Backbone,r=e._,i=e.$,s=n.View.prototype._configure,o=n.View.prototype.render,u=Array.prototype.push,a=Array.prototype.concat,f=Array.prototype.splice,l=n.View.extend({constructor:function(t){t=t||{},l.setupView(this,t),n.View.call(this,t)},insertView:function(e,t){return t?this.setView(e,t,!0):this.setView(e,!0)},insertViews:function(e){return r.isArray(e)?this.setViews({"":e}):(r.each(e,function(t,n){e[n]=r.isArray(t)?t:[t]}),this.setViews(e))},getView:function(e){return this.getViews(e).first().value()},getViews:function(e){var t=r.chain(this.views).map(function(e){return r.isArray(e)?e:[e]},this).flatten().value();return typeof e=="string"?r.chain([this.views[e]]).flatten():r.chain(typeof e=="function"?r.filter(t,e):t)},setView:function(e,t,n){var i,s,o,u=this;typeof e!="string"&&(n=t,t=e,e=""),this.views=this.views||{},i=t.__manager__,s=this.views[e];if(!i)throw new Error("Please set `View#manage` property with selector '"+e+"' to `true`.");return o=t._options(),i.parent=u,i.selector=e,n?(this.views[e]=a.call([],s||[],t),i.append=!0,t):(i.hasRendered&&o.partial(u.el,i.selector,t.el,i.append),s&&r.each(a.call([],s),function(e){e.remove()}),this.views[e]=t)},setViews:function(e){return r.each(e,function(e,t){if(r.isArray(e))return r.each(e,function(e){this.insertView(t,e)},this);this.setView(t,e)},this),this},render:function(){function a(){function a(){var n=t.afterRender;n&&n.call(e,e),e.trigger("afterRender",e)}var r,u;i&&(t.contains(i.el,e.el)||t.partial(i.el,n.selector,e.el,n.append)),e.delegateEvents(),n.hasRendered=!0,o.resolveWith(e,[e]),(r=n.queue.shift())?r():delete n.queue;if(s&&s.queue)return u=function(){i.off("afterRender",u,this),a()},i.on("afterRender",u,e);a()}function f(){var t=e._options(),n=e.__manager__,i=n.parent,s=i&&i.__manager__;e._render(l._viewRender,t).done(function(){if(!r.keys(e.views).length)return a();var n=r.map(e.views,function(e){var n=r.isArray(e);return n&&e.length?e[0].render().pipe(function(){return t.when(r.map(e.slice(1),function(e){return e.render()}))}):n?e:e.render()});t.when(n).done(function(){a()})})}var e=this,t=e._options(),n=e.__manager__,i=n.parent,s=i&&i.__manager__,o=t.deferred();return n.queue?u.call(n.queue,function(){f()}):(n.queue=[],f(e,o)),o.view=e,o},remove:function(){return l._removeView(this,!0),this._remove.apply(this,arguments)},_options:function(){return l.augment({},this,l.prototype.options,this.options)}},{_cache:{},_makeAsync:function(e,t){var n=e.deferred();return n.async=function(){return n._isAsync=!0,t},n},_viewRender:function(e,t){function u(n){n&&t.html(e.$el,n),s.resolveWith(e,[e])}function a(e,r){var i,s=l._makeAsync(t,function(e){u(e)});l.cache(n,r),r&&(i=t.render.call(s,r,e)),s._isAsync||u(i)}var n,i,s,o=e.__manager__;return{render:function(){var o=e.serialize||t.serialize,u=e.data||t.data,f=o||u,c=e.template||t.template;return r.isFunction(f)&&(f=f.call(e)),s=l._makeAsync(t,function(e){a(f,e)}),typeof c=="string"&&(n=t.prefix+c),(i=l.cache(n))?(a(f,i,n),s):(typeof c=="string"?i=t.fetch.call(s,t.prefix+c):c!=null&&(i=t.fetch.call(s,c)),s._isAsync||a(f,i),s)}}},_removeViews:function(e,t){typeof e=="boolean"&&(t=e,e=this),e=e||this,e.getViews().each(function(e){(e.__manager__.hasRendered||t)&&l._removeView(e,t)})},_removeView:function(e,t){var n,i=e.__manager__,s=typeof e.keep=="boolean"?e.keep:e.options.keep;if(!s&&(i.append===!0||t)){l.cleanViews(e),e._removeViews(!0),e.$el.remove();if(!i.parent)return;n=i.parent.views[i.selector];if(r.isArray(n))return r.each(r.clone(n),function(e,t){e&&e.__manager__===i&&f.call(n,t,1)});delete i.parent.views[i.selector]}},cleanViews:function(e){r.each(a.call([],e),function(e){e.unbind(),e.model instanceof n.Model&&e.model.off(null,null,e),e.collection instanceof n.Collection&&e.collection.off(null,null,e),e.cleanup&&e.cleanup.call(e)})},cache:function(e,t){if(e in this._cache)return this._cache[e];if(e!=null&&t!=null)return this._cache[e]=t},configure:function(e){this.augment(l.prototype.options,e),e.manage&&(n.View.prototype.manage=!0)},augment:r.forIn?function(e){return r.reduce(Array.prototype.slice.call(arguments,1),function(e,t){return r.forIn(t,function(t,n){e[n]=t}),e},e)}:r.extend,setupView:function(e,i){if(e.__manager__)return;var s,o,u,f=n.LayoutManager.prototype,c=r.pick(e,t);r.defaults(e,{views:{},__manager__:{},_removeViews:l._removeViews,_removeView:l._removeView},l.prototype),i=e.options=r.defaults(i||{},e.options,f.options),u=r.pick(i,a.call(["events"],r.values(i.events))),l.augment(e,u),(c.render===l.prototype.render||c.render===n.View.prototype.render)&&delete c.render,l.augment(i,c),e._remove=n.View.prototype.remove,e._render=function(e,t){var n=this,r=n.__manager__,i=t.beforeRender;return r.hasRendered&&this._removeViews(),i&&i.call(this,this),this.trigger("beforeRender",this),e(this,t).render()},e.render=l.prototype.render,e.remove!==f.remove&&(e._remove=e.remove,e.remove=f.remove),s=i.views||e.views,r.keys(s).length&&(o=s,e.views={},e.setViews(o)),e.options.template?e.options.template=i.template:e.template&&(i.template=e.template,delete e.template)}});n.Layout=n.LayoutView=n.LayoutManager=l,l.VERSION="0.7.5",n.View.prototype._configure=function(){var e=s.apply(this,arguments);return this.manage&&l.setupView(this),e},l.prototype.options={prefix:"",deferred:function(){return i.Deferred()},fetch:function(e){return r.template(i(e).html())},partial:function(e,t,n,r){var s=t?i(e).find(t):i(e);this[r?"append":"html"](s,n)},html:function(e,t){e.html(t)},append:function(e,t){e.append(t)},when:function(e){return i.when.apply(null,e)},render:function(e,t){return e(t)},contains:function(e,t){return i.contains(e,t)}},t=r.keys(l.prototype.options)}(this),define("layoutmanager",function(){}),define("app",["jquery","underscore","backbone","handlebars","layoutmanager"],function(e,t,n,r){var i={root:"/",Views:{},Models:{}},s=window.JST=window.JST||{};return n.LayoutManager.configure({manage:!0,prefix:"app/templates/",fetch:function(t){var n;return t+=".hbs",s[t]?(s[t].__compiled__||(s[t]=r.template(s[t]),s[t].__compiled__=!0),s[t]):(n=this.async(),e.ajax({url:i.root+t}).then(function(e){s[t]=r.compile(e),s[t].__compiled__=!0,n(s[t])}))}}),t.extend(i,{module:function(e){return t.extend({Views:{}},e)},useLayout:function(r,i){if(this.layout&&this.layout.options.template===r)return this.layout;this.layout&&this.layout.remove();var s=new n.Layout(t.extend({template:r,className:"layout "+r,id:"layout"},i));return e("#main").empty().append(s.el),s.render(),this.layout=s,s}},n.Events)}),function(e,t){function n(){return((1+Math.random())*65536|0).toString(16).substring(1)}function r(){return n()+n()+"-"+n()+"-"+n()+"-"+n()+"-"+n()+n()+n()}t.LocalStorage=window.Store=function(e){this.name=e;var t=this.localStorage().getItem(this.name);this.records=t&&t.split(",")||[]},e.extend(t.LocalStorage.prototype,{save:function(){this.localStorage().setItem(this.name,this.records.join(","))},create:function(e){return e.id||(e.id=r(),e.set(e.idAttribute,e.id)),this.localStorage().setItem(this.name+"-"+e.id,JSON.stringify(e)),this.records.push(e.id.toString()),this.save(),e.toJSON()},update:function(t){return this.localStorage().setItem(this.name+"-"+t.id,JSON.stringify(t)),e.include(this.records,t.id.toString())||this.records.push(t.id.toString()),this.save(),t.toJSON()},find:function(e){return JSON.parse(this.localStorage().getItem(this.name+"-"+e.id))},findAll:function(){return e(this.records).chain().map(function(e){return JSON.parse(this.localStorage().getItem(this.name+"-"+e))},this).compact().value()},destroy:function(t){return this.localStorage().removeItem(this.name+"-"+t.id),this.records=e.reject(this.records,function(e){return e==t.id.toString()}),this.save(),t},localStorage:function(){return localStorage}}),t.LocalStorage.sync=window.Store.sync=t.localSync=function(e,t,n){var r=t.localStorage||t.collection.localStorage,i,s=$.Deferred&&$.Deferred();switch(e){case"read":i=t.id!=undefined?r.find(t):r.findAll();break;case"create":i=r.create(t);break;case"update":i=r.update(t);break;case"delete":i=r.destroy(t)}return i?(n&&n.success&&n.success(i),s&&s.resolve()):(n&&n.error&&n.error("Record not found"),s&&s.reject()),s&&s.promise()},t.ajaxSync=t.sync,t.getSyncMethod=function(e){return e.localStorage||e.collection&&e.collection.localStorage?t.localSync:t.ajaxSync},t.sync=function(e,n,r){return t.getSyncMethod(n).apply(this,[e,n,r])}}(_,Backbone),define("backbone.localStorage",function(){}),define("models/settings",["app","jquery","underscore","backbone","backbone.localStorage"],function(e,t,n,r){var i=r.Model.extend({id:1,defaults:{viewmode:"grid",zoomVal:5},initialize:function(){this.on("change",this.save,this)},localStorage:new r.LocalStorage("settings2")});return e.Models.settings=new i,e.Models.settings}),define("modules/utils",["app","jquery","underscore","backbone"],function(e,t,n,r){var i={};return i.sortObject=function(e){var t=[];for(var n in e)e.hasOwnProperty(n)&&t.push({key:n,value:e[n]});return t.sort(function(e,t){return e.value-t.value}),t},i.cleanDomain=function(e){var t=e;return t=t.replace("https://www.",""),t=t.replace("http://www.",""),t=t.replace("https://",""),t=t.replace("http://",""),t=t.substr(0,t.indexOf("/")),t},i.isURL=function(e){var t=/^([a-z0-9]([-a-z0-9]*[a-z0-9])?\\.)+((a[cdefgilmnoqrstuwxz]|aero|arpa)|(b[abdefghijmnorstvwyz]|biz)|(c[acdfghiklmnorsuvxyz]|cat|com|coop)|d[ejkmoz]|(e[ceghrstu]|edu)|f[ijkmor]|(g[abdefghilmnpqrstuwy]|gov)|h[kmnrtu]|(i[delmnoqrst]|info|int)|(j[emop]|jobs)|k[eghimnprwyz]|l[abcikrstuvy]|(m[acdghklmnopqrstuvwxyz]|mil|mobi|museum)|(n[acefgilopruz]|name|net)|(om|org)|(p[aefghklmnrstwy]|pro)|qa|r[eouw]|s[abcdeghijklmnortvyz]|(t[cdfghjklmnoprtvwz]|travel)|u[agkmsyz]|v[aceginu]|w[fs]|y[etu]|z[amw])$/i,n=/(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;return n.test(e)||t.test(e)?!0:!1},i.urlize=function(e){return i.isUrl(e)?e:"http://"+e},i.getDomain=function(e){return e.match(/:\/\/(www[0-9]?\.)?(.[^\/:]+)/)[2]},i.getTextNodesIn=function(e,t){function o(e){if(e.nodeType===3)(t||!r.test(e.nodeValue))&&n.push(e);else if(e.nodeName!=="#comment"&&e.nodeName!=="SCRIPT"&&e.nodeName!=="STYLE")for(i=0,s=e.childNodes.length;i<s;i+=1)o(e.childNodes[i])}var n=[],r=/^\s*$/,i,s;return o(e),n},i.matchKeywords=function(e,t){t=","+t,e=e.replace(","," "),e=e.replace("+"," "),e=e.replace("   "," "),e=e.replace("  "," ");var r=e.split(" "),i=!0;return n.each(r,function(e){t.indexOf(","+e)<0&&(i=!1)}),i},i}),define("views/single-bookmark",["app","jquery","underscore","backbone"],function(e,t,n,r){var i=r.View.extend({tagName:"li",template:"single-bookmark",data:function(){return this.model.toJSON()},afterRender:function(){this.listenTo(this.model,"change",function(e){var t=n.omit(e.changed,["keep","folder"]);n.keys(t).length&&this.render()}),this.listenTo(this.model,"destroy",function(){this.$el.animate({opacity:.4})})}});return i}),define("models/single-bookmark",["app","jquery","underscore","backbone","modules/utils","views/single-bookmark","backbone.localStorage"],function(e,t,n,r,i,s){var o=r.Model.extend({defaults:{url:"",title:"",type:"",dateAdded:"",folder:[],domain:!1,content_type:"web",thumbnail_url:"",score:0,keep:!1},localStorage:new r.LocalStorage("whatever2"),initialize:function(){var e=this.get("url");i.isURL(e)?this.set("domain",i.getDomain(e)):this.set("domain",!1),this.set_content_type(),this.get("title").length||this.set("title",this.get("domain")),this.set("thumbnail_url",this.get_thumb_url()),this.save()},save:function(e,t){t||(t={}),e=e||this.toJSON(),delete e.keep,t.data=JSON.stringify(e),r.Model.prototype.save.call(this,e,t)},set_content_type:function(){var e=this.get("url"),t=this.get("type"),n;e.indexOf(".pdf")!==-1||e.indexOf("books.google.")!==-1?n="doc":e.indexOf(".jpg")!==-1||e.indexOf(".jpeg")!==-1||e.indexOf(".png")!==-1||e.indexOf(".gif")!==-1||e.indexOf("flickr.com")!==-1?n="photo":e.indexOf("wordpress.")!==-1||e.indexOf("blogger.")!==-1?n="blog":e.indexOf("youtube.")!==-1||e.indexOf("dailymotion.")!==-1||e.indexOf("vimeo.")!==-1?n="video":t==="facebook_friend"?n="person":t==="facebook_like"?n="facebook_like":n="web",this.set("content_type",n)},get_thumb_url:function(){return n.indexOf(["facebook_like","facebook_friend"],this.get("type"))>=0?"http://graph.facebook.com/"+this.get("uid")+"/picture?height=360&width=480":this.get("url").indexOf("https://")===0?"http://pagepeeker.com/thumbs.php?size=x&url="+this.get("url"):"http://immediatenet.com/t/l?Size=1024x768&URL="+this.get("url")}});return o}),function(){var e=this,t={};typeof exports!="undefined"?module.exports=t:e.fuzzy=t,t.simpleFilter=function(e,n){return n.filter(function(n){return t.test(e,n)})},t.test=function(e,n){return t.match(e,n)!==null},t.match=function(e,t,n){n=n||{};var r=0,i=[],s=t.length,o=0,u=0,a=n.pre||"",f=n.post||"",l=n.caseSensitive&&t||t.toLowerCase(),c,h;e=n.caseSensitive&&e||e.toLowerCase();for(var p=0;p<s;p++)c=t[p],l[p]===e[r]?(c=a+c+f,r+=1,u+=1+u):u=0,o+=u,i[i.length]=c;return r===e.length?{rendered:i.join(""),score:o}:null},t.filter=function(e,n,r){return r=r||{},n.reduce(function(n,i,s,o){var u=i;r.extract&&(u=r.extract(i));var a=t.match(e,u,r);return a!=null&&(n[n.length]={string:a.rendered,score:a.score,index:s,original:i}),n},[]).sort(function(e,t){var n=t.score-e.score;return n?n:e.index-t.index})}}(),define("fuzzy",function(e){return function(){var t,n;return t||e.fuzzy}}(this)),define("models/collection-bookmarks",["app","jquery","underscore","backbone","models/settings","models/single-bookmark","fuzzy","modules/utils","backbone.localStorage"],function(e,t,n,r,i,s,o,u){var a=r.Collection.extend({model:s,sortOrder:"score",localStorage:new r.LocalStorage("whatever2"),matchSearch:function(e){var t=this,r=e.keywords.get("value"),i=e.category.get("filterBy"),s=e.category.get("value"),u={},f;if(n.isString(i)&&n.isString(s)&&i.length&&s.length)u[i]=s,f=t.where(u);else{if(!r.length)return t;f=t.toArray()}return r.length?(f=o.filter(r,f,{extract:function(e){return e.get("title")+" "+e.get("url")}}),f=n.map(f,function(e){return e.original.set("score",e.score)}),new a(f)):new a(f)},saveAll:function(){this.each(function(e){e.save()})},comparator:function(e){return e.get(this.sortOrder)*-1},all:function(e){var t=this;return n.uniq(n.pluck(n.pluck(t.models,"attributes"),e))},addDelicious:function(e,r){var s=this;i.set("delicious_user",e);var o="http://feeds.delicious.com/v2/json",u="?count=9999",a=o+"/"+e+u;console.log(a),t.getJSON(a,function(e){n.each(e,function(e){if(s.where({url:e.u}).length===0){var t=(new Date(e.dt)).getTime(),n=e.t;typeof n=="string"||!n?n+=",delicious":n=n.join(",")+",delicious",s.add({title:e.d,url:e.u,type:"delicious",dateAdded:t,keywords:n})}else console.log("not importing duplicate:",e.u)}),r()})},addTwitter:function(e,r){var s=this;i.set("twitter_user",e);var o="https://api.twitter.com/1/statuses/user_timeline.json?include_entities=true&include_rts=true&screen_name=",u="&count=200",a=o+e+u;t.getJSON(a,function(e){n.each(e,function(e){if(e.entities.urls.length>0){var t=(new Date(e.created_at)).getTime(),r=n.pluck(e.entities.urls,"expanded_url");n.each(r,function(n){if(s.where({url:n}).length===0){var r=e.text;r+=",twitter",s.add({title:e.d,url:n,type:"twitter",dateAdded:t,keywords:r}),console.log("imported from twitter: "+n)}else console.log("not importing duplicate:",e.u)})}}),r()})},updateFacebookLinks:function(){if(!localStorage.accessToken)return!1;var e=this.all("type"),t=this.where({type:"facebook"}).length;return t===0?this.addFacebook(5e3,function(){console.log("FB fetching done!")}):this.updateFacebook(),!0},updateFacebook:function(){},addFacebook:function(e,r){r||(r=function(){});if(!localStorage.accessToken)return!1;var s="https://graph.facebook.com/me?"+localStorage.accessToken,o="https://graph.facebook.com/me/feed?limit="+(e||500)+"&"+localStorage.accessToken,u="https://graph.facebook.com/me/likes?fields=website,name,category,description,username&"+localStorage.accessToken,a="select uid, name, website from user where uid IN (select uid2 from friend where uid1=me())",f="https://graph.facebook.com/fql?q="+a+"&"+localStorage.accessToken,l=this;console.log(o),async.parallel([function(e){t.getJSON(o,function(t){console.log("feed",t);var r=[];n.each(t.data,function(e){var t=!1;if(e.link&&e.type!="photo"&&e.type=="link"){e.application&&e.application.name=="Pages"&&(t=!0);if(!t){r.push(e.link);var n=e.name||e.link,i=e.name+","+e.link,s=(new Date(e.created_time)).getTime()||0,o=l.add({title:n,url:e.link,id:e.link,type:"facebook",dateAdded:s,keywords:i})}}}),console.log(r.length+" sites added from FEED",r),e()})},function(e){console.log(u),t.getJSON(u,function(t){console.log("likes",t),n.each(t.data,function(e){var t=(new Date(e.created_time)).getTime()||0,r="http://www.facebook.com/"+e.id;if(e.website)var i=urlize(n.first(e.website.split(" ")));else var i=undefined;if(isUrl(i))var s=i;else var s=r;var o=l.add({title:e.name,uid:e.id,id:e.id,url:s,url_fb:r,type:"facebook_like",dateAdded:t,keywords:"like,facebook,"+e.category,description:e.description})}),e()})},function(e){console.log(f),t.getJSON(f,function(t){n.each(t.data,function(e){var t="http://www.facebook.com/"+e.uid,r=l.add({title:e.name,uid:e.uid,id:e.uid,url:t,type:"facebook_friend",dateAdded:0,keywords:"friend,facebook"+e.name});if(e.website!=""&&e.website&&e.website!=null&&e.website!="null"){var i=e.website.split(/\r\n|\r|\n/);n.each(i,function(t){var n=urlize(t);if(isUrl(n))var r="facebook, friend, friends,"+e.name,i=l.add({title:e.name+"'s website",id:n,url:n,type:"facebook",dateAdded:0,keywords:r})})}}),e()})},function(e){t.getJSON(s,function(t){console.log("me",t),i.set("fb_user",t),e()})}],function(e,t){console.log("DONE FETCHING FB DATA"),i.set("hasFb",!0),r()})}});return a}),define("instances/all-bookmarks",["app","jquery","underscore","backbone","models/collection-bookmarks"],function(e,t,n,r,i){return e.Models.allBookmarks=new i,e.Models.allBookmarks}),define("models/searchCriterias",["app","jquery","underscore","backbone"],function(e,t,n,r){var i=r.Model.extend({defaults:{type:"",filterBy:"",value:""},clear:function(){this.set({filterBy:"",value:""})}});return e.Models.searchCriterias={keywords:new i({type:"keyword"}),category:new i({type:"category"}),clear:function(){this.keywords.clear(),this.category.clear()}},e.Models.searchCriterias}),function(e,t){var n=e(t);e.fn.lazyload=function(r){function u(){var t=0;i.each(function(){var n=e(this);if(o.skip_invisible&&!n.is(":visible"))return;if(!e.abovethetop(this,o)&&!e.leftofbegin(this,o))if(!e.belowthefold(this,o)&&!e.rightoffold(this,o))n.trigger("appear"),t=0;else if(++t>o.failure_limit)return!1})}var i=this,s,o={threshold:0,failure_limit:0,event:"scroll",effect:"show",container:t,data_attribute:"original",skip_invisible:!0,appear:null,load:null};return r&&(undefined!==r.failurelimit&&(r.failure_limit=r.failurelimit,delete r.failurelimit),undefined!==r.effectspeed&&(r.effect_speed=r.effectspeed,delete r.effectspeed),e.extend(o,r)),s=o.container===undefined||o.container===t?n:e(o.container),0===o.event.indexOf("scroll")&&s.bind(o.event,function(e){return u()}),this.each(function(){var t=this,n=e(t);t.loaded=!1,n.one("appear",function(){if(!this.loaded){if(o.appear){var r=i.length;o.appear.call(t,r,o)}e("<img />").bind("load",function(){n.hide().attr("src",n.data(o.data_attribute))[o.effect](o.effect_speed),t.loaded=!0;var r=e.grep(i,function(e){return!e.loaded});i=e(r);if(o.load){var s=i.length;o.load.call(t,s,o)}}).attr("src",n.data(o.data_attribute))}}),0!==o.event.indexOf("scroll")&&n.bind(o.event,function(e){t.loaded||n.trigger("appear")})}),n.bind("resize",function(e){u()}),e(document).ready(function(){u()}),this},e.belowthefold=function(r,i){var s;return i.container===undefined||i.container===t?s=n.height()+n.scrollTop():s=e(i.container).offset().top+e(i.container).height(),s<=e(r).offset().top-i.threshold},e.rightoffold=function(r,i){var s;return i.container===undefined||i.container===t?s=n.width()+n.scrollLeft():s=e(i.container).offset().left+e(i.container).width(),s<=e(r).offset().left-i.threshold},e.abovethetop=function(r,i){var s;return i.container===undefined||i.container===t?s=n.scrollTop():s=e(i.container).offset().top,s>=e(r).offset().top+i.threshold+e(r).height()},e.leftofbegin=function(r,i){var s;return i.container===undefined||i.container===t?s=n.scrollLeft():s=e(i.container).offset().left,s>=e(r).offset().left+i.threshold+e(r).width()},e.inviewport=function(t,n){return!e.rightoffold(t,n)&&!e.leftofbegin(t,n)&&!e.belowthefold(t,n)&&!e.abovethetop(t,n)},e.extend(e.expr[":"],{"below-the-fold":function(t){return e.belowthefold(t,{threshold:0})},"above-the-top":function(t){return!e.belowthefold(t,{threshold:0})},"right-of-screen":function(t){return e.rightoffold(t,{threshold:0})},"left-of-screen":function(t){return!e.rightoffold(t,{threshold:0})},"in-viewport":function(t){return e.inviewport(t,{threshold:0})},"above-the-fold":function(t){return!e.belowthefold(t,{threshold:0})},"right-of-fold":function(t){return e.rightoffold(t,{threshold:0})},"left-of-fold":function(t){return!e.rightoffold(t,{threshold:0})}})}(jQuery,window),define("jquery.lazyload",function(){}),define("views/all-bookmarks",["app","jquery","underscore","backbone","instances/all-bookmarks","models/settings","views/single-bookmark","models/searchCriterias","jquery.lazyload"],function(e,t,n,r,i,s,o,u){var a=r.Layout.extend({id:"bookmarks",tagName:"ul",initialize:function(){this.collection=i,s.on("change:zoomVal",this.setSize,this),s.on("change:viewmode",this.setViewmode,this),u.keywords.on("change:value",n.debounce(this.filter,300),this),u.category.on("change",this.filter,this)},beforeRender:function(){this.collection.each(function(e){this.insertView(new o({model:e}))},this)},afterRender:function(){this.$el.find("img").lazyload({threshold:500}),this.setSize(),this.setViewmode(),t(window).trigger("scroll")},filter:function(){this.collection=i.matchSearch(u),this.render()},setSize:function(){var e=s.get("zoomVal"),n=Math.floor(this.$el.innerWidth()/e),r="";r+=".grid #bookmarks >li{height:"+n+"px;}",t("#write_custom_css").html(r);var i="zoom"+e;t("body").removeClass("zoom1 zoom2 zoom3 zoom4 zoom5 zoom6 zoom7 zoom8 zoom9 zoom10 zoom11 zoom12"),t("body").addClass(i)},setViewmode:function(){s.get("viewmode")==="list"?t("body").removeClass("grid").addClass("list"):t("body").removeClass("list").addClass("grid")}});return a}),define("views/options-page",["app","jquery","underscore","backbone","models/settings","instances/all-bookmarks"],function(e,t,n,r,i,s){var o=r.View.extend({id:"options",tagName:"section",template:"options-page",events:{"click  #options .delicious .btn.add":"add_delicious","click  #options .delicious .btn.remove":"remove_delicious","click .remove_all":"remove_all"},data:function(){return{total:s.length,chromeCount:s.where({type:"chrome"}).length,delicious_user:i.get("delicious_user"),deliciousCount:s.where({type:"delicious"}).length,facebookAuthUrl:this.getFacebookLoginUrl()}},add_delicious:function(e){e.preventDefault();var n=this,r=t("#options .delicious .input").val();r===""?window.alert("please enter your delicious username here"):(console.log("importing delicious user: "+r),t(e.currentTarget).button("loading"),s.addDelicious(r,function(){t(e.currentTarget).button("reset"),n.render_options(),t("#options .delicious .input").val("")}))},remove_delicious:function(e){e&&e.preventDefault();var r=this,o=s.where({type:"delicious"});console.log("rm",o),n.each(o,function(e){console.log("destroy delicious model1:",e),e.destroy({wait:!0})}),i.set("delicious_user",!1),n.delay(function(){r.render_options(),s.render(),t("#options .delicious .input").val("")},200)},remove_all:function(){localStorage.clear(),s.reset()},getFacebookLoginUrl:function(){var e=315929978515082,n="http://www.facebook.com/connect/login_success.html",r="https://www.facebook.com/dialog/oauth",i=["read_stream","user_likes","friends_website"],s={client_id:e,response_type:"token",scope:i.join(","),redirect_uri:n};return r+"?"+t.param(s)}});return o}),define("views/footer",["app","jquery","underscore","backbone","models/settings"],function(e,t,n,r,i){var s=r.View.extend({tagName:"li",template:"footer-zoomLevel",model:i,events:{"change #zoom_level":"changeZoom"},afterRender:function(){this.model.on("change:viewmode",this.update,this),this.update(this.model,this.model.get("viewmode"))},update:function(e,t){var n=t==="grid"?"show":"hide";this.$el[n]()},changeZoom:function(){var e=this.$el.find("#zoom_level").val(),t=2,n=10,r=n-t,i=100/r,s=r-Math.round(e/i)+t;s!==this.model.get("zoomVal")&&this.model.set("zoomVal",s)}}),o=r.View.extend({tagName:"li",template:"footer-viewMode",model:i,events:{"click .js-changemode":"viewmode"},afterRender:function(){this.model.on("change:viewmode",this.update,this),this.update(this.model,this.model.get("viewmode"))},update:function(e,t){var n=this.$el.find(".js-changemode");n.removeClass("active").filter("[data-mode="+t+"]").addClass("active")},viewmode:function(e){var n=t(e.currentTarget),r=n.attr("data-mode");this.model.set("viewmode",r)}}),u=r.View.extend({tagName:"ul",className:"nav pull-right",beforeRender:function(){this.insertView(new s),this.insertView(new o)}}),a=r.View.extend({template:"footer",beforeRender:function(){this.insertViews({".navbar-inner":new u})}});return a}),define("views/folders",["app","jquery","underscore","backbone","instances/all-bookmarks","models/searchCriterias"],function(e,t,n,r,i,s){var o=r.View.extend({template:"folder-item",data:function(){return this.model},afterRender:function(){var e=this.$el,t=this.$("li");this.setElement(t),e.replaceWith(t)}}),u=r.View.extend({tagName:"ul",className:"folders",beforeRender:function(){var e=n.uniq(i.pluck("folder"),!1,function(e){return JSON.stringify(e)});e=n.first(e,15),e=n.map(e,function(e){return{name:e.join(" > ")}}),n.each(e,function(e){this.insertView(new o({model:e}))},this)}}),a=r.View.extend({template:"domain-item",data:function(){return this.model},afterRender:function(){var e=this.$el,t=this.$("li");this.setElement(t),e.replaceWith(t)}}),f=r.View.extend({tagName:"ul",className:"domains",beforeRender:function(){var e=n.groupBy(i.pluck("domain"),function(e){return e});e=n.sortBy(e,"length"),e=n.last(e,5).reverse(),e=n.map(e,function(e){return{name:e[0],quantity:e.length}}),n.each(e,function(e){this.insertView(new a({model:e}))},this)}}),l=r.View.extend({template:"source-item",data:function(){return this.model},afterRender:function(){var e=this.$el,t=this.$("li");this.setElement(t),e.replaceWith(t)}}),c=r.View.extend({tagName:"ul",className:"sources",nameMap:{chrome:{label:"Chrome",icon:"icon-star"},twitter:{label:"Twitter",icon:"icon-retweet"},delicious:{label:"Delicious",icon:"icon-th-large"},facebook:{label:"Facebook Posts",icon:"icon-comment"},facebook_like:{label:"Facebook Likes",icon:"icon-thumbs-up"},facebook_friend:{label:"Facebook Friends",icon:"icon-user"}},beforeRender:function(){var e=this,t=n.groupBy(i.pluck("type"),function(e){return e});t=n.sortBy(t,"length"),t=n.last(t,5).reverse(),t=n.map(t,function(t){return{name:e.nameMap[t[0]].label,icon:e.nameMap[t[0]].icon,quantity:t.length}}),n.each(t,function(e){this.insertView(new l({model:e}))},this)}}),h=r.View.extend({template:"folder-dropdown",events:{"click .js-clear-search":"clear"},beforeRender:function(){this.insertView(".dropdown-menu",new u),this.insertView(".dropdown-menu",new f),this.insertView(".dropdown-menu",new c)},afterRender:function(){var e=this.$el,t=this.$(".categories_drop");this.setElement(t),e.replaceWith(t)},clear:function(e){e&&e.preventDefault(),s.clear()}});return h}),!function(e){e(function(){e.support.transition=function(){var e=function(){var e=document.createElement("bootstrap"),t={WebkitTransition:"webkitTransitionEnd",MozTransition:"transitionend",OTransition:"oTransitionEnd otransitionend",transition:"transitionend"},n;for(n in t)if(e.style[n]!==undefined)return t[n]}();return e&&{end:e}}()})}(window.jQuery),!function(e){var t='[data-dismiss="alert"]',n=function(n){e(n).on("click",t,this.close)};n.prototype.close=function(t){function s(){i.trigger("closed").remove()}var n=e(this),r=n.attr("data-target"),i;r||(r=n.attr("href"),r=r&&r.replace(/.*(?=#[^\s]*$)/,"")),i=e(r),t&&t.preventDefault(),i.length||(i=n.hasClass("alert")?n:n.parent()),i.trigger(t=e.Event("close"));if(t.isDefaultPrevented())return;i.removeClass("in"),e.support.transition&&i.hasClass("fade")?i.on(e.support.transition.end,s):s()},e.fn.alert=function(t){return this.each(function(){var r=e(this),i=r.data("alert");i||r.data("alert",i=new n(this)),typeof t=="string"&&i[t].call(r)})},e.fn.alert.Constructor=n,e(function(){e("body").on("click.alert.data-api",t,n.prototype.close)})}(window.jQuery),!function(e){var t=function(t,n){this.$element=e(t),this.options=e.extend({},e.fn.button.defaults,n)};t.prototype.setState=function(e){var t="disabled",n=this.$element,r=n.data(),i=n.is("input")?"val":"html";e+="Text",r.resetText||n.data("resetText",n[i]()),n[i](r[e]||this.options[e]),setTimeout(function(){e=="loadingText"?n.addClass(t).attr(t,t):n.removeClass(t).removeAttr(t)},0)},t.prototype.toggle=function(){var e=this.$element.closest('[data-toggle="buttons-radio"]');e&&e.find(".active").removeClass("active"),this.$element.toggleClass("active")},e.fn.button=function(n){return this.each(function(){var r=e(this),i=r.data("button"),s=typeof n=="object"&&n;i||r.data("button",i=new t(this,s)),n=="toggle"?i.toggle():n&&i.setState(n)})},e.fn.button.defaults={loadingText:"loading..."},e.fn.button.Constructor=t,e(function(){e("body").on("click.button.data-api","[data-toggle^=button]",function(t){var n=e(t.target);n.hasClass("btn")||(n=n.closest(".btn")),n.button("toggle")})})}(window.jQuery),!function(e){var t=function(t,n){this.$element=e(t),this.options=n,this.options.slide&&this.slide(this.options.slide),this.options.pause=="hover"&&this.$element.on("mouseenter",e.proxy(this.pause,this)).on("mouseleave",e.proxy(this.cycle,this))};t.prototype={cycle:function(t){return t||(this.paused=!1),this.options.interval&&!this.paused&&(this.interval=setInterval(e.proxy(this.next,this),this.options.interval)),this},to:function(t){var n=this.$element.find(".item.active"),r=n.parent().children(),i=r.index(n),s=this;if(t>r.length-1||t<0)return;return this.sliding?this.$element.one("slid",function(){s.to(t)}):i==t?this.pause().cycle():this.slide(t>i?"next":"prev",e(r[t]))},pause:function(t){return t||(this.paused=!0),this.$element.find(".next, .prev").length&&e.support.transition.end&&(this.$element.trigger(e.support.transition.end),this.cycle()),clearInterval(this.interval),this.interval=null,this},next:function(){if(this.sliding)return;return this.slide("next")},prev:function(){if(this.sliding)return;return this.slide("prev")},slide:function(t,n){var r=this.$element.find(".item.active"),i=n||r[t](),s=this.interval,o=t=="next"?"left":"right",u=t=="next"?"first":"last",a=this,f=e.Event("slide",{relatedTarget:i[0]});this.sliding=!0,s&&this.pause(),i=i.length?i:this.$element.find(".item")[u]();if(i.hasClass("active"))return;if(e.support.transition&&this.$element.hasClass("slide")){this.$element.trigger(f);if(f.isDefaultPrevented())return;i.addClass(t),i[0].offsetWidth,r.addClass(o),i.addClass(o),this.$element.one(e.support.transition.end,function(){i.removeClass([t,o].join(" ")).addClass("active"),r.removeClass(["active",o].join(" ")),a.sliding=!1,setTimeout(function(){a.$element.trigger("slid")},0)})}else{this.$element.trigger(f);if(f.isDefaultPrevented())return;r.removeClass("active"),i.addClass("active"),this.sliding=!1,this.$element.trigger("slid")}return s&&this.cycle(),this}},e.fn.carousel=function(n){return this.each(function(){var r=e(this),i=r.data("carousel"),s=e.extend({},e.fn.carousel.defaults,typeof n=="object"&&n),o=typeof n=="string"?n:s.slide;i||r.data("carousel",i=new t(this,s)),typeof n=="number"?i.to(n):o?i[o]():s.interval&&i.cycle()})},e.fn.carousel.defaults={interval:5e3,pause:"hover"},e.fn.carousel.Constructor=t,e(function(){e("body").on("click.carousel.data-api","[data-slide]",function(t){var n=e(this),r,i=e(n.attr("data-target")||(r=n.attr("href"))&&r.replace(/.*(?=#[^\s]+$)/,"")),s=!i.data("modal")&&e.extend({},i.data(),n.data());i.carousel(s),t.preventDefault()})})}(window.jQuery),!function(e){var t=function(t,n){this.$element=e(t),this.options=e.extend({},e.fn.collapse.defaults,n),this.options.parent&&(this.$parent=e(this.options.parent)),this.options.toggle&&this.toggle()};t.prototype={constructor:t,dimension:function(){var e=this.$element.hasClass("width");return e?"width":"height"},show:function(){var t,n,r,i;if(this.transitioning)return;t=this.dimension(),n=e.camelCase(["scroll",t].join("-")),r=this.$parent&&this.$parent.find("> .accordion-group > .in");if(r&&r.length){i=r.data("collapse");if(i&&i.transitioning)return;r.collapse("hide"),i||r.data("collapse",null)}this.$element[t](0),this.transition("addClass",e.Event("show"),"shown"),e.support.transition&&this.$element[t](this.$element[0][n])},hide:function(){var t;if(this.transitioning)return;t=this.dimension(),this.reset(this.$element[t]()),this.transition("removeClass",e.Event("hide"),"hidden"),this.$element[t](0)},reset:function(e){var t=this.dimension();return this.$element.removeClass("collapse")[t](e||"auto")[0].offsetWidth,this.$element[e!==null?"addClass":"removeClass"]("collapse"),this},transition:function(t,n,r){var i=this,s=function(){n.type=="show"&&i.reset(),i.transitioning=0,i.$element.trigger(r)};this.$element.trigger(n);if(n.isDefaultPrevented())return;this.transitioning=1,this.$element[t]("in"),e.support.transition&&this.$element.hasClass("collapse")?this.$element.one(e.support.transition.end,s):s()},toggle:function(){this[this.$element.hasClass("in")?"hide":"show"]()}},e.fn.collapse=function(n){return this.each(function(){var r=e(this),i=r.data("collapse"),s=typeof n=="object"&&n;i||r.data("collapse",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.collapse.defaults={toggle:!0},e.fn.collapse.Constructor=t,e(function(){e("body").on("click.collapse.data-api","[data-toggle=collapse]",function(t){var n=e(this),r,i=n.attr("data-target")||t.preventDefault()||(r=n.attr("href"))&&r.replace(/.*(?=#[^\s]+$)/,""),s=e(i).data("collapse")?"toggle":n.data();n[e(i).hasClass("in")?"addClass":"removeClass"]("collapsed"),e(i).collapse(s)})})}(window.jQuery),!function(e){function r(){i(e(t)).removeClass("open")}function i(t){var n=t.attr("data-target"),r;return n||(n=t.attr("href"),n=n&&/#/.test(n)&&n.replace(/.*(?=#[^\s]*$)/,"")),r=e(n),r.length||(r=t.parent()),r}var t="[data-toggle=dropdown]",n=function(t){var n=e(t).on("click.dropdown.data-api",this.toggle);e("html").on("click.dropdown.data-api",function(){n.parent().removeClass("open")})};n.prototype={constructor:n,toggle:function(t){var n=e(this),s,o;if(n.is(".disabled, :disabled"))return;return s=i(n),o=s.hasClass("open"),r(),o||(s.toggleClass("open"),n.focus()),!1},keydown:function(t){var n,r,s,o,u,a;if(!/(38|40|27)/.test(t.keyCode))return;n=e(this),t.preventDefault(),t.stopPropagation();if(n.is(".disabled, :disabled"))return;o=i(n),u=o.hasClass("open");if(!u||u&&t.keyCode==27)return n.click();r=e("[role=menu] li:not(.divider) a",o);if(!r.length)return;a=r.index(r.filter(":focus")),t.keyCode==38&&a>0&&a--,t.keyCode==40&&a<r.length-1&&a++,~a||(a=0),r.eq(a).focus()}},e.fn.dropdown=function(t){return this.each(function(){var r=e(this),i=r.data("dropdown");i||r.data("dropdown",i=new n(this)),typeof t=="string"&&i[t].call(r)})},e.fn.dropdown.Constructor=n,e(function(){e("html").on("click.dropdown.data-api touchstart.dropdown.data-api",r),e("body").on("click.dropdown touchstart.dropdown.data-api",".dropdown form",function(e){e.stopPropagation()}).on("click.dropdown.data-api touchstart.dropdown.data-api",t,n.prototype.toggle).on("keydown.dropdown.data-api touchstart.dropdown.data-api",t+", [role=menu]",n.prototype.keydown)})}(window.jQuery),!function(e){var t=function(t,n){this.options=n,this.$element=e(t).delegate('[data-dismiss="modal"]',"click.dismiss.modal",e.proxy(this.hide,this)),this.options.remote&&this.$element.find(".modal-body").load(this.options.remote)};t.prototype={constructor:t,toggle:function(){return this[this.isShown?"hide":"show"]()},show:function(){var t=this,n=e.Event("show");this.$element.trigger(n);if(this.isShown||n.isDefaultPrevented())return;e("body").addClass("modal-open"),this.isShown=!0,this.escape(),this.backdrop(function(){var n=e.support.transition&&t.$element.hasClass("fade");t.$element.parent().length||t.$element.appendTo(document.body),t.$element.show(),n&&t.$element[0].offsetWidth,t.$element.addClass("in").attr("aria-hidden",!1).focus(),t.enforceFocus(),n?t.$element.one(e.support.transition.end,function(){t.$element.trigger("shown")}):t.$element.trigger("shown")})},hide:function(t){t&&t.preventDefault();var n=this;t=e.Event("hide"),this.$element.trigger(t);if(!this.isShown||t.isDefaultPrevented())return;this.isShown=!1,e("body").removeClass("modal-open"),this.escape(),e(document).off("focusin.modal"),this.$element.removeClass("in").attr("aria-hidden",!0),e.support.transition&&this.$element.hasClass("fade")?this.hideWithTransition():this.hideModal()},enforceFocus:function(){var t=this;e(document).on("focusin.modal",function(e){t.$element[0]!==e.target&&!t.$element.has(e.target).length&&t.$element.focus()})},escape:function(){var e=this;this.isShown&&this.options.keyboard?this.$element.on("keyup.dismiss.modal",function(t){t.which==27&&e.hide()}):this.isShown||this.$element.off("keyup.dismiss.modal")},hideWithTransition:function(){var t=this,n=setTimeout(function(){t.$element.off(e.support.transition.end),t.hideModal()},500);this.$element.one(e.support.transition.end,function(){clearTimeout(n),t.hideModal()})},hideModal:function(e){this.$element.hide().trigger("hidden"),this.backdrop()},removeBackdrop:function(){this.$backdrop.remove(),this.$backdrop=null},backdrop:function(t){var n=this,r=this.$element.hasClass("fade")?"fade":"";if(this.isShown&&this.options.backdrop){var i=e.support.transition&&r;this.$backdrop=e('<div class="modal-backdrop '+r+'" />').appendTo(document.body),this.options.backdrop!="static"&&this.$backdrop.click(e.proxy(this.hide,this)),i&&this.$backdrop[0].offsetWidth,this.$backdrop.addClass("in"),i?this.$backdrop.one(e.support.transition.end,t):t()}else!this.isShown&&this.$backdrop?(this.$backdrop.removeClass("in"),e.support.transition&&this.$element.hasClass("fade")?this.$backdrop.one(e.support.transition.end,e.proxy(this.removeBackdrop,this)):this.removeBackdrop()):t&&t()}},e.fn.modal=function(n){return this.each(function(){var r=e(this),i=r.data("modal"),s=e.extend({},e.fn.modal.defaults,r.data(),typeof n=="object"&&n);i||r.data("modal",i=new t(this,s)),typeof n=="string"?i[n]():s.show&&i.show()})},e.fn.modal.defaults={backdrop:!0,keyboard:!0,show:!0},e.fn.modal.Constructor=t,e(function(){e("body").on("click.modal.data-api",'[data-toggle="modal"]',function(t){var n=e(this),r=n.attr("href"),i=e(n.attr("data-target")||r&&r.replace(/.*(?=#[^\s]+$)/,"")),s=i.data("modal")?"toggle":e.extend({remote:!/#/.test(r)&&r},i.data(),n.data());t.preventDefault(),i.modal(s).one("hide",function(){n.focus()})})})}(window.jQuery),!function(e){var t=function(e,t){this.init("tooltip",e,t)};t.prototype={constructor:t,init:function(t,n,r){var i,s;this.type=t,this.$element=e(n),this.options=this.getOptions(r),this.enabled=!0,this.options.trigger=="click"?this.$element.on("click."+this.type,this.options.selector,e.proxy(this.toggle,this)):this.options.trigger!="manual"&&(i=this.options.trigger=="hover"?"mouseenter":"focus",s=this.options.trigger=="hover"?"mouseleave":"blur",this.$element.on(i+"."+this.type,this.options.selector,e.proxy(this.enter,this)),this.$element.on(s+"."+this.type,this.options.selector,e.proxy(this.leave,this))),this.options.selector?this._options=e.extend({},this.options,{trigger:"manual",selector:""}):this.fixTitle()},getOptions:function(t){return t=e.extend({},e.fn[this.type].defaults,t,this.$element.data()),t.delay&&typeof t.delay=="number"&&(t.delay={show:t.delay,hide:t.delay}),t},enter:function(t){var n=e(t.currentTarget)[this.type](this._options).data(this.type);if(!n.options.delay||!n.options.delay.show)return n.show();clearTimeout(this.timeout),n.hoverState="in",this.timeout=setTimeout(function(){n.hoverState=="in"&&n.show()},n.options.delay.show)},leave:function(t){var n=e(t.currentTarget)[this.type](this._options).data(this.type);this.timeout&&clearTimeout(this.timeout);if(!n.options.delay||!n.options.delay.hide)return n.hide();n.hoverState="out",this.timeout=setTimeout(function(){n.hoverState=="out"&&n.hide()},n.options.delay.hide)},show:function(){var e,t,n,r,i,s,o;if(this.hasContent()&&this.enabled){e=this.tip(),this.setContent(),this.options.animation&&e.addClass("fade"),s=typeof this.options.placement=="function"?this.options.placement.call(this,e[0],this.$element[0]):this.options.placement,t=/in/.test(s),e.remove().css({top:0,left:0,display:"block"}).appendTo(t?this.$element:document.body),n=this.getPosition(t),r=e[0].offsetWidth,i=e[0].offsetHeight;switch(t?s.split(" ")[1]:s){case"bottom":o={top:n.top+n.height,left:n.left+n.width/2-r/2};break;case"top":o={top:n.top-i,left:n.left+n.width/2-r/2};break;case"left":o={top:n.top+n.height/2-i/2,left:n.left-r};break;case"right":o={top:n.top+n.height/2-i/2,left:n.left+n.width}}e.css(o).addClass(s).addClass("in")}},setContent:function(){var e=this.tip(),t=this.getTitle();e.find(".tooltip-inner")[this.options.html?"html":"text"](t),e.removeClass("fade in top bottom left right")},hide:function(){function r(){var t=setTimeout(function(){n.off(e.support.transition.end).remove()},500);n.one(e.support.transition.end,function(){clearTimeout(t),n.remove()})}var t=this,n=this.tip();return n.removeClass("in"),e.support.transition&&this.$tip.hasClass("fade")?r():n.remove(),this},fixTitle:function(){var e=this.$element;(e.attr("title")||typeof e.attr("data-original-title")!="string")&&e.attr("data-original-title",e.attr("title")||"").removeAttr("title")},hasContent:function(){return this.getTitle()},getPosition:function(t){return e.extend({},t?{top:0,left:0}:this.$element.offset(),{width:this.$element[0].offsetWidth,height:this.$element[0].offsetHeight})},getTitle:function(){var e,t=this.$element,n=this.options;return e=t.attr("data-original-title")||(typeof n.title=="function"?n.title.call(t[0]):n.title),e},tip:function(){return this.$tip=this.$tip||e(this.options.template)},validate:function(){this.$element[0].parentNode||(this.hide(),this.$element=null,this.options=null)},enable:function(){this.enabled=!0},disable:function(){this.enabled=!1},toggleEnabled:function(){this.enabled=!this.enabled},toggle:function(){this[this.tip().hasClass("in")?"hide":"show"]()},destroy:function(){this.hide().$element.off("."+this.type).removeData(this.type)}},e.fn.tooltip=function(n){return this.each(function(){var r=e(this),i=r.data("tooltip"),s=typeof n=="object"&&n;i||r.data("tooltip",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.tooltip.Constructor=t,e.fn.tooltip.defaults={animation:!0,placement:"top",selector:!1,template:'<div class="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',trigger:"hover",title:"",delay:0,html:!0}}(window.jQuery),!function(e){var t=function(e,t){this.init("popover",e,t)};t.prototype=e.extend({},e.fn.tooltip.Constructor.prototype,{constructor:t,setContent:function(){var e=this.tip(),t=this.getTitle(),n=this.getContent();e.find(".popover-title")[this.options.html?"html":"text"](t),e.find(".popover-content > *")[this.options.html?"html":"text"](n),e.removeClass("fade top bottom left right in")},hasContent:function(){return this.getTitle()||this.getContent()},getContent:function(){var e,t=this.$element,n=this.options;return e=t.attr("data-content")||(typeof n.content=="function"?n.content.call(t[0]):n.content),e},tip:function(){return this.$tip||(this.$tip=e(this.options.template)),this.$tip},destroy:function(){this.hide().$element.off("."+this.type).removeData(this.type)}}),e.fn.popover=function(n){return this.each(function(){var r=e(this),i=r.data("popover"),s=typeof n=="object"&&n;i||r.data("popover",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.popover.Constructor=t,e.fn.popover.defaults=e.extend({},e.fn.tooltip.defaults,{placement:"right",trigger:"click",content:"",template:'<div class="popover"><div class="arrow"></div><div class="popover-inner"><h3 class="popover-title"></h3><div class="popover-content"><p></p></div></div></div>'})}(window.jQuery),!function(e){function t(t,n){var r=e.proxy(this.process,this),i=e(t).is("body")?e(window):e(t),s;this.options=e.extend({},e.fn.scrollspy.defaults,n),this.$scrollElement=i.on("scroll.scroll-spy.data-api",r),this.selector=(this.options.target||(s=e(t).attr("href"))&&s.replace(/.*(?=#[^\s]+$)/,"")||"")+" .nav li > a",this.$body=e("body"),this.refresh(),this.process()}t.prototype={constructor:t,refresh:function(){var t=this,n;this.offsets=e([]),this.targets=e([]),n=this.$body.find(this.selector).map(function(){var t=e(this),n=t.data("target")||t.attr("href"),r=/^#\w/.test(n)&&e(n);return r&&r.length&&[[r.position().top,n]]||null}).sort(function(e,t){return e[0]-t[0]}).each(function(){t.offsets.push(this[0]),t.targets.push(this[1])})},process:function(){var e=this.$scrollElement.scrollTop()+this.options.offset,t=this.$scrollElement[0].scrollHeight||this.$body[0].scrollHeight,n=t-this.$scrollElement.height(),r=this.offsets,i=this.targets,s=this.activeTarget,o;if(e>=n)return s!=(o=i.last()[0])&&this.activate(o);for(o=r.length;o--;)s!=i[o]&&e>=r[o]&&(!r[o+1]||e<=r[o+1])&&this.activate(i[o])},activate:function(t){var n,r;this.activeTarget=t,e(this.selector).parent(".active").removeClass("active"),r=this.selector+'[data-target="'+t+'"],'+this.selector+'[href="'+t+'"]',n=e(r).parent("li").addClass("active"),n.parent(".dropdown-menu").length&&(n=n.closest("li.dropdown").addClass("active")),n.trigger("activate")}},e.fn.scrollspy=function(n){return this.each(function(){var r=e(this),i=r.data("scrollspy"),s=typeof n=="object"&&n;i||r.data("scrollspy",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.scrollspy.Constructor=t,e.fn.scrollspy.defaults={offset:10},e(window).on("load",function(){e('[data-spy="scroll"]').each(function(){var t=e(this);t.scrollspy(t.data())})})}(window.jQuery),!function(e){var t=function(t){this.element=e(t)};t.prototype={constructor:t,show:function(){var t=this.element,n=t.closest("ul:not(.dropdown-menu)"),r=t.attr("data-target"),i,s,o;r||(r=t.attr("href"),r=r&&r.replace(/.*(?=#[^\s]*$)/,""));if(t.parent("li").hasClass("active"))return;i=n.find(".active a").last()[0],o=e.Event("show",{relatedTarget:i}),t.trigger(o);if(o.isDefaultPrevented())return;s=e(r),this.activate(t.parent("li"),n),this.activate(s,s.parent(),function(){t.trigger({type:"shown",relatedTarget:i})})},activate:function(t,n,r){function o(){i.removeClass("active").find("> .dropdown-menu > .active").removeClass("active"),t.addClass("active"),s?(t[0].offsetWidth,t.addClass("in")):t.removeClass("fade"),t.parent(".dropdown-menu")&&t.closest("li.dropdown").addClass("active"),r&&r()}var i=n.find("> .active"),s=r&&e.support.transition&&i.hasClass("fade");s?i.one(e.support.transition.end,o):o(),i.removeClass("in")}},e.fn.tab=function(n){return this.each(function(){var r=e(this),i=r.data("tab");i||r.data("tab",i=new t(this)),typeof n=="string"&&i[n]()})},e.fn.tab.Constructor=t,e(function(){e("body").on("click.tab.data-api",'[data-toggle="tab"], [data-toggle="pill"]',function(t){t.preventDefault(),e(this).tab("show")})})}(window.jQuery),!function(e){var t=function(t,n){this.$element=e(t),this.options=e.extend({},e.fn.typeahead.defaults,n),this.matcher=this.options.matcher||this.matcher,this.sorter=this.options.sorter||this.sorter,this.highlighter=this.options.highlighter||this.highlighter,this.updater=this.options.updater||this.updater,this.$menu=e(this.options.menu).appendTo("body"),this.source=this.options.source,this.shown=!1,this.listen()};t.prototype={constructor:t,select:function(){var e=this.$menu.find(".active").attr("data-value");return this.$element.val(this.updater(e)).change(),this.hide()},updater:function(e){return e},show:function(){var t=e.extend({},this.$element.offset(),{height:this.$element[0].offsetHeight});return this.$menu.css({top:t.top+t.height,left:t.left}),this.$menu.show(),this.shown=!0,this},hide:function(){return this.$menu.hide(),this.shown=!1,this},lookup:function(t){var n;return this.query=this.$element.val(),!this.query||this.query.length<this.options.minLength?this.shown?this.hide():this:(n=e.isFunction(this.source)?this.source(this.query,e.proxy(this.process,this)):this.source,n?this.process(n):this)},process:function(t){var n=this;return t=e.grep(t,function(e){return n.matcher(e)}),t=this.sorter(t),t.length?this.render(t.slice(0,this.options.items)).show():this.shown?this.hide():this},matcher:function(e){return~e.toLowerCase().indexOf(this.query.toLowerCase())},sorter:function(e){var t=[],n=[],r=[],i;while(i=e.shift())i.toLowerCase().indexOf(this.query.toLowerCase())?~i.indexOf(this.query)?n.push(i):r.push(i):t.push(i);return t.concat(n,r)},highlighter:function(e){var t=this.query.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g,"\\$&");return e.replace(new RegExp("("+t+")","ig"),function(e,t){return"<strong>"+t+"</strong>"})},render:function(t){var n=this;return t=e(t).map(function(t,r){return t=e(n.options.item).attr("data-value",r),t.find("a").html(n.highlighter(r)),t[0]}),t.first().addClass("active"),this.$menu.html(t),this},next:function(t){var n=this.$menu.find(".active").removeClass("active"),r=n.next();r.length||(r=e(this.$menu.find("li")[0])),r.addClass("active")},prev:function(e){var t=this.$menu.find(".active").removeClass("active"),n=t.prev();n.length||(n=this.$menu.find("li").last()),n.addClass("active")},listen:function(){this.$element.on("blur",e.proxy(this.blur,this)).on("keypress",e.proxy(this.keypress,this)).on("keyup",e.proxy(this.keyup,this)),(e.browser.chrome||e.browser.webkit||e.browser.msie)&&this.$element.on("keydown",e.proxy(this.keydown,this)),this.$menu.on("click",e.proxy(this.click,this)).on("mouseenter","li",e.proxy(this.mouseenter,this))},move:function(e){if(!this.shown)return;switch(e.keyCode){case 9:case 13:case 27:e.preventDefault();break;case 38:e.preventDefault(),this.prev();break;case 40:e.preventDefault(),this.next()}e.stopPropagation()},keydown:function(t){this.suppressKeyPressRepeat=!~e.inArray(t.keyCode,[40,38,9,13,27]),this.move(t)},keypress:function(e){if(this.suppressKeyPressRepeat)return;this.move(e)},keyup:function(e){switch(e.keyCode){case 40:case 38:break;case 9:case 13:if(!this.shown)return;this.select();break;case 27:if(!this.shown)return;this.hide();break;default:this.lookup()}e.stopPropagation(),e.preventDefault()},blur:function(e){var t=this;setTimeout(function(){t.hide()},150)},click:function(e){e.stopPropagation(),e.preventDefault(),this.select()},mouseenter:function(t){this.$menu.find(".active").removeClass("active"),e(t.currentTarget).addClass("active")}},e.fn.typeahead=function(n){return this.each(function(){var r=e(this),i=r.data("typeahead"),s=typeof n=="object"&&n;i||r.data("typeahead",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.typeahead.defaults={source:[],items:8,menu:'<ul class="typeahead dropdown-menu"></ul>',item:'<li><a href="#"></a></li>',minLength:1},e.fn.typeahead.Constructor=t,e(function(){e("body").on("focus.typeahead.data-api",'[data-provide="typeahead"]',function(t){var n=e(this);if(n.data("typeahead"))return;t.preventDefault(),n.typeahead(n.data())})})}(window.jQuery),!function(e){var t=function(t,n){this.options=e.extend({},e.fn.affix.defaults,n),this.$window=e(window).on("scroll.affix.data-api",e.proxy(this.checkPosition,this)),this.$element=e(t),this.checkPosition()};t.prototype.checkPosition=function(){if(!this.$element.is(":visible"))return;var t=e(document).height(),n=this.$window.scrollTop(),r=this.$element.offset(),i=this.options.offset,s=i.bottom,o=i.top,u="affix affix-top affix-bottom",a;typeof i!="object"&&(s=o=i),typeof o=="function"&&(o=i.top()),typeof s=="function"&&(s=i.bottom()),a=this.unpin!=null&&n+this.unpin<=r.top?!1:s!=null&&r.top+this.$element.height()>=t-s?"bottom":o!=null&&n<=o?"top":!1;if(this.affixed===a)return;this.affixed=a,this.unpin=a=="bottom"?r.top-n:null,this.$element.removeClass(u).addClass("affix"+(a?"-"+a:""))},e.fn.affix=function(n){return this.each(function(){var r=e(this),i=r.data("affix"),s=typeof n=="object"&&n;i||r.data("affix",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.affix.Constructor=t,e.fn.affix.defaults={offset:0},e(window).on("load",function(){e('[data-spy="affix"]').each(function(){var t=e(this),n=t.data();n.offset=n.offset||{},n.offsetBottom&&(n.offset.bottom=n.offsetBottom),n.offsetTop&&(n.offset.top=n.offsetTop),t.affix(n)})})}(window.jQuery),define("bootstrap",function(){}),define("views/options-menu",["app","jquery","underscore","backbone","instances/all-bookmarks","models/searchCriterias","bootstrap"],function(e,t,n,r,i,s){var o=r.View.extend({template:"options-menu",events:{"click .js-clear-search":"clear","click  .js-add-delicious":"addDelicious","click  .js-remove-deliciouos":"removeDelicious"},beforeRender:function(){},afterRender:function(){var e=this.$el,t=this.$(".options");this.setElement(t),e.replaceWith(t),this.$(".bt_modal").modal()},clear:function(e){e&&e.preventDefault(),s.clear()},addDelicious:function(e){e.preventDefault();var n=this,r=t("#options .delicious .input").val();r===""?window.alert("please enter your delicious username here"):(console.log("importing delicious user: "+r),t(e.currentTarget).button("loading"),bookmarksCollection.addDelicious(r,function(){t(e.currentTarget).button("reset"),t("#options .delicious .input").val("")}))},removeDelicious:function(e){e&&e.preventDefault();var r=this,i=bookmarksCollection.where({type:"delicious"});console.log("rm",i),n.each(i,function(e){console.log("destroy delicious model1:",e),e.destroy({wait:!0})}),settings.set("delicious_user",!1),n.delay(function(){t("#options .delicious .input").val("")},200)}});return o}),define("views/header",["app","jquery","underscore","backbone","models/settings","instances/all-bookmarks","models/searchCriterias","views/folders","views/options-menu","bootstrap"],function(e,t,n,r,i,s,o,u,a){var f=r.View.extend({template:"header-typeBtn",isActive:!1,events:{"click a":"select"},initialize:function(e){this.type=e.type,this.model=o.category,this.model.on("change",this.change,this)},data:function(){var e={photo:{label:"Photos",icon:"icon-picture"},web:{label:"Websites",icon:"icon-globe"},video:{label:"Videos",icon:"icon-film"},facebook_like:{label:"Facebook Pages",icon:"icon-thumbs-up"},doc:{label:"Documents (pdf)",icon:"icon-book"},music:{label:"Music",icon:"icon-music"},file:{label:"Files",icon:"icon-file"},blog:{label:"Blogs",icon:"icon-comment"},person:{label:"Persons",icon:"icon-user"},nsfw:{label:"NSFW",icon:"icon-eye-open"}};return n.extend(e[this.type],{count:s.where({content_type:this.type}).length})},afterRender:function(){var e=this.$el,t=this.$el.children();this.setElement(t),e.replaceWith(t),this.$(".tip").tooltip()},change:function(e){this.type===e.get("value")&&e.get("filterBy")==="content_type"?(this.isActive=!0,this.$el.addClass("active")):(this.isActive=!1,this.$el.removeClass("active"))},select:function(e){e&&e.preventDefault(),this.isActive?this.model.clear():this.model.set({filterBy:"content_type",value:this.type})}}),l=r.View.extend({tagName:"ul",className:"content_types pull-right",beforeRender:function(){var e=this,t=n.without(s.all("content_type"),undefined);n.each(t,function(t){e.insertView(new f({type:t}))})},afterRender:function(){this.$el.find(".tip").tooltip()}}),c=r.View.extend({className:"nav pull-left",template:"searchBar",initialize:function(){this.model=o.keywords},events:{"keyup #search":"search"},search:function(e){var t=this.$el.find("#search").val();this.model.set("value",t)}}),h=r.View.extend({template:"header",events:{"click .js-clear-search":"clear"},beforeRender:function(){this.insertViews({".navbar-inner":[new c,new l],".dropdown-section":[new u,new a]})},afterRender:function(){this.$(".tip").tooltip()},clear:function(){o.clear()}});return h}),define("router",["app","jquery","underscore","backbone","instances/all-bookmarks","models/searchCriterias","views/all-bookmarks","views/options-page","views/footer","views/header"],function(e,t,n,r,i,s,o,u,a,f){var l=r.Layout.extend({el:"body"}),c=new l;c.setViews({"#header":new f,"#footer":new a});var h=r.Router.extend({routes:{"":"home",options:"options"},home:function(){s.clear(),c.setViews({"#stage":new o}).render().then(function(){t(window).trigger("scroll")}),this.page("home")},options:function(){c.setViews({"#stage":new u}).render(),this.page("options")},page:function(e){t(window).scrollTop(0),e==="options"?(t("#options").show(),t("#bookmarks").hide(),t("body").addClass("options")):(t("#options").hide(),t("#bookmarks").show(),t("body").removeClass("options"))}});return e.router=new h,e.router}),define("main",["app","jquery","underscore","backbone","router","models/settings","instances/all-bookmarks"],function(e,t,n,r,i,s,o){s.fetch();var u=new t.Deferred;o.fetch({success:function(e,t){require(["modules/bookmarks.chrome"],function(e){e.fetch().then(function(){u.resolve()})})}}),u.done(function(){}),r.history.start()}),require.config({deps:["main"],paths:{jquery:"../libs/jquery",lodash:"../libs/lodash.underscore",backbone:"../libs/backbone",handlebars:"../libs/handlebars",fuzzy:"../libs/fuzzy",layoutmanager:"../libs/backbone.layoutmanager",stickit:"../libs/backbone.stickit","backbone.localStorage":"../libs/backbone.localStorage",bootstrap:"../libs/bootstrap","jquery.lazyload":"../libs/jquery.lazyload"},map:{"*":{underscore:"lodash"}},shim:{lodash:{exports:"_"},backbone:{deps:["underscore","jquery"],exports:"Backbone"},handlebars:{exports:"Handlebars"},layoutmanager:["backbone"],stickit:["backbone"],"backbone.localStorage":["backbone"],bootstrap:["jquery"],"jquery.lazyload":["jquery"],fuzzy:{exports:"fuzzy"}}}),define("config",function(){}),define("modules/bookmarks.chrome",["jquery","underscore","instances/all-bookmarks"],function(e,t,n){var r={fetch:function(){return this.importChromeBookmarks()},importChromeBookmarks:function(){var r=new e.Deferred,i=this;return chrome.bookmarks.getTree(function(e,t){i.parseChromeBookmarkTree(e,t,r)}),r.done(function(){var e=n.filter(function(e){return e.get("type")!=="chrome"?!1:!e.get("keep")});t.each(e,function(e){e.destroy()})}),r.promise()},parseChromeBookmarkTree:function(e,n,r){var i=this,n=n||[];t.each(e,function(e){if(e.children&&e.children.length>0){var r=t.uniq(n);e.title&&r.push(e.title),i.parseChromeBookmarkTree(e.children,r)}else i.addChromeBookmark(e,n)}),r&&r.resolve()},addChromeBookmark:function(e,t){var r=n.where({url:e.url})[0],i={title:e.title,url:e.url,id:e.id,type:"chrome",dateAdded:e.dateAdded,folder:t,keep:!0};r?r.set(i):n.add(i)}};return r})