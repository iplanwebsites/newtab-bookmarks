/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.4 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.4',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && navigator && document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
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

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
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
            eachProp(source, function (value, prop) {
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
        return function () {
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
        each(value.split('.'), function (part) {
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
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
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
            var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (getOwn(config.pkgs, baseName)) {
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
                    pkgConfig = getOwn(config.pkgs, (pkgName = name[0]));
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
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
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
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
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
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
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
            var prefix,
                index = name ? name.indexOf('!') : -1;
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
            var url, pluginModule, suffix, nameParts,
                prefix = null,
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
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
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
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
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
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
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
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return (config.config && getOwn(config.config, mod.map.id)) || {};
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
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
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
            var map, modId, err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
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
            eachProp(registry, function (mod) {
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
                each(reqCalls, function (mod) {
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
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
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
            init: function (depMaps, factory, errback, options) {
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
                    errback = bind(this, function (err) {
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

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
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
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
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
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
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
                                if (cjsModule &&
                                        cjsModule.exports !== undefined &&
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

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
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

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
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

            enable: function () {
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
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
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
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
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
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
            configure: function (cfg) {
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

                eachProp(cfg, function (value, prop) {
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
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
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
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
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

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
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
                        if (relMap && hasProp(handlers, deps)) {
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
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
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
                    toUrl: function (moduleNamePlusExt) {
                        var ext, url,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        url = context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext || '.fake');
                        return ext ? url : url.substring(0, url.length - 5);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

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
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overriden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
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
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
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
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
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
            nameToUrl: function (moduleName, ext) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

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
                        pkg = getOwn(pkgs, parentModule);
                        parentPath = getOwn(paths, parentModule);
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

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callack function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
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
            onScriptError: function (evt) {
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
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

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

        context = getOwn(contexts, contextName);
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
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

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
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
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
    req.onError = function (err) {
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
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = config.xhtml ?
                    document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                    document.createElement('script');
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
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
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

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
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
                    subPath = src.length ? src.join('/')  + '/' : './';

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
    define = function (name, deps, callback) {
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
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
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
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

this["JST"] = this["JST"] || {};

this["JST"]["app/templates/domain-item.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\r\n	<a href=\"#\">\r\n		<i class=\"icon-globe\"></i> ";
  if (stack1 = helpers.name) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + " (";
  if (stack1 = helpers.quantity) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.quantity; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + ")\r\n	</a>\r\n</li>\r\n";
  return buffer;
  };

this["JST"]["app/templates/folder-dropdown.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  


  return "<li class=\"dropdown categories_drop\">\r\n	<a class=\"dropdown-toggle tip\" data-toggle=\"dropdown\"   href=\"#\"  rel=\"tooltip\" data-placement=\"bottom\" data-original-title=\"Select Folder\">\r\n		<img src=\"../assets/img/white/33-cabinet@2x.png\" class=\"folder\">\r\n	</a>\r\n	\r\n	<div class=\"dropdown-menu category\">\r\n		<div class=\"general-options\">\r\n			<a href=\"#\" class=\"js-clear-search\">\r\n				<i class=\"icon-home\"></i> View all\r\n			</a>\r\n		</div>\r\n\r\n	</ul>\r\n	</div>\r\n</li>\r\n";
  };

this["JST"]["app/templates/folder-item.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\r\n	<a href=\"#\">\r\n		<i class=\"icon-folder-close\"></i> ";
  if (stack1 = helpers.name) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\r\n	</a>\r\n</li>\r\n";
  return buffer;
  };

this["JST"]["app/templates/footer-viewMode.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  


  return "<div class=\"btn-group viewmode\" data-toggle=\"buttons-radio\">\r\n	<button type=\"button\" class=\"btn grid js-changemode\" data-mode=\"grid\">\r\n		<i class=\"icon-th-large\"></i>\r\n		Grid\r\n	</button>\r\n	<button type=\"button\" class=\"btn list js-changemode\" data-mode=\"list\">\r\n		<i class=\"icon-th-list\"></i>\r\n		List\r\n	</button>\r\n</div>";
  };

this["JST"]["app/templates/footer-zoomLevel.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  


  return "<input type=\"range\"  min=\"0\" max=\"100\" id=\"zoom_level\" value=\"50\" />\r\n";
  };

this["JST"]["app/templates/footer.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  


  return "<div class=\"navbar-inner\">\r\n	<div class=\"copyright\">\r\n		<a href=\"http://iplanwebsites.com\">\r\n			Made with ♥ by THIN\r\n		</a>\r\n	</div>\r\n	\r\n	<div class=\"alert alert-info html-download span5 pull-left hide\">\r\n		<button type=\"button\" class=\"close stop\" >×</a>\r\n		<div class=\"progress progress-striped active download\">\r\n			<div class=\"bar\" style=\"width: 1%;\"></div>\r\n		</div>\r\n		Indexing websites for full text search ~ <strong>count</strong>\r\n	</div>\r\n	\r\n	<div class=\"alert alert-success html-download-complete span5 pull-left hide\">\r\n		<i class=\"icon-ok\"></i><strong>count</strong> pages indexed!\r\n		<button type=\"button\" class=\"close\" data-dismiss=\"alert\">×</button>\r\n	</div>\r\n</div>\r\n";
  };

this["JST"]["app/templates/header-typeBtn.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\r\n	<a href=\"#\" class=\"tip\" rel=\"tooltip\" data-placement=\"bottom\" data-original-title=\"";
  if (stack1 = helpers.label) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.label; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + " - ";
  if (stack1 = helpers.count) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.count; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" >\r\n		<i class=\"";
  if (stack1 = helpers.icon) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.icon; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + " icon-white\"></i>\r\n	</a>\r\n</li>\r\n";
  return buffer;
  };

this["JST"]["app/templates/header.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  


  return "<div class=\"navbar top navbar-inverse navbar-fixed-top\">\r\n	<div class=\"navbar-inner\">\r\n		\r\n		<a href=\"#\" class=\"js-clear-search starlogo tip\" rel=\"tooltip\" data-placement=\"left\" data-original-title=\"All Bookmarks\">\r\n			<img src=\"../assets/img/logo2.png\" >\r\n		</a>\r\n\r\n		<ul class=\"nav pull-right dropdown-section\">\r\n			\r\n		</ul>\r\n	</div>\r\n</div>\r\n";
  };

this["JST"]["app/templates/options-menu.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  


  return "<li class=\"options\">\r\n	<a class=\"dropdown-toggle tip\" data-toggle=\"dropdown\" href=\"#\" rel=\"tooltip\" data-placement=\"bottom\" data-original-title=\"Add source\">\r\n		<img src=\"../assets/img/white/19-gear@2x.png\" class=\"cog\">\r\n	</a>\r\n\r\n	<ul class=\"dropdown-menu options_menu\">\r\n	\r\n		<li class=\"all_bookmarks\">\r\n			<a href=\"#options\">\r\n				<i class=\"icon-home\"></i> Stats (former option page)\r\n			</a>\r\n		</li>\r\n		\r\n		<li class=\"divider\"></li>\r\n		<li class=\"all_bookmarks\">\r\n			<a href=\"#\" class=\"js-clear-search\">\r\n				<i class=\"icon-home\"></i> View all\r\n			</a>\r\n		</li>\r\n		\r\n		<li class=\"divider\"></li>\r\n		<li>\r\n			<a href=\"#twitter_modal\" role=\"button\" class=\"btn2\" data-toggle=\"modal\" class=\"bt_modal222\">\r\n				<i class=\"icon-star\"></i> Add Twitter\r\n			</a>\r\n		</li>\r\n		<li>\r\n			<a href=\"\">\r\n				<i class=\"icon-retweet\"></i> Add Facebook\r\n			</a>\r\n		</li>\r\n		<li>\r\n			<a href=\"\" class=\"js-add-delicious\">\r\n				<i class=\"icon-th-large\"></i> Add Delicious\r\n			</a>\r\n		</li>\r\n		<li>\r\n			<a href=\"\" >\r\n				<i class=\"icon-th-large\"></i> Add Pinboard\r\n			</a>\r\n		</li>\r\n		\r\n		<li class=\"divider\"></li>\r\n		<li>\r\n			<a href=\"#\">\r\n				<i class=\"icon-info\"></i> About... (modal)\r\n			</a>\r\n		</li>\r\n		\r\n	</ul>\r\n</li>\r\n";
  };

this["JST"]["app/templates/options-page.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = "", stack1;
  buffer += "\r\n			<div class=\"connected\">\r\n				<p>\r\n					<strong class=\"count\">";
  if (stack1 = helpers.deliciousCount) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.deliciousCount; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</strong>\r\n					Delicious bookmarks indexed from account ";
  if (stack1 = helpers.delicious_user) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.delicious_user; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\r\n				</p>\r\n				<button class=\"btn btn-mini js-remove\"><i class=\"icon-trash \"></i>Remove</button>\r\n			</div>\r\n		";
  return buffer;
  }

function program3(depth0,data) {
  
  
  return "\r\n			<div class=\"start\">\r\n				<p>\r\n					Include your public Delicious bookmarks\r\n				</p>\r\n				<input type=\"text\" class=\"input-medium input search-query\" placeholder=\"userlicious\">\r\n				<button class=\"btn btn-success js-add\">\r\n					<i class=\"icon-plus icon-white\"></i>\r\n					Add it\r\n				</button>\r\n			</div>\r\n		";
  }

  buffer += "<div class=\"container\">\r\n	\r\n	<br><br>\r\n	\r\n	<div class=\"well totals span12\">\r\n		\r\n		<h1><strong>";
  if (stack1 = helpers.total) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.total; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</strong> sites and articles</h1>\r\n		<p>Add Tweeted articles and websites</p>\r\n		\r\n	</div>\r\n  \r\n	<div class=\"alert alert-info service chrome span7\">\r\n		<img src=\"../img/chrome logo.png\" class=\"logo pull-left span1\" />\r\n		<h4>Chrome</h4>\r\n		<p>\r\n			<strong class=\"count\">";
  if (stack1 = helpers.chromeCount) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.chromeCount; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</strong>\r\n			browser bookmarks indexed\r\n		</p>\r\n		<button class=\"btn btn-mini refresh\">\r\n			<i class=\"icon-refresh\"></i>\r\n			Refresh\r\n		</button>\r\n	</div>\r\n	\r\n	<p>\r\n		<a target=\"_blank\" id=\"fb_connect\" href=\"";
  if (stack1 = helpers.facebookAuthUrl) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.facebookAuthUrl; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" class=\"btn btn-primary\">\r\n			<i class=\"icon-user icon-white\"></i>\r\n			Facebook Connect\r\n		</a>\r\n	</p>\r\n	\r\n	<div class=\"alert alert-info service twitter span7\">\r\n		<img src=\"../img/twitter-bird-light-bgs.png\" class=\"logo pull-left span1\" />\r\n		<h4>Twitter</h4>\r\n		<p>Add Tweeted articles and websites</p>\r\n		<form class=\"form-search\">\r\n		<input type=\"text\" class=\"input-medium input search-query\" placeholder=\"@you\">\r\n		<button class=\"btn btn-info add\"><i class=\"icon-plus icon-white\"></i>Add Twitter</button>\r\n		</form>\r\n	</div>\r\n\r\n	<div class=\"alert alert-success service delicious span7\">\r\n		<img src=\"../img/del_logo.png\" class=\"logo pull-left span1\" />\r\n		<h4>Delicious</h4>\r\n		\r\n		";
  stack1 = helpers['if'].call(depth0, depth0.delicious_user, {hash:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data),data:data});
  if(stack1 || stack1 === 0) { buffer += stack1; }
  buffer += "\r\n		\r\n	</div>\r\n  \r\n	<button class=\"btn btn-mini  remove_all\">\r\n		<i class=\"icon-trash \"></i>\r\n		Reset everything\r\n	</button>\r\n	\r\n	config: toggle class \"3dfx\" on body to disable crazy 3d FX\r\n  \r\n</div>\r\n";
  return buffer;
  };

this["JST"]["app/templates/searchBar.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  


  return "<div class=\"input-append search_form\">\r\n	<input id=\"search\"  type=\"search\" placeholder=\"Search\">\r\n	<button class=\"btn btn-success\" type=\"button\">\r\n		<i class=\"icon-search icon-white\"></i>\r\n	</button>\r\n</div>";
  };

this["JST"]["app/templates/single-bookmark.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<a href=\"";
  if (stack1 = helpers.url) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.url; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\">\r\n	<div class=\"thumb_wrap\">\r\n		<img src=\"../img/grey_photo.gif\" data-original=\"";
  if (stack1 = helpers.thumbnail_url) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.thumbnail_url; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" class=\"thumb\" width=\"205\" height=\"154\">\r\n	</div>\r\n	<div class=\"meta\">\r\n		<img src=\"chrome://favicon/";
  if (stack1 = helpers.url) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.url; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\" class=\"favicon\" />\r\n		";
  if (stack1 = helpers.title) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.title; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\r\n		~\r\n		<em class=\"domain\">";
  if (stack1 = helpers.domain) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.domain; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</em>\r\n	</div>\r\n</a>\r\n";
  return buffer;
  };

this["JST"]["app/templates/source-item.hbs"] = function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<li>\r\n	<a href=\"#\">\r\n		<i class=\"";
  if (stack1 = helpers.icon) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.icon; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "\"></i> ";
  if (stack1 = helpers.name) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + " (";
  if (stack1 = helpers.quantity) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.quantity; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + ")\r\n	</a>\r\n</li>\r\n";
  return buffer;
  };
require.config({ baseUrl: "../app/", waitSeconds: 30 });
/*!
 * jQuery JavaScript Library v1.8.3
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright 2012 jQuery Foundation and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: Tue Nov 13 2012 08:20:33 GMT-0500 (Eastern Standard Time)
 */
(function( window, undefined ) {
var
	// A central reference to the root jQuery(document)
	rootjQuery,

	// The deferred used on DOM ready
	readyList,

	// Use the correct document accordingly with window argument (sandbox)
	document = window.document,
	location = window.location,
	navigator = window.navigator,

	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$,

	// Save a reference to some core methods
	core_push = Array.prototype.push,
	core_slice = Array.prototype.slice,
	core_indexOf = Array.prototype.indexOf,
	core_toString = Object.prototype.toString,
	core_hasOwn = Object.prototype.hasOwnProperty,
	core_trim = String.prototype.trim,

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {
		// The jQuery object is actually just the init constructor 'enhanced'
		return new jQuery.fn.init( selector, context, rootjQuery );
	},

	// Used for matching numbers
	core_pnum = /[\-+]?(?:\d*\.|)\d+(?:[eE][\-+]?\d+|)/.source,

	// Used for detecting and trimming whitespace
	core_rnotwhite = /\S/,
	core_rspace = /\s+/,

	// Make sure we trim BOM and NBSP (here's looking at you, Safari 5.0 and IE)
	rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	rquickExpr = /^(?:[^#<]*(<[\w\W]+>)[^>]*$|#([\w\-]*)$)/,

	// Match a standalone tag
	rsingleTag = /^<(\w+)\s*\/?>(?:<\/\1>|)$/,

	// JSON RegExp
	rvalidchars = /^[\],:{}\s]*$/,
	rvalidbraces = /(?:^|:|,)(?:\s*\[)+/g,
	rvalidescape = /\\(?:["\\\/bfnrt]|u[\da-fA-F]{4})/g,
	rvalidtokens = /"[^"\\\r\n]*"|true|false|null|-?(?:\d\d*\.|)\d+(?:[eE][\-+]?\d+|)/g,

	// Matches dashed string for camelizing
	rmsPrefix = /^-ms-/,
	rdashAlpha = /-([\da-z])/gi,

	// Used by jQuery.camelCase as callback to replace()
	fcamelCase = function( all, letter ) {
		return ( letter + "" ).toUpperCase();
	},

	// The ready event handler and self cleanup method
	DOMContentLoaded = function() {
		if ( document.addEventListener ) {
			document.removeEventListener( "DOMContentLoaded", DOMContentLoaded, false );
			jQuery.ready();
		} else if ( document.readyState === "complete" ) {
			// we're here because readyState === "complete" in oldIE
			// which is good enough for us to call the dom ready!
			document.detachEvent( "onreadystatechange", DOMContentLoaded );
			jQuery.ready();
		}
	},

	// [[Class]] -> type pairs
	class2type = {};

jQuery.fn = jQuery.prototype = {
	constructor: jQuery,
	init: function( selector, context, rootjQuery ) {
		var match, elem, ret, doc;

		// Handle $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Handle $(DOMElement)
		if ( selector.nodeType ) {
			this.context = this[0] = selector;
			this.length = 1;
			return this;
		}

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector.charAt(0) === "<" && selector.charAt( selector.length - 1 ) === ">" && selector.length >= 3 ) {
				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && (match[1] || !context) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[1] ) {
					context = context instanceof jQuery ? context[0] : context;
					doc = ( context && context.nodeType ? context.ownerDocument || context : document );

					// scripts is true for back-compat
					selector = jQuery.parseHTML( match[1], doc, true );
					if ( rsingleTag.test( match[1] ) && jQuery.isPlainObject( context ) ) {
						this.attr.call( selector, context, true );
					}

					return jQuery.merge( this, selector );

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[2] );

					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE and Opera return items
						// by name instead of ID
						if ( elem.id !== match[2] ) {
							return rootjQuery.find( selector );
						}

						// Otherwise, we inject the element directly into the jQuery object
						this.length = 1;
						this[0] = elem;
					}

					this.context = document;
					this.selector = selector;
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || rootjQuery ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( jQuery.isFunction( selector ) ) {
			return rootjQuery.ready( selector );
		}

		if ( selector.selector !== undefined ) {
			this.selector = selector.selector;
			this.context = selector.context;
		}

		return jQuery.makeArray( selector, this );
	},

	// Start with an empty selector
	selector: "",

	// The current version of jQuery being used
	jquery: "1.8.3",

	// The default length of a jQuery object is 0
	length: 0,

	// The number of elements contained in the matched element set
	size: function() {
		return this.length;
	},

	toArray: function() {
		return core_slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {
		return num == null ?

			// Return a 'clean' array
			this.toArray() :

			// Return just the object
			( num < 0 ? this[ this.length + num ] : this[ num ] );
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems, name, selector ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;

		ret.context = this.context;

		if ( name === "find" ) {
			ret.selector = this.selector + ( this.selector ? " " : "" ) + selector;
		} else if ( name ) {
			ret.selector = this.selector + "." + name + "(" + selector + ")";
		}

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	// (You can seed the arguments with an array of args, but this is
	// only used internally.)
	each: function( callback, args ) {
		return jQuery.each( this, callback, args );
	},

	ready: function( fn ) {
		// Add the callback
		jQuery.ready.promise().done( fn );

		return this;
	},

	eq: function( i ) {
		i = +i;
		return i === -1 ?
			this.slice( i ) :
			this.slice( i, i + 1 );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	slice: function() {
		return this.pushStack( core_slice.apply( this, arguments ),
			"slice", core_slice.call(arguments).join(",") );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map(this, function( elem, i ) {
			return callback.call( elem, i, elem );
		}));
	},

	end: function() {
		return this.prevObject || this.constructor(null);
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: core_push,
	sort: [].sort,
	splice: [].splice
};

// Give the init function the jQuery prototype for later instantiation
jQuery.fn.init.prototype = jQuery.fn;

jQuery.extend = jQuery.fn.extend = function() {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
		target = {};
	}

	// extend jQuery itself if only one argument is passed
	if ( length === i ) {
		target = this;
		--i;
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend({
	noConflict: function( deep ) {
		if ( window.$ === jQuery ) {
			window.$ = _$;
		}

		if ( deep && window.jQuery === jQuery ) {
			window.jQuery = _jQuery;
		}

		return jQuery;
	},

	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Hold (or release) the ready event
	holdReady: function( hold ) {
		if ( hold ) {
			jQuery.readyWait++;
		} else {
			jQuery.ready( true );
		}
	},

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Make sure body exists, at least, in case IE gets a little overzealous (ticket #5443).
		if ( !document.body ) {
			return setTimeout( jQuery.ready, 1 );
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );

		// Trigger any bound ready events
		if ( jQuery.fn.trigger ) {
			jQuery( document ).trigger("ready").off("ready");
		}
	},

	// See test/unit/core.js for details concerning isFunction.
	// Since version 1.3, DOM methods and functions like alert
	// aren't supported. They return false on IE (#2968).
	isFunction: function( obj ) {
		return jQuery.type(obj) === "function";
	},

	isArray: Array.isArray || function( obj ) {
		return jQuery.type(obj) === "array";
	},

	isWindow: function( obj ) {
		return obj != null && obj == obj.window;
	},

	isNumeric: function( obj ) {
		return !isNaN( parseFloat(obj) ) && isFinite( obj );
	},

	type: function( obj ) {
		return obj == null ?
			String( obj ) :
			class2type[ core_toString.call(obj) ] || "object";
	},

	isPlainObject: function( obj ) {
		// Must be an Object.
		// Because of IE, we also have to check the presence of the constructor property.
		// Make sure that DOM nodes and window objects don't pass through, as well
		if ( !obj || jQuery.type(obj) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
			return false;
		}

		try {
			// Not own constructor property must be Object
			if ( obj.constructor &&
				!core_hasOwn.call(obj, "constructor") &&
				!core_hasOwn.call(obj.constructor.prototype, "isPrototypeOf") ) {
				return false;
			}
		} catch ( e ) {
			// IE8,9 Will throw exceptions on certain host objects #9897
			return false;
		}

		// Own properties are enumerated firstly, so to speed up,
		// if last one is own, then all properties are own.

		var key;
		for ( key in obj ) {}

		return key === undefined || core_hasOwn.call( obj, key );
	},

	isEmptyObject: function( obj ) {
		var name;
		for ( name in obj ) {
			return false;
		}
		return true;
	},

	error: function( msg ) {
		throw new Error( msg );
	},

	// data: string of html
	// context (optional): If specified, the fragment will be created in this context, defaults to document
	// scripts (optional): If true, will include scripts passed in the html string
	parseHTML: function( data, context, scripts ) {
		var parsed;
		if ( !data || typeof data !== "string" ) {
			return null;
		}
		if ( typeof context === "boolean" ) {
			scripts = context;
			context = 0;
		}
		context = context || document;

		// Single tag
		if ( (parsed = rsingleTag.exec( data )) ) {
			return [ context.createElement( parsed[1] ) ];
		}

		parsed = jQuery.buildFragment( [ data ], context, scripts ? null : [] );
		return jQuery.merge( [],
			(parsed.cacheable ? jQuery.clone( parsed.fragment ) : parsed.fragment).childNodes );
	},

	parseJSON: function( data ) {
		if ( !data || typeof data !== "string") {
			return null;
		}

		// Make sure leading/trailing whitespace is removed (IE can't handle it)
		data = jQuery.trim( data );

		// Attempt to parse using the native JSON parser first
		if ( window.JSON && window.JSON.parse ) {
			return window.JSON.parse( data );
		}

		// Make sure the incoming data is actual JSON
		// Logic borrowed from http://json.org/json2.js
		if ( rvalidchars.test( data.replace( rvalidescape, "@" )
			.replace( rvalidtokens, "]" )
			.replace( rvalidbraces, "")) ) {

			return ( new Function( "return " + data ) )();

		}
		jQuery.error( "Invalid JSON: " + data );
	},

	// Cross-browser xml parsing
	parseXML: function( data ) {
		var xml, tmp;
		if ( !data || typeof data !== "string" ) {
			return null;
		}
		try {
			if ( window.DOMParser ) { // Standard
				tmp = new DOMParser();
				xml = tmp.parseFromString( data , "text/xml" );
			} else { // IE
				xml = new ActiveXObject( "Microsoft.XMLDOM" );
				xml.async = "false";
				xml.loadXML( data );
			}
		} catch( e ) {
			xml = undefined;
		}
		if ( !xml || !xml.documentElement || xml.getElementsByTagName( "parsererror" ).length ) {
			jQuery.error( "Invalid XML: " + data );
		}
		return xml;
	},

	noop: function() {},

	// Evaluates a script in a global context
	// Workarounds based on findings by Jim Driscoll
	// http://weblogs.java.net/blog/driscoll/archive/2009/09/08/eval-javascript-global-context
	globalEval: function( data ) {
		if ( data && core_rnotwhite.test( data ) ) {
			// We use execScript on Internet Explorer
			// We use an anonymous function so that context is window
			// rather than jQuery in Firefox
			( window.execScript || function( data ) {
				window[ "eval" ].call( window, data );
			} )( data );
		}
	},

	// Convert dashed to camelCase; used by the css and data modules
	// Microsoft forgot to hump their vendor prefix (#9572)
	camelCase: function( string ) {
		return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
	},

	nodeName: function( elem, name ) {
		return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
	},

	// args is for internal usage only
	each: function( obj, callback, args ) {
		var name,
			i = 0,
			length = obj.length,
			isObj = length === undefined || jQuery.isFunction( obj );

		if ( args ) {
			if ( isObj ) {
				for ( name in obj ) {
					if ( callback.apply( obj[ name ], args ) === false ) {
						break;
					}
				}
			} else {
				for ( ; i < length; ) {
					if ( callback.apply( obj[ i++ ], args ) === false ) {
						break;
					}
				}
			}

		// A special, fast, case for the most common use of each
		} else {
			if ( isObj ) {
				for ( name in obj ) {
					if ( callback.call( obj[ name ], name, obj[ name ] ) === false ) {
						break;
					}
				}
			} else {
				for ( ; i < length; ) {
					if ( callback.call( obj[ i ], i, obj[ i++ ] ) === false ) {
						break;
					}
				}
			}
		}

		return obj;
	},

	// Use native String.trim function wherever possible
	trim: core_trim && !core_trim.call("\uFEFF\xA0") ?
		function( text ) {
			return text == null ?
				"" :
				core_trim.call( text );
		} :

		// Otherwise use our own trimming functionality
		function( text ) {
			return text == null ?
				"" :
				( text + "" ).replace( rtrim, "" );
		},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var type,
			ret = results || [];

		if ( arr != null ) {
			// The window, strings (and functions) also have 'length'
			// Tweaked logic slightly to handle Blackberry 4.7 RegExp issues #6930
			type = jQuery.type( arr );

			if ( arr.length == null || type === "string" || type === "function" || type === "regexp" || jQuery.isWindow( arr ) ) {
				core_push.call( ret, arr );
			} else {
				jQuery.merge( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		var len;

		if ( arr ) {
			if ( core_indexOf ) {
				return core_indexOf.call( arr, elem, i );
			}

			len = arr.length;
			i = i ? i < 0 ? Math.max( 0, len + i ) : i : 0;

			for ( ; i < len; i++ ) {
				// Skip accessing in sparse arrays
				if ( i in arr && arr[ i ] === elem ) {
					return i;
				}
			}
		}

		return -1;
	},

	merge: function( first, second ) {
		var l = second.length,
			i = first.length,
			j = 0;

		if ( typeof l === "number" ) {
			for ( ; j < l; j++ ) {
				first[ i++ ] = second[ j ];
			}

		} else {
			while ( second[j] !== undefined ) {
				first[ i++ ] = second[ j++ ];
			}
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, inv ) {
		var retVal,
			ret = [],
			i = 0,
			length = elems.length;
		inv = !!inv;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			retVal = !!callback( elems[ i ], i );
			if ( inv !== retVal ) {
				ret.push( elems[ i ] );
			}
		}

		return ret;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var value, key,
			ret = [],
			i = 0,
			length = elems.length,
			// jquery objects are treated as arrays
			isArray = elems instanceof jQuery || length !== undefined && typeof length === "number" && ( ( length > 0 && elems[ 0 ] && elems[ length -1 ] ) || length === 0 || jQuery.isArray( elems ) ) ;

		// Go through the array, translating each of the items to their
		if ( isArray ) {
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret[ ret.length ] = value;
				}
			}

		// Go through every key on the object,
		} else {
			for ( key in elems ) {
				value = callback( elems[ key ], key, arg );

				if ( value != null ) {
					ret[ ret.length ] = value;
				}
			}
		}

		// Flatten any nested arrays
		return ret.concat.apply( [], ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// Bind a function to a context, optionally partially applying any
	// arguments.
	proxy: function( fn, context ) {
		var tmp, args, proxy;

		if ( typeof context === "string" ) {
			tmp = fn[ context ];
			context = fn;
			fn = tmp;
		}

		// Quick check to determine if target is callable, in the spec
		// this throws a TypeError, but we will just return undefined.
		if ( !jQuery.isFunction( fn ) ) {
			return undefined;
		}

		// Simulated bind
		args = core_slice.call( arguments, 2 );
		proxy = function() {
			return fn.apply( context, args.concat( core_slice.call( arguments ) ) );
		};

		// Set the guid of unique handler to the same of original handler, so it can be removed
		proxy.guid = fn.guid = fn.guid || jQuery.guid++;

		return proxy;
	},

	// Multifunctional method to get and set values of a collection
	// The value/s can optionally be executed if it's a function
	access: function( elems, fn, key, value, chainable, emptyGet, pass ) {
		var exec,
			bulk = key == null,
			i = 0,
			length = elems.length;

		// Sets many values
		if ( key && typeof key === "object" ) {
			for ( i in key ) {
				jQuery.access( elems, fn, i, key[i], 1, emptyGet, value );
			}
			chainable = 1;

		// Sets one value
		} else if ( value !== undefined ) {
			// Optionally, function values get executed if exec is true
			exec = pass === undefined && jQuery.isFunction( value );

			if ( bulk ) {
				// Bulk operations only iterate when executing function values
				if ( exec ) {
					exec = fn;
					fn = function( elem, key, value ) {
						return exec.call( jQuery( elem ), value );
					};

				// Otherwise they run against the entire set
				} else {
					fn.call( elems, value );
					fn = null;
				}
			}

			if ( fn ) {
				for (; i < length; i++ ) {
					fn( elems[i], key, exec ? value.call( elems[i], i, fn( elems[i], key ) ) : value, pass );
				}
			}

			chainable = 1;
		}

		return chainable ?
			elems :

			// Gets
			bulk ?
				fn.call( elems ) :
				length ? fn( elems[0], key ) : emptyGet;
	},

	now: function() {
		return ( new Date() ).getTime();
	}
});

jQuery.ready.promise = function( obj ) {
	if ( !readyList ) {

		readyList = jQuery.Deferred();

		// Catch cases where $(document).ready() is called after the browser event has already occurred.
		// we once tried to use readyState "interactive" here, but it caused issues like the one
		// discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
		if ( document.readyState === "complete" ) {
			// Handle it asynchronously to allow scripts the opportunity to delay ready
			setTimeout( jQuery.ready, 1 );

		// Standards-based browsers support DOMContentLoaded
		} else if ( document.addEventListener ) {
			// Use the handy event callback
			document.addEventListener( "DOMContentLoaded", DOMContentLoaded, false );

			// A fallback to window.onload, that will always work
			window.addEventListener( "load", jQuery.ready, false );

		// If IE event model is used
		} else {
			// Ensure firing before onload, maybe late but safe also for iframes
			document.attachEvent( "onreadystatechange", DOMContentLoaded );

			// A fallback to window.onload, that will always work
			window.attachEvent( "onload", jQuery.ready );

			// If IE and not a frame
			// continually check to see if the document is ready
			var top = false;

			try {
				top = window.frameElement == null && document.documentElement;
			} catch(e) {}

			if ( top && top.doScroll ) {
				(function doScrollCheck() {
					if ( !jQuery.isReady ) {

						try {
							// Use the trick by Diego Perini
							// http://javascript.nwbox.com/IEContentLoaded/
							top.doScroll("left");
						} catch(e) {
							return setTimeout( doScrollCheck, 50 );
						}

						// and execute any waiting functions
						jQuery.ready();
					}
				})();
			}
		}
	}
	return readyList.promise( obj );
};

// Populate the class2type map
jQuery.each("Boolean Number String Function Array Date RegExp Object".split(" "), function(i, name) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
});

// All jQuery objects should point back to these
rootjQuery = jQuery(document);
// String to Object options format cache
var optionsCache = {};

// Convert String-formatted options into Object-formatted ones and store in cache
function createOptions( options ) {
	var object = optionsCache[ options ] = {};
	jQuery.each( options.split( core_rspace ), function( _, flag ) {
		object[ flag ] = true;
	});
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		( optionsCache[ options ] || createOptions( options ) ) :
		jQuery.extend( {}, options );

	var // Last fire value (for non-forgettable lists)
		memory,
		// Flag to know if list was already fired
		fired,
		// Flag to know if list is currently firing
		firing,
		// First callback to fire (used internally by add and fireWith)
		firingStart,
		// End of the loop when firing
		firingLength,
		// Index of currently firing callback (modified by remove if needed)
		firingIndex,
		// Actual callback list
		list = [],
		// Stack of fire calls for repeatable lists
		stack = !options.once && [],
		// Fire callbacks
		fire = function( data ) {
			memory = options.memory && data;
			fired = true;
			firingIndex = firingStart || 0;
			firingStart = 0;
			firingLength = list.length;
			firing = true;
			for ( ; list && firingIndex < firingLength; firingIndex++ ) {
				if ( list[ firingIndex ].apply( data[ 0 ], data[ 1 ] ) === false && options.stopOnFalse ) {
					memory = false; // To prevent further calls using add
					break;
				}
			}
			firing = false;
			if ( list ) {
				if ( stack ) {
					if ( stack.length ) {
						fire( stack.shift() );
					}
				} else if ( memory ) {
					list = [];
				} else {
					self.disable();
				}
			}
		},
		// Actual Callbacks object
		self = {
			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {
					// First, we save the current length
					var start = list.length;
					(function add( args ) {
						jQuery.each( args, function( _, arg ) {
							var type = jQuery.type( arg );
							if ( type === "function" ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && type !== "string" ) {
								// Inspect recursively
								add( arg );
							}
						});
					})( arguments );
					// Do we need to add the callbacks to the
					// current firing batch?
					if ( firing ) {
						firingLength = list.length;
					// With memory, if we're not firing then
					// we should call right away
					} else if ( memory ) {
						firingStart = start;
						fire( memory );
					}
				}
				return this;
			},
			// Remove a callback from the list
			remove: function() {
				if ( list ) {
					jQuery.each( arguments, function( _, arg ) {
						var index;
						while( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
							list.splice( index, 1 );
							// Handle firing indexes
							if ( firing ) {
								if ( index <= firingLength ) {
									firingLength--;
								}
								if ( index <= firingIndex ) {
									firingIndex--;
								}
							}
						}
					});
				}
				return this;
			},
			// Control if a given callback is in the list
			has: function( fn ) {
				return jQuery.inArray( fn, list ) > -1;
			},
			// Remove all callbacks from the list
			empty: function() {
				list = [];
				return this;
			},
			// Have the list do nothing anymore
			disable: function() {
				list = stack = memory = undefined;
				return this;
			},
			// Is it disabled?
			disabled: function() {
				return !list;
			},
			// Lock the list in its current state
			lock: function() {
				stack = undefined;
				if ( !memory ) {
					self.disable();
				}
				return this;
			},
			// Is it locked?
			locked: function() {
				return !stack;
			},
			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				args = args || [];
				args = [ context, args.slice ? args.slice() : args ];
				if ( list && ( !fired || stack ) ) {
					if ( firing ) {
						stack.push( args );
					} else {
						fire( args );
					}
				}
				return this;
			},
			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},
			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};
jQuery.extend({

	Deferred: function( func ) {
		var tuples = [
				// action, add listener, listener list, final state
				[ "resolve", "done", jQuery.Callbacks("once memory"), "resolved" ],
				[ "reject", "fail", jQuery.Callbacks("once memory"), "rejected" ],
				[ "notify", "progress", jQuery.Callbacks("memory") ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				then: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;
					return jQuery.Deferred(function( newDefer ) {
						jQuery.each( tuples, function( i, tuple ) {
							var action = tuple[ 0 ],
								fn = fns[ i ];
							// deferred[ done | fail | progress ] for forwarding actions to newDefer
							deferred[ tuple[1] ]( jQuery.isFunction( fn ) ?
								function() {
									var returned = fn.apply( this, arguments );
									if ( returned && jQuery.isFunction( returned.promise ) ) {
										returned.promise()
											.done( newDefer.resolve )
											.fail( newDefer.reject )
											.progress( newDefer.notify );
									} else {
										newDefer[ action + "With" ]( this === deferred ? newDefer : this, [ returned ] );
									}
								} :
								newDefer[ action ]
							);
						});
						fns = null;
					}).promise();
				},
				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Keep pipe for back-compat
		promise.pipe = promise.then;

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 3 ];

			// promise[ done | fail | progress ] = list.add
			promise[ tuple[1] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(function() {
					// state = [ resolved | rejected ]
					state = stateString;

				// [ reject_list | resolve_list ].disable; progress_list.lock
				}, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
			}

			// deferred[ resolve | reject | notify ] = list.fire
			deferred[ tuple[0] ] = list.fire;
			deferred[ tuple[0] + "With" ] = list.fireWith;
		});

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( subordinate /* , ..., subordinateN */ ) {
		var i = 0,
			resolveValues = core_slice.call( arguments ),
			length = resolveValues.length,

			// the count of uncompleted subordinates
			remaining = length !== 1 || ( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

			// the master Deferred. If resolveValues consist of only a single Deferred, just use that.
			deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

			// Update function for both resolve and progress values
			updateFunc = function( i, contexts, values ) {
				return function( value ) {
					contexts[ i ] = this;
					values[ i ] = arguments.length > 1 ? core_slice.call( arguments ) : value;
					if( values === progressValues ) {
						deferred.notifyWith( contexts, values );
					} else if ( !( --remaining ) ) {
						deferred.resolveWith( contexts, values );
					}
				};
			},

			progressValues, progressContexts, resolveContexts;

		// add listeners to Deferred subordinates; treat others as resolved
		if ( length > 1 ) {
			progressValues = new Array( length );
			progressContexts = new Array( length );
			resolveContexts = new Array( length );
			for ( ; i < length; i++ ) {
				if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
					resolveValues[ i ].promise()
						.done( updateFunc( i, resolveContexts, resolveValues ) )
						.fail( deferred.reject )
						.progress( updateFunc( i, progressContexts, progressValues ) );
				} else {
					--remaining;
				}
			}
		}

		// if we're not waiting on anything, resolve the master
		if ( !remaining ) {
			deferred.resolveWith( resolveContexts, resolveValues );
		}

		return deferred.promise();
	}
});
jQuery.support = (function() {

	var support,
		all,
		a,
		select,
		opt,
		input,
		fragment,
		eventName,
		i,
		isSupported,
		clickFn,
		div = document.createElement("div");

	// Setup
	div.setAttribute( "className", "t" );
	div.innerHTML = "  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>";

	// Support tests won't run in some limited or non-browser environments
	all = div.getElementsByTagName("*");
	a = div.getElementsByTagName("a")[ 0 ];
	if ( !all || !a || !all.length ) {
		return {};
	}

	// First batch of tests
	select = document.createElement("select");
	opt = select.appendChild( document.createElement("option") );
	input = div.getElementsByTagName("input")[ 0 ];

	a.style.cssText = "top:1px;float:left;opacity:.5";
	support = {
		// IE strips leading whitespace when .innerHTML is used
		leadingWhitespace: ( div.firstChild.nodeType === 3 ),

		// Make sure that tbody elements aren't automatically inserted
		// IE will insert them into empty tables
		tbody: !div.getElementsByTagName("tbody").length,

		// Make sure that link elements get serialized correctly by innerHTML
		// This requires a wrapper element in IE
		htmlSerialize: !!div.getElementsByTagName("link").length,

		// Get the style information from getAttribute
		// (IE uses .cssText instead)
		style: /top/.test( a.getAttribute("style") ),

		// Make sure that URLs aren't manipulated
		// (IE normalizes it by default)
		hrefNormalized: ( a.getAttribute("href") === "/a" ),

		// Make sure that element opacity exists
		// (IE uses filter instead)
		// Use a regex to work around a WebKit issue. See #5145
		opacity: /^0.5/.test( a.style.opacity ),

		// Verify style float existence
		// (IE uses styleFloat instead of cssFloat)
		cssFloat: !!a.style.cssFloat,

		// Make sure that if no value is specified for a checkbox
		// that it defaults to "on".
		// (WebKit defaults to "" instead)
		checkOn: ( input.value === "on" ),

		// Make sure that a selected-by-default option has a working selected property.
		// (WebKit defaults to false instead of true, IE too, if it's in an optgroup)
		optSelected: opt.selected,

		// Test setAttribute on camelCase class. If it works, we need attrFixes when doing get/setAttribute (ie6/7)
		getSetAttribute: div.className !== "t",

		// Tests for enctype support on a form (#6743)
		enctype: !!document.createElement("form").enctype,

		// Makes sure cloning an html5 element does not cause problems
		// Where outerHTML is undefined, this still works
		html5Clone: document.createElement("nav").cloneNode( true ).outerHTML !== "<:nav></:nav>",

		// jQuery.support.boxModel DEPRECATED in 1.8 since we don't support Quirks Mode
		boxModel: ( document.compatMode === "CSS1Compat" ),

		// Will be defined later
		submitBubbles: true,
		changeBubbles: true,
		focusinBubbles: false,
		deleteExpando: true,
		noCloneEvent: true,
		inlineBlockNeedsLayout: false,
		shrinkWrapBlocks: false,
		reliableMarginRight: true,
		boxSizingReliable: true,
		pixelPosition: false
	};

	// Make sure checked status is properly cloned
	input.checked = true;
	support.noCloneChecked = input.cloneNode( true ).checked;

	// Make sure that the options inside disabled selects aren't marked as disabled
	// (WebKit marks them as disabled)
	select.disabled = true;
	support.optDisabled = !opt.disabled;

	// Test to see if it's possible to delete an expando from an element
	// Fails in Internet Explorer
	try {
		delete div.test;
	} catch( e ) {
		support.deleteExpando = false;
	}

	if ( !div.addEventListener && div.attachEvent && div.fireEvent ) {
		div.attachEvent( "onclick", clickFn = function() {
			// Cloning a node shouldn't copy over any
			// bound event handlers (IE does this)
			support.noCloneEvent = false;
		});
		div.cloneNode( true ).fireEvent("onclick");
		div.detachEvent( "onclick", clickFn );
	}

	// Check if a radio maintains its value
	// after being appended to the DOM
	input = document.createElement("input");
	input.value = "t";
	input.setAttribute( "type", "radio" );
	support.radioValue = input.value === "t";

	input.setAttribute( "checked", "checked" );

	// #11217 - WebKit loses check when the name is after the checked attribute
	input.setAttribute( "name", "t" );

	div.appendChild( input );
	fragment = document.createDocumentFragment();
	fragment.appendChild( div.lastChild );

	// WebKit doesn't clone checked state correctly in fragments
	support.checkClone = fragment.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Check if a disconnected checkbox will retain its checked
	// value of true after appended to the DOM (IE6/7)
	support.appendChecked = input.checked;

	fragment.removeChild( input );
	fragment.appendChild( div );

	// Technique from Juriy Zaytsev
	// http://perfectionkills.com/detecting-event-support-without-browser-sniffing/
	// We only care about the case where non-standard event systems
	// are used, namely in IE. Short-circuiting here helps us to
	// avoid an eval call (in setAttribute) which can cause CSP
	// to go haywire. See: https://developer.mozilla.org/en/Security/CSP
	if ( div.attachEvent ) {
		for ( i in {
			submit: true,
			change: true,
			focusin: true
		}) {
			eventName = "on" + i;
			isSupported = ( eventName in div );
			if ( !isSupported ) {
				div.setAttribute( eventName, "return;" );
				isSupported = ( typeof div[ eventName ] === "function" );
			}
			support[ i + "Bubbles" ] = isSupported;
		}
	}

	// Run tests that need a body at doc ready
	jQuery(function() {
		var container, div, tds, marginDiv,
			divReset = "padding:0;margin:0;border:0;display:block;overflow:hidden;",
			body = document.getElementsByTagName("body")[0];

		if ( !body ) {
			// Return for frameset docs that don't have a body
			return;
		}

		container = document.createElement("div");
		container.style.cssText = "visibility:hidden;border:0;width:0;height:0;position:static;top:0;margin-top:1px";
		body.insertBefore( container, body.firstChild );

		// Construct the test element
		div = document.createElement("div");
		container.appendChild( div );

		// Check if table cells still have offsetWidth/Height when they are set
		// to display:none and there are still other visible table cells in a
		// table row; if so, offsetWidth/Height are not reliable for use when
		// determining if an element has been hidden directly using
		// display:none (it is still safe to use offsets if a parent element is
		// hidden; don safety goggles and see bug #4512 for more information).
		// (only IE 8 fails this test)
		div.innerHTML = "<table><tr><td></td><td>t</td></tr></table>";
		tds = div.getElementsByTagName("td");
		tds[ 0 ].style.cssText = "padding:0;margin:0;border:0;display:none";
		isSupported = ( tds[ 0 ].offsetHeight === 0 );

		tds[ 0 ].style.display = "";
		tds[ 1 ].style.display = "none";

		// Check if empty table cells still have offsetWidth/Height
		// (IE <= 8 fail this test)
		support.reliableHiddenOffsets = isSupported && ( tds[ 0 ].offsetHeight === 0 );

		// Check box-sizing and margin behavior
		div.innerHTML = "";
		div.style.cssText = "box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%;";
		support.boxSizing = ( div.offsetWidth === 4 );
		support.doesNotIncludeMarginInBodyOffset = ( body.offsetTop !== 1 );

		// NOTE: To any future maintainer, we've window.getComputedStyle
		// because jsdom on node.js will break without it.
		if ( window.getComputedStyle ) {
			support.pixelPosition = ( window.getComputedStyle( div, null ) || {} ).top !== "1%";
			support.boxSizingReliable = ( window.getComputedStyle( div, null ) || { width: "4px" } ).width === "4px";

			// Check if div with explicit width and no margin-right incorrectly
			// gets computed margin-right based on width of container. For more
			// info see bug #3333
			// Fails in WebKit before Feb 2011 nightlies
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			marginDiv = document.createElement("div");
			marginDiv.style.cssText = div.style.cssText = divReset;
			marginDiv.style.marginRight = marginDiv.style.width = "0";
			div.style.width = "1px";
			div.appendChild( marginDiv );
			support.reliableMarginRight =
				!parseFloat( ( window.getComputedStyle( marginDiv, null ) || {} ).marginRight );
		}

		if ( typeof div.style.zoom !== "undefined" ) {
			// Check if natively block-level elements act like inline-block
			// elements when setting their display to 'inline' and giving
			// them layout
			// (IE < 8 does this)
			div.innerHTML = "";
			div.style.cssText = divReset + "width:1px;padding:1px;display:inline;zoom:1";
			support.inlineBlockNeedsLayout = ( div.offsetWidth === 3 );

			// Check if elements with layout shrink-wrap their children
			// (IE 6 does this)
			div.style.display = "block";
			div.style.overflow = "visible";
			div.innerHTML = "<div></div>";
			div.firstChild.style.width = "5px";
			support.shrinkWrapBlocks = ( div.offsetWidth !== 3 );

			container.style.zoom = 1;
		}

		// Null elements to avoid leaks in IE
		body.removeChild( container );
		container = div = tds = marginDiv = null;
	});

	// Null elements to avoid leaks in IE
	fragment.removeChild( div );
	all = a = select = opt = input = fragment = div = null;

	return support;
})();
var rbrace = /(?:\{[\s\S]*\}|\[[\s\S]*\])$/,
	rmultiDash = /([A-Z])/g;

jQuery.extend({
	cache: {},

	deletedIds: [],

	// Remove at next major release (1.9/2.0)
	uuid: 0,

	// Unique for each copy of jQuery on the page
	// Non-digits removed to match rinlinejQuery
	expando: "jQuery" + ( jQuery.fn.jquery + Math.random() ).replace( /\D/g, "" ),

	// The following elements throw uncatchable exceptions if you
	// attempt to add expando properties to them.
	noData: {
		"embed": true,
		// Ban all objects except for Flash (which handle expandos)
		"object": "clsid:D27CDB6E-AE6D-11cf-96B8-444553540000",
		"applet": true
	},

	hasData: function( elem ) {
		elem = elem.nodeType ? jQuery.cache[ elem[jQuery.expando] ] : elem[ jQuery.expando ];
		return !!elem && !isEmptyDataObject( elem );
	},

	data: function( elem, name, data, pvt /* Internal Use Only */ ) {
		if ( !jQuery.acceptData( elem ) ) {
			return;
		}

		var thisCache, ret,
			internalKey = jQuery.expando,
			getByName = typeof name === "string",

			// We have to handle DOM nodes and JS objects differently because IE6-7
			// can't GC object references properly across the DOM-JS boundary
			isNode = elem.nodeType,

			// Only DOM nodes need the global jQuery cache; JS object data is
			// attached directly to the object so GC can occur automatically
			cache = isNode ? jQuery.cache : elem,

			// Only defining an ID for JS objects if its cache already exists allows
			// the code to shortcut on the same path as a DOM node with no cache
			id = isNode ? elem[ internalKey ] : elem[ internalKey ] && internalKey;

		// Avoid doing any more work than we need to when trying to get data on an
		// object that has no data at all
		if ( (!id || !cache[id] || (!pvt && !cache[id].data)) && getByName && data === undefined ) {
			return;
		}

		if ( !id ) {
			// Only DOM nodes need a new unique ID for each element since their data
			// ends up in the global cache
			if ( isNode ) {
				elem[ internalKey ] = id = jQuery.deletedIds.pop() || jQuery.guid++;
			} else {
				id = internalKey;
			}
		}

		if ( !cache[ id ] ) {
			cache[ id ] = {};

			// Avoids exposing jQuery metadata on plain JS objects when the object
			// is serialized using JSON.stringify
			if ( !isNode ) {
				cache[ id ].toJSON = jQuery.noop;
			}
		}

		// An object can be passed to jQuery.data instead of a key/value pair; this gets
		// shallow copied over onto the existing cache
		if ( typeof name === "object" || typeof name === "function" ) {
			if ( pvt ) {
				cache[ id ] = jQuery.extend( cache[ id ], name );
			} else {
				cache[ id ].data = jQuery.extend( cache[ id ].data, name );
			}
		}

		thisCache = cache[ id ];

		// jQuery data() is stored in a separate object inside the object's internal data
		// cache in order to avoid key collisions between internal data and user-defined
		// data.
		if ( !pvt ) {
			if ( !thisCache.data ) {
				thisCache.data = {};
			}

			thisCache = thisCache.data;
		}

		if ( data !== undefined ) {
			thisCache[ jQuery.camelCase( name ) ] = data;
		}

		// Check for both converted-to-camel and non-converted data property names
		// If a data property was specified
		if ( getByName ) {

			// First Try to find as-is property data
			ret = thisCache[ name ];

			// Test for null|undefined property data
			if ( ret == null ) {

				// Try to find the camelCased property
				ret = thisCache[ jQuery.camelCase( name ) ];
			}
		} else {
			ret = thisCache;
		}

		return ret;
	},

	removeData: function( elem, name, pvt /* Internal Use Only */ ) {
		if ( !jQuery.acceptData( elem ) ) {
			return;
		}

		var thisCache, i, l,

			isNode = elem.nodeType,

			// See jQuery.data for more information
			cache = isNode ? jQuery.cache : elem,
			id = isNode ? elem[ jQuery.expando ] : jQuery.expando;

		// If there is already no cache entry for this object, there is no
		// purpose in continuing
		if ( !cache[ id ] ) {
			return;
		}

		if ( name ) {

			thisCache = pvt ? cache[ id ] : cache[ id ].data;

			if ( thisCache ) {

				// Support array or space separated string names for data keys
				if ( !jQuery.isArray( name ) ) {

					// try the string as a key before any manipulation
					if ( name in thisCache ) {
						name = [ name ];
					} else {

						// split the camel cased version by spaces unless a key with the spaces exists
						name = jQuery.camelCase( name );
						if ( name in thisCache ) {
							name = [ name ];
						} else {
							name = name.split(" ");
						}
					}
				}

				for ( i = 0, l = name.length; i < l; i++ ) {
					delete thisCache[ name[i] ];
				}

				// If there is no data left in the cache, we want to continue
				// and let the cache object itself get destroyed
				if ( !( pvt ? isEmptyDataObject : jQuery.isEmptyObject )( thisCache ) ) {
					return;
				}
			}
		}

		// See jQuery.data for more information
		if ( !pvt ) {
			delete cache[ id ].data;

			// Don't destroy the parent cache unless the internal data object
			// had been the only thing left in it
			if ( !isEmptyDataObject( cache[ id ] ) ) {
				return;
			}
		}

		// Destroy the cache
		if ( isNode ) {
			jQuery.cleanData( [ elem ], true );

		// Use delete when supported for expandos or `cache` is not a window per isWindow (#10080)
		} else if ( jQuery.support.deleteExpando || cache != cache.window ) {
			delete cache[ id ];

		// When all else fails, null
		} else {
			cache[ id ] = null;
		}
	},

	// For internal use only.
	_data: function( elem, name, data ) {
		return jQuery.data( elem, name, data, true );
	},

	// A method for determining if a DOM node can handle the data expando
	acceptData: function( elem ) {
		var noData = elem.nodeName && jQuery.noData[ elem.nodeName.toLowerCase() ];

		// nodes accept data unless otherwise specified; rejection can be conditional
		return !noData || noData !== true && elem.getAttribute("classid") === noData;
	}
});

jQuery.fn.extend({
	data: function( key, value ) {
		var parts, part, attr, name, l,
			elem = this[0],
			i = 0,
			data = null;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = jQuery.data( elem );

				if ( elem.nodeType === 1 && !jQuery._data( elem, "parsedAttrs" ) ) {
					attr = elem.attributes;
					for ( l = attr.length; i < l; i++ ) {
						name = attr[i].name;

						if ( !name.indexOf( "data-" ) ) {
							name = jQuery.camelCase( name.substring(5) );

							dataAttr( elem, name, data[ name ] );
						}
					}
					jQuery._data( elem, "parsedAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each(function() {
				jQuery.data( this, key );
			});
		}

		parts = key.split( ".", 2 );
		parts[1] = parts[1] ? "." + parts[1] : "";
		part = parts[1] + "!";

		return jQuery.access( this, function( value ) {

			if ( value === undefined ) {
				data = this.triggerHandler( "getData" + part, [ parts[0] ] );

				// Try to fetch any internally stored data first
				if ( data === undefined && elem ) {
					data = jQuery.data( elem, key );
					data = dataAttr( elem, key, data );
				}

				return data === undefined && parts[1] ?
					this.data( parts[0] ) :
					data;
			}

			parts[1] = value;
			this.each(function() {
				var self = jQuery( this );

				self.triggerHandler( "setData" + part, parts );
				jQuery.data( this, key, value );
				self.triggerHandler( "changeData" + part, parts );
			});
		}, null, value, arguments.length > 1, null, false );
	},

	removeData: function( key ) {
		return this.each(function() {
			jQuery.removeData( this, key );
		});
	}
});

function dataAttr( elem, key, data ) {
	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {

		var name = "data-" + key.replace( rmultiDash, "-$1" ).toLowerCase();

		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = data === "true" ? true :
				data === "false" ? false :
				data === "null" ? null :
				// Only convert to a number if it doesn't change the string
				+data + "" === data ? +data :
				rbrace.test( data ) ? jQuery.parseJSON( data ) :
					data;
			} catch( e ) {}

			// Make sure we set the data so it isn't changed later
			jQuery.data( elem, key, data );

		} else {
			data = undefined;
		}
	}

	return data;
}

// checks a cache object for emptiness
function isEmptyDataObject( obj ) {
	var name;
	for ( name in obj ) {

		// if the public data object is empty, the private is still empty
		if ( name === "data" && jQuery.isEmptyObject( obj[name] ) ) {
			continue;
		}
		if ( name !== "toJSON" ) {
			return false;
		}
	}

	return true;
}
jQuery.extend({
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = jQuery._data( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || jQuery.isArray(data) ) {
					queue = jQuery._data( elem, type, jQuery.makeArray(data) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// not intended for public consumption - generates a queueHooks object, or returns the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return jQuery._data( elem, key ) || jQuery._data( elem, key, {
			empty: jQuery.Callbacks("once memory").add(function() {
				jQuery.removeData( elem, type + "queue", true );
				jQuery.removeData( elem, key, true );
			})
		});
	}
});

jQuery.fn.extend({
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[0], type );
		}

		return data === undefined ?
			this :
			this.each(function() {
				var queue = jQuery.queue( this, type, data );

				// ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[0] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			});
	},
	dequeue: function( type ) {
		return this.each(function() {
			jQuery.dequeue( this, type );
		});
	},
	// Based off of the plugin by Clint Helfers, with permission.
	// http://blindsignals.com/index.php/2009/07/jquery-delay/
	delay: function( time, type ) {
		time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
		type = type || "fx";

		return this.queue( type, function( next, hooks ) {
			var timeout = setTimeout( next, time );
			hooks.stop = function() {
				clearTimeout( timeout );
			};
		});
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},
	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while( i-- ) {
			tmp = jQuery._data( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
});
var nodeHook, boolHook, fixSpecified,
	rclass = /[\t\r\n]/g,
	rreturn = /\r/g,
	rtype = /^(?:button|input)$/i,
	rfocusable = /^(?:button|input|object|select|textarea)$/i,
	rclickable = /^a(?:rea|)$/i,
	rboolean = /^(?:autofocus|autoplay|async|checked|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped|selected)$/i,
	getSetAttribute = jQuery.support.getSetAttribute;

jQuery.fn.extend({
	attr: function( name, value ) {
		return jQuery.access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each(function() {
			jQuery.removeAttr( this, name );
		});
	},

	prop: function( name, value ) {
		return jQuery.access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		name = jQuery.propFix[ name ] || name;
		return this.each(function() {
			// try/catch handles cases where IE balks (such as removing a property on window)
			try {
				this[ name ] = undefined;
				delete this[ name ];
			} catch( e ) {}
		});
	},

	addClass: function( value ) {
		var classNames, i, l, elem,
			setClass, c, cl;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).addClass( value.call(this, j, this.className) );
			});
		}

		if ( value && typeof value === "string" ) {
			classNames = value.split( core_rspace );

			for ( i = 0, l = this.length; i < l; i++ ) {
				elem = this[ i ];

				if ( elem.nodeType === 1 ) {
					if ( !elem.className && classNames.length === 1 ) {
						elem.className = value;

					} else {
						setClass = " " + elem.className + " ";

						for ( c = 0, cl = classNames.length; c < cl; c++ ) {
							if ( setClass.indexOf( " " + classNames[ c ] + " " ) < 0 ) {
								setClass += classNames[ c ] + " ";
							}
						}
						elem.className = jQuery.trim( setClass );
					}
				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var removes, className, elem, c, cl, i, l;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).removeClass( value.call(this, j, this.className) );
			});
		}
		if ( (value && typeof value === "string") || value === undefined ) {
			removes = ( value || "" ).split( core_rspace );

			for ( i = 0, l = this.length; i < l; i++ ) {
				elem = this[ i ];
				if ( elem.nodeType === 1 && elem.className ) {

					className = (" " + elem.className + " ").replace( rclass, " " );

					// loop over each item in the removal list
					for ( c = 0, cl = removes.length; c < cl; c++ ) {
						// Remove until there is nothing to remove,
						while ( className.indexOf(" " + removes[ c ] + " ") >= 0 ) {
							className = className.replace( " " + removes[ c ] + " " , " " );
						}
					}
					elem.className = value ? jQuery.trim( className ) : "";
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value,
			isBool = typeof stateVal === "boolean";

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( i ) {
				jQuery( this ).toggleClass( value.call(this, i, this.className, stateVal), stateVal );
			});
		}

		return this.each(function() {
			if ( type === "string" ) {
				// toggle individual class names
				var className,
					i = 0,
					self = jQuery( this ),
					state = stateVal,
					classNames = value.split( core_rspace );

				while ( (className = classNames[ i++ ]) ) {
					// check each className given, space separated list
					state = isBool ? state : !self.hasClass( className );
					self[ state ? "addClass" : "removeClass" ]( className );
				}

			} else if ( type === "undefined" || type === "boolean" ) {
				if ( this.className ) {
					// store className if set
					jQuery._data( this, "__className__", this.className );
				}

				// toggle whole className
				this.className = this.className || value === false ? "" : jQuery._data( this, "__className__" ) || "";
			}
		});
	},

	hasClass: function( selector ) {
		var className = " " + selector + " ",
			i = 0,
			l = this.length;
		for ( ; i < l; i++ ) {
			if ( this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf( className ) >= 0 ) {
				return true;
			}
		}

		return false;
	},

	val: function( value ) {
		var hooks, ret, isFunction,
			elem = this[0];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] || jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks && "get" in hooks && (ret = hooks.get( elem, "value" )) !== undefined ) {
					return ret;
				}

				ret = elem.value;

				return typeof ret === "string" ?
					// handle most common string cases
					ret.replace(rreturn, "") :
					// handle cases where value is null/undef or number
					ret == null ? "" : ret;
			}

			return;
		}

		isFunction = jQuery.isFunction( value );

		return this.each(function( i ) {
			var val,
				self = jQuery(this);

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( isFunction ) {
				val = value.call( this, i, self.val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";
			} else if ( typeof val === "number" ) {
				val += "";
			} else if ( jQuery.isArray( val ) ) {
				val = jQuery.map(val, function ( value ) {
					return value == null ? "" : value + "";
				});
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !("set" in hooks) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		});
	}
});

jQuery.extend({
	valHooks: {
		option: {
			get: function( elem ) {
				// attributes.value is undefined in Blackberry 4.7 but
				// uses .value. See #6932
				var val = elem.attributes.value;
				return !val || val.specified ? elem.value : elem.text;
			}
		},
		select: {
			get: function( elem ) {
				var value, option,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one" || index < 0,
					values = one ? null : [],
					max = one ? index + 1 : options.length,
					i = index < 0 ?
						max :
						one ? index : 0;

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// oldIE doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&
							// Don't return options that are disabled or in a disabled optgroup
							( jQuery.support.optDisabled ? !option.disabled : option.getAttribute("disabled") === null ) &&
							( !option.parentNode.disabled || !jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var values = jQuery.makeArray( value );

				jQuery(elem).find("option").each(function() {
					this.selected = jQuery.inArray( jQuery(this).val(), values ) >= 0;
				});

				if ( !values.length ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	},

	// Unused in 1.8, left in so attrFn-stabbers won't die; remove in 1.9
	attrFn: {},

	attr: function( elem, name, value, pass ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set attributes on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		if ( pass && jQuery.isFunction( jQuery.fn[ name ] ) ) {
			return jQuery( elem )[ name ]( value );
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === "undefined" ) {
			return jQuery.prop( elem, name, value );
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		// All attributes are lowercase
		// Grab necessary hook if one is defined
		if ( notxml ) {
			name = name.toLowerCase();
			hooks = jQuery.attrHooks[ name ] || ( rboolean.test( name ) ? boolHook : nodeHook );
		}

		if ( value !== undefined ) {

			if ( value === null ) {
				jQuery.removeAttr( elem, name );
				return;

			} else if ( hooks && "set" in hooks && notxml && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				elem.setAttribute( name, value + "" );
				return value;
			}

		} else if ( hooks && "get" in hooks && notxml && (ret = hooks.get( elem, name )) !== null ) {
			return ret;

		} else {

			ret = elem.getAttribute( name );

			// Non-existent attributes return null, we normalize to undefined
			return ret === null ?
				undefined :
				ret;
		}
	},

	removeAttr: function( elem, value ) {
		var propName, attrNames, name, isBool,
			i = 0;

		if ( value && elem.nodeType === 1 ) {

			attrNames = value.split( core_rspace );

			for ( ; i < attrNames.length; i++ ) {
				name = attrNames[ i ];

				if ( name ) {
					propName = jQuery.propFix[ name ] || name;
					isBool = rboolean.test( name );

					// See #9699 for explanation of this approach (setting first, then removal)
					// Do not do this for boolean attributes (see #10870)
					if ( !isBool ) {
						jQuery.attr( elem, name, "" );
					}
					elem.removeAttribute( getSetAttribute ? name : propName );

					// Set corresponding property to false for boolean attributes
					if ( isBool && propName in elem ) {
						elem[ propName ] = false;
					}
				}
			}
		}
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				// We can't allow the type property to be changed (since it causes problems in IE)
				if ( rtype.test( elem.nodeName ) && elem.parentNode ) {
					jQuery.error( "type property can't be changed" );
				} else if ( !jQuery.support.radioValue && value === "radio" && jQuery.nodeName(elem, "input") ) {
					// Setting the type on a radio button after the value resets the value in IE6-9
					// Reset value to it's default in case type is set after value
					// This is for element creation
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		},
		// Use the value property for back compat
		// Use the nodeHook for button elements in IE6/7 (#1954)
		value: {
			get: function( elem, name ) {
				if ( nodeHook && jQuery.nodeName( elem, "button" ) ) {
					return nodeHook.get( elem, name );
				}
				return name in elem ?
					elem.value :
					null;
			},
			set: function( elem, value, name ) {
				if ( nodeHook && jQuery.nodeName( elem, "button" ) ) {
					return nodeHook.set( elem, value, name );
				}
				// Does not return so that setAttribute is also used
				elem.value = value;
			}
		}
	},

	propFix: {
		tabindex: "tabIndex",
		readonly: "readOnly",
		"for": "htmlFor",
		"class": "className",
		maxlength: "maxLength",
		cellspacing: "cellSpacing",
		cellpadding: "cellPadding",
		rowspan: "rowSpan",
		colspan: "colSpan",
		usemap: "useMap",
		frameborder: "frameBorder",
		contenteditable: "contentEditable"
	},

	prop: function( elem, name, value ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set properties on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		if ( notxml ) {
			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			if ( hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				return ( elem[ name ] = value );
			}

		} else {
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
				return ret;

			} else {
				return elem[ name ];
			}
		}
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {
				// elem.tabIndex doesn't always return the correct value when it hasn't been explicitly set
				// http://fluidproject.org/blog/2008/01/09/getting-setting-and-removing-tabindex-values-with-javascript/
				var attributeNode = elem.getAttributeNode("tabindex");

				return attributeNode && attributeNode.specified ?
					parseInt( attributeNode.value, 10 ) :
					rfocusable.test( elem.nodeName ) || rclickable.test( elem.nodeName ) && elem.href ?
						0 :
						undefined;
			}
		}
	}
});

// Hook for boolean attributes
boolHook = {
	get: function( elem, name ) {
		// Align boolean attributes with corresponding properties
		// Fall back to attribute presence where some booleans are not supported
		var attrNode,
			property = jQuery.prop( elem, name );
		return property === true || typeof property !== "boolean" && ( attrNode = elem.getAttributeNode(name) ) && attrNode.nodeValue !== false ?
			name.toLowerCase() :
			undefined;
	},
	set: function( elem, value, name ) {
		var propName;
		if ( value === false ) {
			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else {
			// value is true since we know at this point it's type boolean and not false
			// Set boolean attributes to the same name and set the DOM property
			propName = jQuery.propFix[ name ] || name;
			if ( propName in elem ) {
				// Only set the IDL specifically if it already exists on the element
				elem[ propName ] = true;
			}

			elem.setAttribute( name, name.toLowerCase() );
		}
		return name;
	}
};

// IE6/7 do not support getting/setting some attributes with get/setAttribute
if ( !getSetAttribute ) {

	fixSpecified = {
		name: true,
		id: true,
		coords: true
	};

	// Use this for any attribute in IE6/7
	// This fixes almost every IE6/7 issue
	nodeHook = jQuery.valHooks.button = {
		get: function( elem, name ) {
			var ret;
			ret = elem.getAttributeNode( name );
			return ret && ( fixSpecified[ name ] ? ret.value !== "" : ret.specified ) ?
				ret.value :
				undefined;
		},
		set: function( elem, value, name ) {
			// Set the existing or create a new attribute node
			var ret = elem.getAttributeNode( name );
			if ( !ret ) {
				ret = document.createAttribute( name );
				elem.setAttributeNode( ret );
			}
			return ( ret.value = value + "" );
		}
	};

	// Set width and height to auto instead of 0 on empty string( Bug #8150 )
	// This is for removals
	jQuery.each([ "width", "height" ], function( i, name ) {
		jQuery.attrHooks[ name ] = jQuery.extend( jQuery.attrHooks[ name ], {
			set: function( elem, value ) {
				if ( value === "" ) {
					elem.setAttribute( name, "auto" );
					return value;
				}
			}
		});
	});

	// Set contenteditable to false on removals(#10429)
	// Setting to empty string throws an error as an invalid value
	jQuery.attrHooks.contenteditable = {
		get: nodeHook.get,
		set: function( elem, value, name ) {
			if ( value === "" ) {
				value = "false";
			}
			nodeHook.set( elem, value, name );
		}
	};
}


// Some attributes require a special call on IE
if ( !jQuery.support.hrefNormalized ) {
	jQuery.each([ "href", "src", "width", "height" ], function( i, name ) {
		jQuery.attrHooks[ name ] = jQuery.extend( jQuery.attrHooks[ name ], {
			get: function( elem ) {
				var ret = elem.getAttribute( name, 2 );
				return ret === null ? undefined : ret;
			}
		});
	});
}

if ( !jQuery.support.style ) {
	jQuery.attrHooks.style = {
		get: function( elem ) {
			// Return undefined in the case of empty string
			// Normalize to lowercase since IE uppercases css property names
			return elem.style.cssText.toLowerCase() || undefined;
		},
		set: function( elem, value ) {
			return ( elem.style.cssText = value + "" );
		}
	};
}

// Safari mis-reports the default selected property of an option
// Accessing the parent's selectedIndex property fixes it
if ( !jQuery.support.optSelected ) {
	jQuery.propHooks.selected = jQuery.extend( jQuery.propHooks.selected, {
		get: function( elem ) {
			var parent = elem.parentNode;

			if ( parent ) {
				parent.selectedIndex;

				// Make sure that it also works with optgroups, see #5701
				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
			return null;
		}
	});
}

// IE6/7 call enctype encoding
if ( !jQuery.support.enctype ) {
	jQuery.propFix.enctype = "encoding";
}

// Radios and checkboxes getter/setter
if ( !jQuery.support.checkOn ) {
	jQuery.each([ "radio", "checkbox" ], function() {
		jQuery.valHooks[ this ] = {
			get: function( elem ) {
				// Handle the case where in Webkit "" is returned instead of "on" if a value isn't specified
				return elem.getAttribute("value") === null ? "on" : elem.value;
			}
		};
	});
}
jQuery.each([ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = jQuery.extend( jQuery.valHooks[ this ], {
		set: function( elem, value ) {
			if ( jQuery.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery(elem).val(), value ) >= 0 );
			}
		}
	});
});
var rformElems = /^(?:textarea|input|select)$/i,
	rtypenamespace = /^([^\.]*|)(?:\.(.+)|)$/,
	rhoverHack = /(?:^|\s)hover(\.\S+|)\b/,
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|contextmenu)|click/,
	rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	hoverHack = function( events ) {
		return jQuery.event.special.hover ? events : events.replace( rhoverHack, "mouseenter$1 mouseleave$1" );
	};

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	add: function( elem, types, handler, data, selector ) {

		var elemData, eventHandle, events,
			t, tns, type, namespaces, handleObj,
			handleObjIn, handlers, special;

		// Don't attach events to noData or text/comment nodes (allow plain objects tho)
		if ( elem.nodeType === 3 || elem.nodeType === 8 || !types || !handler || !(elemData = jQuery._data( elem )) ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		events = elemData.events;
		if ( !events ) {
			elemData.events = events = {};
		}
		eventHandle = elemData.handle;
		if ( !eventHandle ) {
			elemData.handle = eventHandle = function( e ) {
				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== "undefined" && (!e || jQuery.event.triggered !== e.type) ?
					jQuery.event.dispatch.apply( eventHandle.elem, arguments ) :
					undefined;
			};
			// Add elem as a property of the handle fn to prevent a memory leak with IE non-native events
			eventHandle.elem = elem;
		}

		// Handle multiple events separated by a space
		// jQuery(...).bind("mouseover mouseout", fn);
		types = jQuery.trim( hoverHack(types) ).split( " " );
		for ( t = 0; t < types.length; t++ ) {

			tns = rtypenamespace.exec( types[t] ) || [];
			type = tns[1];
			namespaces = ( tns[2] || "" ).split( "." ).sort();

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend({
				type: type,
				origType: tns[1],
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join(".")
			}, handleObjIn );

			// Init the event handler queue if we're the first
			handlers = events[ type ];
			if ( !handlers ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener/attachEvent if the special events handler returns false
				if ( !special.setup || special.setup.call( elem, data, namespaces, eventHandle ) === false ) {
					// Bind the global event handler to the element
					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle, false );

					} else if ( elem.attachEvent ) {
						elem.attachEvent( "on" + type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

		// Nullify elem to prevent memory leaks in IE
		elem = null;
	},

	global: {},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {

		var t, tns, type, origType, namespaces, origCount,
			j, events, special, eventType, handleObj,
			elemData = jQuery.hasData( elem ) && jQuery._data( elem );

		if ( !elemData || !(events = elemData.events) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = jQuery.trim( hoverHack( types || "" ) ).split(" ");
		for ( t = 0; t < types.length; t++ ) {
			tns = rtypenamespace.exec( types[t] ) || [];
			type = origType = tns[1];
			namespaces = tns[2];

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector? special.delegateType : special.bindType ) || type;
			eventType = events[ type ] || [];
			origCount = eventType.length;
			namespaces = namespaces ? new RegExp("(^|\\.)" + namespaces.split(".").sort().join("\\.(?:.*\\.|)") + "(\\.|$)") : null;

			// Remove matching events
			for ( j = 0; j < eventType.length; j++ ) {
				handleObj = eventType[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					 ( !handler || handler.guid === handleObj.guid ) &&
					 ( !namespaces || namespaces.test( handleObj.namespace ) ) &&
					 ( !selector || selector === handleObj.selector || selector === "**" && handleObj.selector ) ) {
					eventType.splice( j--, 1 );

					if ( handleObj.selector ) {
						eventType.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( eventType.length === 0 && origCount !== eventType.length ) {
				if ( !special.teardown || special.teardown.call( elem, namespaces, elemData.handle ) === false ) {
					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			delete elemData.handle;

			// removeData also checks for emptiness and clears the expando if empty
			// so use it instead of delete
			jQuery.removeData( elem, "events", true );
		}
	},

	// Events that are safe to short-circuit if no handlers are attached.
	// Native DOM events should not be added, they may have inline handlers.
	customEvent: {
		"getData": true,
		"setData": true,
		"changeData": true
	},

	trigger: function( event, data, elem, onlyHandlers ) {
		// Don't do events on text and comment nodes
		if ( elem && (elem.nodeType === 3 || elem.nodeType === 8) ) {
			return;
		}

		// Event object or event type
		var cache, exclusive, i, cur, old, ontype, special, handle, eventPath, bubbleType,
			type = event.type || event,
			namespaces = [];

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf( "!" ) >= 0 ) {
			// Exclusive events trigger only for the exact event (no namespaces)
			type = type.slice(0, -1);
			exclusive = true;
		}

		if ( type.indexOf( "." ) >= 0 ) {
			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split(".");
			type = namespaces.shift();
			namespaces.sort();
		}

		if ( (!elem || jQuery.event.customEvent[ type ]) && !jQuery.event.global[ type ] ) {
			// No jQuery handlers for this event type, and it can't have inline handlers
			return;
		}

		// Caller can pass in an Event, Object, or just an event type string
		event = typeof event === "object" ?
			// jQuery.Event object
			event[ jQuery.expando ] ? event :
			// Object literal
			new jQuery.Event( type, event ) :
			// Just the event type (string)
			new jQuery.Event( type );

		event.type = type;
		event.isTrigger = true;
		event.exclusive = exclusive;
		event.namespace = namespaces.join( "." );
		event.namespace_re = event.namespace? new RegExp("(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)") : null;
		ontype = type.indexOf( ":" ) < 0 ? "on" + type : "";

		// Handle a global trigger
		if ( !elem ) {

			// TODO: Stop taunting the data cache; remove global events and always attach to document
			cache = jQuery.cache;
			for ( i in cache ) {
				if ( cache[ i ].events && cache[ i ].events[ type ] ) {
					jQuery.event.trigger( event, data, cache[ i ].handle.elem, true );
				}
			}
			return;
		}

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data != null ? jQuery.makeArray( data ) : [];
		data.unshift( event );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		eventPath = [[ elem, special.bindType || type ]];
		if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			cur = rfocusMorph.test( bubbleType + type ) ? elem : elem.parentNode;
			for ( old = elem; cur; cur = cur.parentNode ) {
				eventPath.push([ cur, bubbleType ]);
				old = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( old === (elem.ownerDocument || document) ) {
				eventPath.push([ old.defaultView || old.parentWindow || window, bubbleType ]);
			}
		}

		// Fire handlers on the event path
		for ( i = 0; i < eventPath.length && !event.isPropagationStopped(); i++ ) {

			cur = eventPath[i][0];
			event.type = eventPath[i][1];

			handle = ( jQuery._data( cur, "events" ) || {} )[ event.type ] && jQuery._data( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}
			// Note that this is a bare JS function and not a jQuery handler
			handle = ontype && cur[ ontype ];
			if ( handle && jQuery.acceptData( cur ) && handle.apply && handle.apply( cur, data ) === false ) {
				event.preventDefault();
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( (!special._default || special._default.apply( elem.ownerDocument, data ) === false) &&
				!(type === "click" && jQuery.nodeName( elem, "a" )) && jQuery.acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name name as the event.
				// Can't use an .isFunction() check here because IE6/7 fails that test.
				// Don't do default actions on window, that's where global variables be (#6170)
				// IE<9 dies on focus/blur to hidden element (#1486)
				if ( ontype && elem[ type ] && ((type !== "focus" && type !== "blur") || event.target.offsetWidth !== 0) && !jQuery.isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					old = elem[ ontype ];

					if ( old ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;
					elem[ type ]();
					jQuery.event.triggered = undefined;

					if ( old ) {
						elem[ ontype ] = old;
					}
				}
			}
		}

		return event.result;
	},

	dispatch: function( event ) {

		// Make a writable jQuery.Event from the native event object
		event = jQuery.event.fix( event || window.event );

		var i, j, cur, ret, selMatch, matched, matches, handleObj, sel, related,
			handlers = ( (jQuery._data( this, "events" ) || {} )[ event.type ] || []),
			delegateCount = handlers.delegateCount,
			args = core_slice.call( arguments ),
			run_all = !event.exclusive && !event.namespace,
			special = jQuery.event.special[ event.type ] || {},
			handlerQueue = [];

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[0] = event;
		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers that should run if there are delegated events
		// Avoid non-left-click bubbling in Firefox (#3861)
		if ( delegateCount && !(event.button && event.type === "click") ) {

			for ( cur = event.target; cur != this; cur = cur.parentNode || this ) {

				// Don't process clicks (ONLY) on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.disabled !== true || event.type !== "click" ) {
					selMatch = {};
					matches = [];
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];
						sel = handleObj.selector;

						if ( selMatch[ sel ] === undefined ) {
							selMatch[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) >= 0 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( selMatch[ sel ] ) {
							matches.push( handleObj );
						}
					}
					if ( matches.length ) {
						handlerQueue.push({ elem: cur, matches: matches });
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		if ( handlers.length > delegateCount ) {
			handlerQueue.push({ elem: this, matches: handlers.slice( delegateCount ) });
		}

		// Run delegates first; they may want to stop propagation beneath us
		for ( i = 0; i < handlerQueue.length && !event.isPropagationStopped(); i++ ) {
			matched = handlerQueue[ i ];
			event.currentTarget = matched.elem;

			for ( j = 0; j < matched.matches.length && !event.isImmediatePropagationStopped(); j++ ) {
				handleObj = matched.matches[ j ];

				// Triggered event must either 1) be non-exclusive and have no namespace, or
				// 2) have namespace(s) a subset or equal to those in the bound event (both can have no namespace).
				if ( run_all || (!event.namespace && !handleObj.namespace) || event.namespace_re && event.namespace_re.test( handleObj.namespace ) ) {

					event.data = handleObj.data;
					event.handleObj = handleObj;

					ret = ( (jQuery.event.special[ handleObj.origType ] || {}).handle || handleObj.handler )
							.apply( matched.elem, args );

					if ( ret !== undefined ) {
						event.result = ret;
						if ( ret === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	// Includes some event props shared by KeyEvent and MouseEvent
	// *** attrChange attrName relatedNode srcElement  are not normalized, non-W3C, deprecated, will be removed in 1.8 ***
	props: "attrChange attrName relatedNode srcElement altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),

	fixHooks: {},

	keyHooks: {
		props: "char charCode key keyCode".split(" "),
		filter: function( event, original ) {

			// Add which for key events
			if ( event.which == null ) {
				event.which = original.charCode != null ? original.charCode : original.keyCode;
			}

			return event;
		}
	},

	mouseHooks: {
		props: "button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
		filter: function( event, original ) {
			var eventDoc, doc, body,
				button = original.button,
				fromElement = original.fromElement;

			// Calculate pageX/Y if missing and clientX/Y available
			if ( event.pageX == null && original.clientX != null ) {
				eventDoc = event.target.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				event.pageX = original.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && body.clientLeft || 0 );
				event.pageY = original.clientY + ( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) - ( doc && doc.clientTop  || body && body.clientTop  || 0 );
			}

			// Add relatedTarget, if necessary
			if ( !event.relatedTarget && fromElement ) {
				event.relatedTarget = fromElement === event.target ? original.toElement : fromElement;
			}

			// Add which for click: 1 === left; 2 === middle; 3 === right
			// Note: button is not normalized, so don't use it
			if ( !event.which && button !== undefined ) {
				event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
			}

			return event;
		}
	},

	fix: function( event ) {
		if ( event[ jQuery.expando ] ) {
			return event;
		}

		// Create a writable copy of the event object and normalize some properties
		var i, prop,
			originalEvent = event,
			fixHook = jQuery.event.fixHooks[ event.type ] || {},
			copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

		event = jQuery.Event( originalEvent );

		for ( i = copy.length; i; ) {
			prop = copy[ --i ];
			event[ prop ] = originalEvent[ prop ];
		}

		// Fix target property, if necessary (#1925, IE 6/7/8 & Safari2)
		if ( !event.target ) {
			event.target = originalEvent.srcElement || document;
		}

		// Target should not be a text node (#504, Safari)
		if ( event.target.nodeType === 3 ) {
			event.target = event.target.parentNode;
		}

		// For mouse/key events, metaKey==false if it's undefined (#3368, #11328; IE6/7/8)
		event.metaKey = !!event.metaKey;

		return fixHook.filter? fixHook.filter( event, originalEvent ) : event;
	},

	special: {
		load: {
			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},

		focus: {
			delegateType: "focusin"
		},
		blur: {
			delegateType: "focusout"
		},

		beforeunload: {
			setup: function( data, namespaces, eventHandle ) {
				// We only want to do this special case on windows
				if ( jQuery.isWindow( this ) ) {
					this.onbeforeunload = eventHandle;
				}
			},

			teardown: function( namespaces, eventHandle ) {
				if ( this.onbeforeunload === eventHandle ) {
					this.onbeforeunload = null;
				}
			}
		}
	},

	simulate: function( type, elem, event, bubble ) {
		// Piggyback on a donor event to simulate a different one.
		// Fake originalEvent to avoid donor's stopPropagation, but if the
		// simulated event prevents default then we do the same on the donor.
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{ type: type,
				isSimulated: true,
				originalEvent: {}
			}
		);
		if ( bubble ) {
			jQuery.event.trigger( e, null, elem );
		} else {
			jQuery.event.dispatch.call( elem, e );
		}
		if ( e.isDefaultPrevented() ) {
			event.preventDefault();
		}
	}
};

// Some plugins are using, but it's undocumented/deprecated and will be removed.
// The 1.7 special event interface should provide all the hooks needed now.
jQuery.event.handle = jQuery.event.dispatch;

jQuery.removeEvent = document.removeEventListener ?
	function( elem, type, handle ) {
		if ( elem.removeEventListener ) {
			elem.removeEventListener( type, handle, false );
		}
	} :
	function( elem, type, handle ) {
		var name = "on" + type;

		if ( elem.detachEvent ) {

			// #8545, #7054, preventing memory leaks for custom events in IE6-8
			// detachEvent needed property on element, by name of that event, to properly expose it to GC
			if ( typeof elem[ name ] === "undefined" ) {
				elem[ name ] = null;
			}

			elem.detachEvent( name, handle );
		}
	};

jQuery.Event = function( src, props ) {
	// Allow instantiation without the 'new' keyword
	if ( !(this instanceof jQuery.Event) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = ( src.defaultPrevented || src.returnValue === false ||
			src.getPreventDefault && src.getPreventDefault() ) ? returnTrue : returnFalse;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || jQuery.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

function returnFalse() {
	return false;
}
function returnTrue() {
	return true;
}

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	preventDefault: function() {
		this.isDefaultPrevented = returnTrue;

		var e = this.originalEvent;
		if ( !e ) {
			return;
		}

		// if preventDefault exists run it on the original event
		if ( e.preventDefault ) {
			e.preventDefault();

		// otherwise set the returnValue property of the original event to false (IE)
		} else {
			e.returnValue = false;
		}
	},
	stopPropagation: function() {
		this.isPropagationStopped = returnTrue;

		var e = this.originalEvent;
		if ( !e ) {
			return;
		}
		// if stopPropagation exists run it on the original event
		if ( e.stopPropagation ) {
			e.stopPropagation();
		}
		// otherwise set the cancelBubble property of the original event to true (IE)
		e.cancelBubble = true;
	},
	stopImmediatePropagation: function() {
		this.isImmediatePropagationStopped = returnTrue;
		this.stopPropagation();
	},
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse
};

// Create mouseenter/leave events using mouseover/out and event-time checks
jQuery.each({
	mouseenter: "mouseover",
	mouseleave: "mouseout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj,
				selector = handleObj.selector;

			// For mousenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || (related !== target && !jQuery.contains( target, related )) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
});

// IE submit delegation
if ( !jQuery.support.submitBubbles ) {

	jQuery.event.special.submit = {
		setup: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Lazy-add a submit handler when a descendant form may potentially be submitted
			jQuery.event.add( this, "click._submit keypress._submit", function( e ) {
				// Node name check avoids a VML-related crash in IE (#9807)
				var elem = e.target,
					form = jQuery.nodeName( elem, "input" ) || jQuery.nodeName( elem, "button" ) ? elem.form : undefined;
				if ( form && !jQuery._data( form, "_submit_attached" ) ) {
					jQuery.event.add( form, "submit._submit", function( event ) {
						event._submit_bubble = true;
					});
					jQuery._data( form, "_submit_attached", true );
				}
			});
			// return undefined since we don't need an event listener
		},

		postDispatch: function( event ) {
			// If form was submitted by the user, bubble the event up the tree
			if ( event._submit_bubble ) {
				delete event._submit_bubble;
				if ( this.parentNode && !event.isTrigger ) {
					jQuery.event.simulate( "submit", this.parentNode, event, true );
				}
			}
		},

		teardown: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Remove delegated handlers; cleanData eventually reaps submit handlers attached above
			jQuery.event.remove( this, "._submit" );
		}
	};
}

// IE change delegation and checkbox/radio fix
if ( !jQuery.support.changeBubbles ) {

	jQuery.event.special.change = {

		setup: function() {

			if ( rformElems.test( this.nodeName ) ) {
				// IE doesn't fire change on a check/radio until blur; trigger it on click
				// after a propertychange. Eat the blur-change in special.change.handle.
				// This still fires onchange a second time for check/radio after blur.
				if ( this.type === "checkbox" || this.type === "radio" ) {
					jQuery.event.add( this, "propertychange._change", function( event ) {
						if ( event.originalEvent.propertyName === "checked" ) {
							this._just_changed = true;
						}
					});
					jQuery.event.add( this, "click._change", function( event ) {
						if ( this._just_changed && !event.isTrigger ) {
							this._just_changed = false;
						}
						// Allow triggered, simulated change events (#11500)
						jQuery.event.simulate( "change", this, event, true );
					});
				}
				return false;
			}
			// Delegated event; lazy-add a change handler on descendant inputs
			jQuery.event.add( this, "beforeactivate._change", function( e ) {
				var elem = e.target;

				if ( rformElems.test( elem.nodeName ) && !jQuery._data( elem, "_change_attached" ) ) {
					jQuery.event.add( elem, "change._change", function( event ) {
						if ( this.parentNode && !event.isSimulated && !event.isTrigger ) {
							jQuery.event.simulate( "change", this.parentNode, event, true );
						}
					});
					jQuery._data( elem, "_change_attached", true );
				}
			});
		},

		handle: function( event ) {
			var elem = event.target;

			// Swallow native change events from checkbox/radio, we already triggered them above
			if ( this !== elem || event.isSimulated || event.isTrigger || (elem.type !== "radio" && elem.type !== "checkbox") ) {
				return event.handleObj.handler.apply( this, arguments );
			}
		},

		teardown: function() {
			jQuery.event.remove( this, "._change" );

			return !rformElems.test( this.nodeName );
		}
	};
}

// Create "bubbling" focus and blur events
if ( !jQuery.support.focusinBubbles ) {
	jQuery.each({ focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler while someone wants focusin/focusout
		var attaches = 0,
			handler = function( event ) {
				jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ), true );
			};

		jQuery.event.special[ fix ] = {
			setup: function() {
				if ( attaches++ === 0 ) {
					document.addEventListener( orig, handler, true );
				}
			},
			teardown: function() {
				if ( --attaches === 0 ) {
					document.removeEventListener( orig, handler, true );
				}
			}
		};
	});
}

jQuery.fn.extend({

	on: function( types, selector, data, fn, /*INTERNAL*/ one ) {
		var origFn, type;

		// Types can be a map of types/handlers
		if ( typeof types === "object" ) {
			// ( types-Object, selector, data )
			if ( typeof selector !== "string" ) { // && selector != null
				// ( types-Object, data )
				data = data || selector;
				selector = undefined;
			}
			for ( type in types ) {
				this.on( type, selector, data, types[ type ], one );
			}
			return this;
		}

		if ( data == null && fn == null ) {
			// ( types, fn )
			fn = selector;
			data = selector = undefined;
		} else if ( fn == null ) {
			if ( typeof selector === "string" ) {
				// ( types, selector, fn )
				fn = data;
				data = undefined;
			} else {
				// ( types, data, fn )
				fn = data;
				data = selector;
				selector = undefined;
			}
		}
		if ( fn === false ) {
			fn = returnFalse;
		} else if ( !fn ) {
			return this;
		}

		if ( one === 1 ) {
			origFn = fn;
			fn = function( event ) {
				// Can use an empty set, since event contains the info
				jQuery().off( event );
				return origFn.apply( this, arguments );
			};
			// Use same guid so caller can remove using origFn
			fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
		}
		return this.each( function() {
			jQuery.event.add( this, types, fn, data, selector );
		});
	},
	one: function( types, selector, data, fn ) {
		return this.on( types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {
			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {
			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {
			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each(function() {
			jQuery.event.remove( this, types, fn, selector );
		});
	},

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	live: function( types, data, fn ) {
		jQuery( this.context ).on( types, this.selector, data, fn );
		return this;
	},
	die: function( types, fn ) {
		jQuery( this.context ).off( types, this.selector || "**", fn );
		return this;
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {
		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ? this.off( selector, "**" ) : this.off( types, selector || "**", fn );
	},

	trigger: function( type, data ) {
		return this.each(function() {
			jQuery.event.trigger( type, data, this );
		});
	},
	triggerHandler: function( type, data ) {
		if ( this[0] ) {
			return jQuery.event.trigger( type, data, this[0], true );
		}
	},

	toggle: function( fn ) {
		// Save reference to arguments for access in closure
		var args = arguments,
			guid = fn.guid || jQuery.guid++,
			i = 0,
			toggler = function( event ) {
				// Figure out which function to execute
				var lastToggle = ( jQuery._data( this, "lastToggle" + fn.guid ) || 0 ) % i;
				jQuery._data( this, "lastToggle" + fn.guid, lastToggle + 1 );

				// Make sure that clicks stop
				event.preventDefault();

				// and execute the function
				return args[ lastToggle ].apply( this, arguments ) || false;
			};

		// link all the functions, so any of them can unbind this click handler
		toggler.guid = guid;
		while ( i < args.length ) {
			args[ i++ ].guid = guid;
		}

		return this.click( toggler );
	},

	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	}
});

jQuery.each( ("blur focus focusin focusout load resize scroll unload click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup error contextmenu").split(" "), function( i, name ) {

	// Handle event binding
	jQuery.fn[ name ] = function( data, fn ) {
		if ( fn == null ) {
			fn = data;
			data = null;
		}

		return arguments.length > 0 ?
			this.on( name, null, data, fn ) :
			this.trigger( name );
	};

	if ( rkeyEvent.test( name ) ) {
		jQuery.event.fixHooks[ name ] = jQuery.event.keyHooks;
	}

	if ( rmouseEvent.test( name ) ) {
		jQuery.event.fixHooks[ name ] = jQuery.event.mouseHooks;
	}
});
/*!
 * Sizzle CSS Selector Engine
 * Copyright 2012 jQuery Foundation and other contributors
 * Released under the MIT license
 * http://sizzlejs.com/
 */
(function( window, undefined ) {

var cachedruns,
	assertGetIdNotName,
	Expr,
	getText,
	isXML,
	contains,
	compile,
	sortOrder,
	hasDuplicate,
	outermostContext,

	baseHasDuplicate = true,
	strundefined = "undefined",

	expando = ( "sizcache" + Math.random() ).replace( ".", "" ),

	Token = String,
	document = window.document,
	docElem = document.documentElement,
	dirruns = 0,
	done = 0,
	pop = [].pop,
	push = [].push,
	slice = [].slice,
	// Use a stripped-down indexOf if a native one is unavailable
	indexOf = [].indexOf || function( elem ) {
		var i = 0,
			len = this.length;
		for ( ; i < len; i++ ) {
			if ( this[i] === elem ) {
				return i;
			}
		}
		return -1;
	},

	// Augment a function for special use by Sizzle
	markFunction = function( fn, value ) {
		fn[ expando ] = value == null || value;
		return fn;
	},

	createCache = function() {
		var cache = {},
			keys = [];

		return markFunction(function( key, value ) {
			// Only keep the most recent entries
			if ( keys.push( key ) > Expr.cacheLength ) {
				delete cache[ keys.shift() ];
			}

			// Retrieve with (key + " ") to avoid collision with native Object.prototype properties (see Issue #157)
			return (cache[ key + " " ] = value);
		}, cache );
	},

	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),

	// Regex

	// Whitespace characters http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",
	// http://www.w3.org/TR/css3-syntax/#characters
	characterEncoding = "(?:\\\\.|[-\\w]|[^\\x00-\\xa0])+",

	// Loosely modeled on CSS identifier characters
	// An unquoted value should be a CSS identifier (http://www.w3.org/TR/css3-selectors/#attribute-selectors)
	// Proper syntax: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
	identifier = characterEncoding.replace( "w", "w#" ),

	// Acceptable operators http://www.w3.org/TR/selectors/#attribute-selectors
	operators = "([*^$|!~]?=)",
	attributes = "\\[" + whitespace + "*(" + characterEncoding + ")" + whitespace +
		"*(?:" + operators + whitespace + "*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|(" + identifier + ")|)|)" + whitespace + "*\\]",

	// Prefer arguments not in parens/brackets,
	//   then attribute selectors and non-pseudos (denoted by :),
	//   then anything else
	// These preferences are here to reduce the number of selectors
	//   needing tokenize in the PSEUDO preFilter
	pseudos = ":(" + characterEncoding + ")(?:\\((?:(['\"])((?:\\\\.|[^\\\\])*?)\\2|([^()[\\]]*|(?:(?:" + attributes + ")|[^:]|\\\\.)*|.*))\\)|)",

	// For matchExpr.POS and matchExpr.needsContext
	pos = ":(even|odd|eq|gt|lt|nth|first|last)(?:\\(" + whitespace +
		"*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([\\x20\\t\\r\\n\\f>+~])" + whitespace + "*" ),
	rpseudo = new RegExp( pseudos ),

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w\-]+)|(\w+)|\.([\w\-]+))$/,

	rnot = /^:not/,
	rsibling = /[\x20\t\r\n\f]*[+~]/,
	rendsWithNot = /:not\($/,

	rheader = /h\d/i,
	rinputs = /input|select|textarea|button/i,

	rbackslash = /\\(?!\\)/g,

	matchExpr = {
		"ID": new RegExp( "^#(" + characterEncoding + ")" ),
		"CLASS": new RegExp( "^\\.(" + characterEncoding + ")" ),
		"NAME": new RegExp( "^\\[name=['\"]?(" + characterEncoding + ")['\"]?\\]" ),
		"TAG": new RegExp( "^(" + characterEncoding.replace( "w", "w*" ) + ")" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"POS": new RegExp( pos, "i" ),
		"CHILD": new RegExp( "^:(only|nth|first|last)-child(?:\\(" + whitespace +
			"*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
			"*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		// For use in libraries implementing .is()
		"needsContext": new RegExp( "^" + whitespace + "*[>+~]|" + pos, "i" )
	},

	// Support

	// Used for testing something on an element
	assert = function( fn ) {
		var div = document.createElement("div");

		try {
			return fn( div );
		} catch (e) {
			return false;
		} finally {
			// release memory in IE
			div = null;
		}
	},

	// Check if getElementsByTagName("*") returns only elements
	assertTagNameNoComments = assert(function( div ) {
		div.appendChild( document.createComment("") );
		return !div.getElementsByTagName("*").length;
	}),

	// Check if getAttribute returns normalized href attributes
	assertHrefNotNormalized = assert(function( div ) {
		div.innerHTML = "<a href='#'></a>";
		return div.firstChild && typeof div.firstChild.getAttribute !== strundefined &&
			div.firstChild.getAttribute("href") === "#";
	}),

	// Check if attributes should be retrieved by attribute nodes
	assertAttributes = assert(function( div ) {
		div.innerHTML = "<select></select>";
		var type = typeof div.lastChild.getAttribute("multiple");
		// IE8 returns a string for some attributes even when not present
		return type !== "boolean" && type !== "string";
	}),

	// Check if getElementsByClassName can be trusted
	assertUsableClassName = assert(function( div ) {
		// Opera can't find a second classname (in 9.6)
		div.innerHTML = "<div class='hidden e'></div><div class='hidden'></div>";
		if ( !div.getElementsByClassName || !div.getElementsByClassName("e").length ) {
			return false;
		}

		// Safari 3.2 caches class attributes and doesn't catch changes
		div.lastChild.className = "e";
		return div.getElementsByClassName("e").length === 2;
	}),

	// Check if getElementById returns elements by name
	// Check if getElementsByName privileges form controls or returns elements by ID
	assertUsableName = assert(function( div ) {
		// Inject content
		div.id = expando + 0;
		div.innerHTML = "<a name='" + expando + "'></a><div name='" + expando + "'></div>";
		docElem.insertBefore( div, docElem.firstChild );

		// Test
		var pass = document.getElementsByName &&
			// buggy browsers will return fewer than the correct 2
			document.getElementsByName( expando ).length === 2 +
			// buggy browsers will return more than the correct 0
			document.getElementsByName( expando + 0 ).length;
		assertGetIdNotName = !document.getElementById( expando );

		// Cleanup
		docElem.removeChild( div );

		return pass;
	});

// If slice is not available, provide a backup
try {
	slice.call( docElem.childNodes, 0 )[0].nodeType;
} catch ( e ) {
	slice = function( i ) {
		var elem,
			results = [];
		for ( ; (elem = this[i]); i++ ) {
			results.push( elem );
		}
		return results;
	};
}

function Sizzle( selector, context, results, seed ) {
	results = results || [];
	context = context || document;
	var match, elem, xml, m,
		nodeType = context.nodeType;

	if ( !selector || typeof selector !== "string" ) {
		return results;
	}

	if ( nodeType !== 1 && nodeType !== 9 ) {
		return [];
	}

	xml = isXML( context );

	if ( !xml && !seed ) {
		if ( (match = rquickExpr.exec( selector )) ) {
			// Speed-up: Sizzle("#ID")
			if ( (m = match[1]) ) {
				if ( nodeType === 9 ) {
					elem = context.getElementById( m );
					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE, Opera, and Webkit return items
						// by name instead of ID
						if ( elem.id === m ) {
							results.push( elem );
							return results;
						}
					} else {
						return results;
					}
				} else {
					// Context is not a document
					if ( context.ownerDocument && (elem = context.ownerDocument.getElementById( m )) &&
						contains( context, elem ) && elem.id === m ) {
						results.push( elem );
						return results;
					}
				}

			// Speed-up: Sizzle("TAG")
			} else if ( match[2] ) {
				push.apply( results, slice.call(context.getElementsByTagName( selector ), 0) );
				return results;

			// Speed-up: Sizzle(".CLASS")
			} else if ( (m = match[3]) && assertUsableClassName && context.getElementsByClassName ) {
				push.apply( results, slice.call(context.getElementsByClassName( m ), 0) );
				return results;
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed, xml );
}

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	return Sizzle( expr, null, null, [ elem ] ).length > 0;
};

// Returns a function to use in pseudos for input types
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

// Returns a function to use in pseudos for buttons
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return (name === "input" || name === "button") && elem.type === type;
	};
}

// Returns a function to use in pseudos for positionals
function createPositionalPseudo( fn ) {
	return markFunction(function( argument ) {
		argument = +argument;
		return markFunction(function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ (j = matchIndexes[i]) ] ) {
					seed[j] = !(matches[j] = seed[j]);
				}
			}
		});
	});
}

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( nodeType ) {
		if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
			// Use textContent for elements
			// innerText usage removed for consistency of new lines (see #11153)
			if ( typeof elem.textContent === "string" ) {
				return elem.textContent;
			} else {
				// Traverse its children
				for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
					ret += getText( elem );
				}
			}
		} else if ( nodeType === 3 || nodeType === 4 ) {
			return elem.nodeValue;
		}
		// Do not include comment or processing instruction nodes
	} else {

		// If no nodeType, this is expected to be an array
		for ( ; (node = elem[i]); i++ ) {
			// Do not traverse comment nodes
			ret += getText( node );
		}
	}
	return ret;
};

isXML = Sizzle.isXML = function( elem ) {
	// documentElement is verified for cases where it doesn't yet exist
	// (such as loading iframes in IE - #4833)
	var documentElement = elem && (elem.ownerDocument || elem).documentElement;
	return documentElement ? documentElement.nodeName !== "HTML" : false;
};

// Element contains another
contains = Sizzle.contains = docElem.contains ?
	function( a, b ) {
		var adown = a.nodeType === 9 ? a.documentElement : a,
			bup = b && b.parentNode;
		return a === bup || !!( bup && bup.nodeType === 1 && adown.contains && adown.contains(bup) );
	} :
	docElem.compareDocumentPosition ?
	function( a, b ) {
		return b && !!( a.compareDocumentPosition( b ) & 16 );
	} :
	function( a, b ) {
		while ( (b = b.parentNode) ) {
			if ( b === a ) {
				return true;
			}
		}
		return false;
	};

Sizzle.attr = function( elem, name ) {
	var val,
		xml = isXML( elem );

	if ( !xml ) {
		name = name.toLowerCase();
	}
	if ( (val = Expr.attrHandle[ name ]) ) {
		return val( elem );
	}
	if ( xml || assertAttributes ) {
		return elem.getAttribute( name );
	}
	val = elem.getAttributeNode( name );
	return val ?
		typeof elem[ name ] === "boolean" ?
			elem[ name ] ? name : null :
			val.specified ? val.value : null :
		null;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	// IE6/7 return a modified href
	attrHandle: assertHrefNotNormalized ?
		{} :
		{
			"href": function( elem ) {
				return elem.getAttribute( "href", 2 );
			},
			"type": function( elem ) {
				return elem.getAttribute("type");
			}
		},

	find: {
		"ID": assertGetIdNotName ?
			function( id, context, xml ) {
				if ( typeof context.getElementById !== strundefined && !xml ) {
					var m = context.getElementById( id );
					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					return m && m.parentNode ? [m] : [];
				}
			} :
			function( id, context, xml ) {
				if ( typeof context.getElementById !== strundefined && !xml ) {
					var m = context.getElementById( id );

					return m ?
						m.id === id || typeof m.getAttributeNode !== strundefined && m.getAttributeNode("id").value === id ?
							[m] :
							undefined :
						[];
				}
			},

		"TAG": assertTagNameNoComments ?
			function( tag, context ) {
				if ( typeof context.getElementsByTagName !== strundefined ) {
					return context.getElementsByTagName( tag );
				}
			} :
			function( tag, context ) {
				var results = context.getElementsByTagName( tag );

				// Filter out possible comments
				if ( tag === "*" ) {
					var elem,
						tmp = [],
						i = 0;

					for ( ; (elem = results[i]); i++ ) {
						if ( elem.nodeType === 1 ) {
							tmp.push( elem );
						}
					}

					return tmp;
				}
				return results;
			},

		"NAME": assertUsableName && function( tag, context ) {
			if ( typeof context.getElementsByName !== strundefined ) {
				return context.getElementsByName( name );
			}
		},

		"CLASS": assertUsableClassName && function( className, context, xml ) {
			if ( typeof context.getElementsByClassName !== strundefined && !xml ) {
				return context.getElementsByClassName( className );
			}
		}
	},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[1] = match[1].replace( rbackslash, "" );

			// Move the given value to match[3] whether quoted or unquoted
			match[3] = ( match[4] || match[5] || "" ).replace( rbackslash, "" );

			if ( match[2] === "~=" ) {
				match[3] = " " + match[3] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {
			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				3 xn-component of xn+y argument ([+-]?\d*n|)
				4 sign of xn-component
				5 x of xn-component
				6 sign of y-component
				7 y of y-component
			*/
			match[1] = match[1].toLowerCase();

			if ( match[1] === "nth" ) {
				// nth-child requires argument
				if ( !match[2] ) {
					Sizzle.error( match[0] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[3] = +( match[3] ? match[4] + (match[5] || 1) : 2 * ( match[2] === "even" || match[2] === "odd" ) );
				match[4] = +( ( match[6] + match[7] ) || match[2] === "odd" );

			// other types prohibit arguments
			} else if ( match[2] ) {
				Sizzle.error( match[0] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var unquoted, excess;
			if ( matchExpr["CHILD"].test( match[0] ) ) {
				return null;
			}

			if ( match[3] ) {
				match[2] = match[3];
			} else if ( (unquoted = match[4]) ) {
				// Only check arguments that contain a pseudo
				if ( rpseudo.test(unquoted) &&
					// Get excess from tokenize (recursively)
					(excess = tokenize( unquoted, true )) &&
					// advance to the next closing parenthesis
					(excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

					// excess is a negative index
					unquoted = unquoted.slice( 0, excess );
					match[0] = match[0].slice( 0, excess );
				}
				match[2] = unquoted;
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {
		"ID": assertGetIdNotName ?
			function( id ) {
				id = id.replace( rbackslash, "" );
				return function( elem ) {
					return elem.getAttribute("id") === id;
				};
			} :
			function( id ) {
				id = id.replace( rbackslash, "" );
				return function( elem ) {
					var node = typeof elem.getAttributeNode !== strundefined && elem.getAttributeNode("id");
					return node && node.value === id;
				};
			},

		"TAG": function( nodeName ) {
			if ( nodeName === "*" ) {
				return function() { return true; };
			}
			nodeName = nodeName.replace( rbackslash, "" ).toLowerCase();

			return function( elem ) {
				return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
			};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ expando ][ className + " " ];

			return pattern ||
				(pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
				classCache( className, function( elem ) {
					return pattern.test( elem.className || (typeof elem.getAttribute !== strundefined && elem.getAttribute("class")) || "" );
				});
		},

		"ATTR": function( name, operator, check ) {
			return function( elem, context ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.substr( result.length - check.length ) === check :
					operator === "~=" ? ( " " + result + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.substr( 0, check.length + 1 ) === check + "-" :
					false;
			};
		},

		"CHILD": function( type, argument, first, last ) {

			if ( type === "nth" ) {
				return function( elem ) {
					var node, diff,
						parent = elem.parentNode;

					if ( first === 1 && last === 0 ) {
						return true;
					}

					if ( parent ) {
						diff = 0;
						for ( node = parent.firstChild; node; node = node.nextSibling ) {
							if ( node.nodeType === 1 ) {
								diff++;
								if ( elem === node ) {
									break;
								}
							}
						}
					}

					// Incorporate the offset (or cast to NaN), then check against cycle size
					diff -= last;
					return diff === first || ( diff % first === 0 && diff / first >= 0 );
				};
			}

			return function( elem ) {
				var node = elem;

				switch ( type ) {
					case "only":
					case "first":
						while ( (node = node.previousSibling) ) {
							if ( node.nodeType === 1 ) {
								return false;
							}
						}

						if ( type === "first" ) {
							return true;
						}

						node = elem;

						/* falls through */
					case "last":
						while ( (node = node.nextSibling) ) {
							if ( node.nodeType === 1 ) {
								return false;
							}
						}

						return true;
				}
			};
		},

		"PSEUDO": function( pseudo, argument ) {
			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction(function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf.call( seed, matched[i] );
							seed[ idx ] = !( matches[ idx ] = matched[i] );
						}
					}) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {
		"not": markFunction(function( selector ) {
			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction(function( seed, matches, context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( (elem = unmatched[i]) ) {
							seed[i] = !(matches[i] = elem);
						}
					}
				}) :
				function( elem, context, xml ) {
					input[0] = elem;
					matcher( input, null, xml, results );
					return !results.pop();
				};
		}),

		"has": markFunction(function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		}),

		"contains": markFunction(function( text ) {
			return function( elem ) {
				return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
			};
		}),

		"enabled": function( elem ) {
			return elem.disabled === false;
		},

		"disabled": function( elem ) {
			return elem.disabled === true;
		},

		"checked": function( elem ) {
			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
		},

		"selected": function( elem ) {
			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos["empty"]( elem );
		},

		"empty": function( elem ) {
			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is only affected by element nodes and content nodes(including text(3), cdata(4)),
			//   not comment, processing instructions, or others
			// Thanks to Diego Perini for the nodeName shortcut
			//   Greater than "@" means alpha characters (specifically not starting with "#" or "?")
			var nodeType;
			elem = elem.firstChild;
			while ( elem ) {
				if ( elem.nodeName > "@" || (nodeType = elem.nodeType) === 3 || nodeType === 4 ) {
					return false;
				}
				elem = elem.nextSibling;
			}
			return true;
		},

		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"text": function( elem ) {
			var type, attr;
			// IE6 and 7 will map elem.type to 'text' for new HTML5 types (search, etc)
			// use getAttribute instead to test this case
			return elem.nodeName.toLowerCase() === "input" &&
				(type = elem.type) === "text" &&
				( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === type );
		},

		// Input types
		"radio": createInputPseudo("radio"),
		"checkbox": createInputPseudo("checkbox"),
		"file": createInputPseudo("file"),
		"password": createInputPseudo("password"),
		"image": createInputPseudo("image"),

		"submit": createButtonPseudo("submit"),
		"reset": createButtonPseudo("reset"),

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"focus": function( elem ) {
			var doc = elem.ownerDocument;
			return elem === doc.activeElement && (!doc.hasFocus || doc.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
		},

		"active": function( elem ) {
			return elem === elem.ownerDocument.activeElement;
		},

		// Positional types
		"first": createPositionalPseudo(function() {
			return [ 0 ];
		}),

		"last": createPositionalPseudo(function( matchIndexes, length ) {
			return [ length - 1 ];
		}),

		"eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		}),

		"even": createPositionalPseudo(function( matchIndexes, length ) {
			for ( var i = 0; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"odd": createPositionalPseudo(function( matchIndexes, length ) {
			for ( var i = 1; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			for ( var i = argument < 0 ? argument + length : argument; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			for ( var i = argument < 0 ? argument + length : argument; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		})
	}
};

function siblingCheck( a, b, ret ) {
	if ( a === b ) {
		return ret;
	}

	var cur = a.nextSibling;

	while ( cur ) {
		if ( cur === b ) {
			return -1;
		}

		cur = cur.nextSibling;
	}

	return 1;
}

sortOrder = docElem.compareDocumentPosition ?
	function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		return ( !a.compareDocumentPosition || !b.compareDocumentPosition ?
			a.compareDocumentPosition :
			a.compareDocumentPosition(b) & 4
		) ? -1 : 1;
	} :
	function( a, b ) {
		// The nodes are identical, we can exit early
		if ( a === b ) {
			hasDuplicate = true;
			return 0;

		// Fallback to using sourceIndex (in IE) if it's available on both nodes
		} else if ( a.sourceIndex && b.sourceIndex ) {
			return a.sourceIndex - b.sourceIndex;
		}

		var al, bl,
			ap = [],
			bp = [],
			aup = a.parentNode,
			bup = b.parentNode,
			cur = aup;

		// If the nodes are siblings (or identical) we can do a quick check
		if ( aup === bup ) {
			return siblingCheck( a, b );

		// If no parents were found then the nodes are disconnected
		} else if ( !aup ) {
			return -1;

		} else if ( !bup ) {
			return 1;
		}

		// Otherwise they're somewhere else in the tree so we need
		// to build up a full list of the parentNodes for comparison
		while ( cur ) {
			ap.unshift( cur );
			cur = cur.parentNode;
		}

		cur = bup;

		while ( cur ) {
			bp.unshift( cur );
			cur = cur.parentNode;
		}

		al = ap.length;
		bl = bp.length;

		// Start walking down the tree looking for a discrepancy
		for ( var i = 0; i < al && i < bl; i++ ) {
			if ( ap[i] !== bp[i] ) {
				return siblingCheck( ap[i], bp[i] );
			}
		}

		// We ended someplace up the tree so do a sibling check
		return i === al ?
			siblingCheck( a, bp[i], -1 ) :
			siblingCheck( ap[i], b, 1 );
	};

// Always assume the presence of duplicates if sort doesn't
// pass them to our comparison function (as in Google Chrome).
[0, 0].sort( sortOrder );
baseHasDuplicate = !hasDuplicate;

// Document sorting and removing duplicates
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		i = 1,
		j = 0;

	hasDuplicate = baseHasDuplicate;
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		for ( ; (elem = results[i]); i++ ) {
			if ( elem === results[ i - 1 ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	return results;
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

function tokenize( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ expando ][ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || (match = rcomma.exec( soFar )) ) {
			if ( match ) {
				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[0].length ) || soFar;
			}
			groups.push( tokens = [] );
		}

		matched = false;

		// Combinators
		if ( (match = rcombinators.exec( soFar )) ) {
			tokens.push( matched = new Token( match.shift() ) );
			soFar = soFar.slice( matched.length );

			// Cast descendant combinators to space
			matched.type = match[0].replace( rtrim, " " );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
				(match = preFilters[ type ]( match ))) ) {

				tokens.push( matched = new Token( match.shift() ) );
				soFar = soFar.slice( matched.length );
				matched.type = type;
				matched.matches = match;
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :
			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		checkNonElements = base && combinator.dir === "parentNode",
		doneName = done++;

	return combinator.first ?
		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( (elem = elem[ dir ]) ) {
				if ( checkNonElements || elem.nodeType === 1  ) {
					return matcher( elem, context, xml );
				}
			}
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			// We can't set arbitrary data on XML nodes, so they don't benefit from dir caching
			if ( !xml ) {
				var cache,
					dirkey = dirruns + " " + doneName + " ",
					cachedkey = dirkey + cachedruns;
				while ( (elem = elem[ dir ]) ) {
					if ( checkNonElements || elem.nodeType === 1 ) {
						if ( (cache = elem[ expando ]) === cachedkey ) {
							return elem.sizset;
						} else if ( typeof cache === "string" && cache.indexOf(dirkey) === 0 ) {
							if ( elem.sizset ) {
								return elem;
							}
						} else {
							elem[ expando ] = cachedkey;
							if ( matcher( elem, context, xml ) ) {
								elem.sizset = true;
								return elem;
							}
							elem.sizset = false;
						}
					}
				}
			} else {
				while ( (elem = elem[ dir ]) ) {
					if ( checkNonElements || elem.nodeType === 1 ) {
						if ( matcher( elem, context, xml ) ) {
							return elem;
						}
					}
				}
			}
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[i]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[0];
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( (elem = unmatched[i]) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction(function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?
				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( (elem = temp[i]) ) {
					matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {
					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( (elem = matcherOut[i]) ) {
							// Restore matcherIn since elem is not yet a final match
							temp.push( (matcherIn[i] = elem) );
						}
					}
					postFinder( null, (matcherOut = []), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( (elem = matcherOut[i]) &&
						(temp = postFinder ? indexOf.call( seed, elem ) : preMap[i]) > -1 ) {

						seed[temp] = !(results[temp] = elem);
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	});
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[0].type ],
		implicitRelative = leadingRelative || Expr.relative[" "],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf.call( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			return ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				(checkContext = context).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );
		} ];

	for ( ; i < len; i++ ) {
		if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
			matchers = [ addCombinator( elementMatcher( matchers ), matcher ) ];
		} else {
			matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {
				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[j].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && tokens.slice( 0, i - 1 ).join("").replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
					j < len && tokens.join("")
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	var bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, expandContext ) {
			var elem, j, matcher,
				setMatched = [],
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				outermost = expandContext != null,
				contextBackup = outermostContext,
				// We must always have either seed elements or context
				elems = seed || byElement && Expr.find["TAG"]( "*", expandContext && context.parentNode || context ),
				// Nested matchers should use non-integer dirruns
				dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.E);

			if ( outermost ) {
				outermostContext = context !== document && context;
				cachedruns = superMatcher.el;
			}

			// Add elements passing elementMatchers directly to results
			for ( ; (elem = elems[i]) != null; i++ ) {
				if ( byElement && elem ) {
					for ( j = 0; (matcher = elementMatchers[j]); j++ ) {
						if ( matcher( elem, context, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
						cachedruns = ++superMatcher.el;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {
					// They will have gone through all possible matchers
					if ( (elem = !matcher && elem) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// Apply set filters to unmatched elements
			matchedCount += i;
			if ( bySet && i !== matchedCount ) {
				for ( j = 0; (matcher = setMatchers[j]); j++ ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {
					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !(unmatched[i] || setMatched[i]) ) {
								setMatched[i] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	superMatcher.el = 0;
	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, group /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ expando ][ selector + " " ];

	if ( !cached ) {
		// Generate a function of recursive functions that can be used to check each element
		if ( !group ) {
			group = tokenize( selector );
		}
		i = group.length;
		while ( i-- ) {
			cached = matcherFromTokens( group[i] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );
	}
	return cached;
};

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[i], results );
	}
	return results;
}

function select( selector, context, results, seed, xml ) {
	var i, tokens, token, type, find,
		match = tokenize( selector ),
		j = match.length;

	if ( !seed ) {
		// Try to minimize operations if there is only one group
		if ( match.length === 1 ) {

			// Take a shortcut and set the context if the root selector is an ID
			tokens = match[0] = match[0].slice( 0 );
			if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
					context.nodeType === 9 && !xml &&
					Expr.relative[ tokens[1].type ] ) {

				context = Expr.find["ID"]( token.matches[0].replace( rbackslash, "" ), context, xml )[0];
				if ( !context ) {
					return results;
				}

				selector = selector.slice( tokens.shift().length );
			}

			// Fetch a seed set for right-to-left matching
			for ( i = matchExpr["POS"].test( selector ) ? -1 : tokens.length - 1; i >= 0; i-- ) {
				token = tokens[i];

				// Abort if we hit a combinator
				if ( Expr.relative[ (type = token.type) ] ) {
					break;
				}
				if ( (find = Expr.find[ type ]) ) {
					// Search, expanding context for leading sibling combinators
					if ( (seed = find(
						token.matches[0].replace( rbackslash, "" ),
						rsibling.test( tokens[0].type ) && context.parentNode || context,
						xml
					)) ) {

						// If seed is empty or no tokens remain, we can return early
						tokens.splice( i, 1 );
						selector = seed.length && tokens.join("");
						if ( !selector ) {
							push.apply( results, slice.call( seed, 0 ) );
							return results;
						}

						break;
					}
				}
			}
		}
	}

	// Compile and execute a filtering function
	// Provide `match` to avoid retokenization if we modified the selector above
	compile( selector, match )(
		seed,
		context,
		xml,
		results,
		rsibling.test( selector )
	);
	return results;
}

if ( document.querySelectorAll ) {
	(function() {
		var disconnectedMatch,
			oldSelect = select,
			rescape = /'|\\/g,
			rattributeQuotes = /\=[\x20\t\r\n\f]*([^'"\]]*)[\x20\t\r\n\f]*\]/g,

			// qSa(:focus) reports false when true (Chrome 21), no need to also add to buggyMatches since matches checks buggyQSA
			// A support test would require too much code (would include document ready)
			rbuggyQSA = [ ":focus" ],

			// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
			// A support test would require too much code (would include document ready)
			// just skip matchesSelector for :active
			rbuggyMatches = [ ":active" ],
			matches = docElem.matchesSelector ||
				docElem.mozMatchesSelector ||
				docElem.webkitMatchesSelector ||
				docElem.oMatchesSelector ||
				docElem.msMatchesSelector;

		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert(function( div ) {
			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explictly
			// setting a boolean content attribute,
			// since its presence should be enough
			// http://bugs.jquery.com/ticket/12359
			div.innerHTML = "<select><option selected=''></option></select>";

			// IE8 - Some boolean attributes are not treated correctly
			if ( !div.querySelectorAll("[selected]").length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:checked|disabled|ismap|multiple|readonly|selected|value)" );
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here (do not put tests after this one)
			if ( !div.querySelectorAll(":checked").length ) {
				rbuggyQSA.push(":checked");
			}
		});

		assert(function( div ) {

			// Opera 10-12/IE9 - ^= $= *= and empty values
			// Should not select anything
			div.innerHTML = "<p test=''></p>";
			if ( div.querySelectorAll("[test^='']").length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:\"\"|'')" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here (do not put tests after this one)
			div.innerHTML = "<input type='hidden'/>";
			if ( !div.querySelectorAll(":enabled").length ) {
				rbuggyQSA.push(":enabled", ":disabled");
			}
		});

		// rbuggyQSA always contains :focus, so no need for a length check
		rbuggyQSA = /* rbuggyQSA.length && */ new RegExp( rbuggyQSA.join("|") );

		select = function( selector, context, results, seed, xml ) {
			// Only use querySelectorAll when not filtering,
			// when this is not xml,
			// and when no QSA bugs apply
			if ( !seed && !xml && !rbuggyQSA.test( selector ) ) {
				var groups, i,
					old = true,
					nid = expando,
					newContext = context,
					newSelector = context.nodeType === 9 && selector;

				// qSA works strangely on Element-rooted queries
				// We can work around this by specifying an extra ID on the root
				// and working up from there (Thanks to Andrew Dupont for the technique)
				// IE 8 doesn't work on object elements
				if ( context.nodeType === 1 && context.nodeName.toLowerCase() !== "object" ) {
					groups = tokenize( selector );

					if ( (old = context.getAttribute("id")) ) {
						nid = old.replace( rescape, "\\$&" );
					} else {
						context.setAttribute( "id", nid );
					}
					nid = "[id='" + nid + "'] ";

					i = groups.length;
					while ( i-- ) {
						groups[i] = nid + groups[i].join("");
					}
					newContext = rsibling.test( selector ) && context.parentNode || context;
					newSelector = groups.join(",");
				}

				if ( newSelector ) {
					try {
						push.apply( results, slice.call( newContext.querySelectorAll(
							newSelector
						), 0 ) );
						return results;
					} catch(qsaError) {
					} finally {
						if ( !old ) {
							context.removeAttribute("id");
						}
					}
				}
			}

			return oldSelect( selector, context, results, seed, xml );
		};

		if ( matches ) {
			assert(function( div ) {
				// Check to see if it's possible to do matchesSelector
				// on a disconnected node (IE 9)
				disconnectedMatch = matches.call( div, "div" );

				// This should fail with an exception
				// Gecko does not error, returns false instead
				try {
					matches.call( div, "[test!='']:sizzle" );
					rbuggyMatches.push( "!=", pseudos );
				} catch ( e ) {}
			});

			// rbuggyMatches always contains :active and :focus, so no need for a length check
			rbuggyMatches = /* rbuggyMatches.length && */ new RegExp( rbuggyMatches.join("|") );

			Sizzle.matchesSelector = function( elem, expr ) {
				// Make sure that attribute selectors are quoted
				expr = expr.replace( rattributeQuotes, "='$1']" );

				// rbuggyMatches always contains :active, so no need for an existence check
				if ( !isXML( elem ) && !rbuggyMatches.test( expr ) && !rbuggyQSA.test( expr ) ) {
					try {
						var ret = matches.call( elem, expr );

						// IE 9's matchesSelector returns false on disconnected nodes
						if ( ret || disconnectedMatch ||
								// As well, disconnected nodes are said to be in a document
								// fragment in IE 9
								elem.document && elem.document.nodeType !== 11 ) {
							return ret;
						}
					} catch(e) {}
				}

				return Sizzle( expr, null, null, [ elem ] ).length > 0;
			};
		}
	})();
}

// Deprecated
Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Back-compat
function setFilters() {}
Expr.filters = setFilters.prototype = Expr.pseudos;
Expr.setFilters = new setFilters();

// Override sizzle attribute retrieval
Sizzle.attr = jQuery.attr;
jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;
jQuery.expr[":"] = jQuery.expr.pseudos;
jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;


})( window );
var runtil = /Until$/,
	rparentsprev = /^(?:parents|prev(?:Until|All))/,
	isSimple = /^.[^:#\[\.,]*$/,
	rneedsContext = jQuery.expr.match.needsContext,
	// methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.fn.extend({
	find: function( selector ) {
		var i, l, length, n, r, ret,
			self = this;

		if ( typeof selector !== "string" ) {
			return jQuery( selector ).filter(function() {
				for ( i = 0, l = self.length; i < l; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			});
		}

		ret = this.pushStack( "", "find", selector );

		for ( i = 0, l = this.length; i < l; i++ ) {
			length = ret.length;
			jQuery.find( selector, this[i], ret );

			if ( i > 0 ) {
				// Make sure that the results are unique
				for ( n = length; n < ret.length; n++ ) {
					for ( r = 0; r < length; r++ ) {
						if ( ret[r] === ret[n] ) {
							ret.splice(n--, 1);
							break;
						}
					}
				}
			}
		}

		return ret;
	},

	has: function( target ) {
		var i,
			targets = jQuery( target, this ),
			len = targets.length;

		return this.filter(function() {
			for ( i = 0; i < len; i++ ) {
				if ( jQuery.contains( this, targets[i] ) ) {
					return true;
				}
			}
		});
	},

	not: function( selector ) {
		return this.pushStack( winnow(this, selector, false), "not", selector);
	},

	filter: function( selector ) {
		return this.pushStack( winnow(this, selector, true), "filter", selector );
	},

	is: function( selector ) {
		return !!selector && (
			typeof selector === "string" ?
				// If this is a positional/relative selector, check membership in the returned set
				// so $("p:first").is("p:last") won't return true for a doc with two "p".
				rneedsContext.test( selector ) ?
					jQuery( selector, this.context ).index( this[0] ) >= 0 :
					jQuery.filter( selector, this ).length > 0 :
				this.filter( selector ).length > 0 );
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			ret = [],
			pos = rneedsContext.test( selectors ) || typeof selectors !== "string" ?
				jQuery( selectors, context || this.context ) :
				0;

		for ( ; i < l; i++ ) {
			cur = this[i];

			while ( cur && cur.ownerDocument && cur !== context && cur.nodeType !== 11 ) {
				if ( pos ? pos.index(cur) > -1 : jQuery.find.matchesSelector(cur, selectors) ) {
					ret.push( cur );
					break;
				}
				cur = cur.parentNode;
			}
		}

		ret = ret.length > 1 ? jQuery.unique( ret ) : ret;

		return this.pushStack( ret, "closest", selectors );
	},

	// Determine the position of an element within
	// the matched set of elements
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[0] && this[0].parentNode ) ? this.prevAll().length : -1;
		}

		// index in selector
		if ( typeof elem === "string" ) {
			return jQuery.inArray( this[0], jQuery( elem ) );
		}

		// Locate the position of the desired element
		return jQuery.inArray(
			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[0] : elem, this );
	},

	add: function( selector, context ) {
		var set = typeof selector === "string" ?
				jQuery( selector, context ) :
				jQuery.makeArray( selector && selector.nodeType ? [ selector ] : selector ),
			all = jQuery.merge( this.get(), set );

		return this.pushStack( isDisconnected( set[0] ) || isDisconnected( all[0] ) ?
			all :
			jQuery.unique( all ) );
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter(selector)
		);
	}
});

jQuery.fn.andSelf = jQuery.fn.addBack;

// A painfully simple check to see if an element is disconnected
// from a document (should be improved, where feasible).
function isDisconnected( node ) {
	return !node || !node.parentNode || node.parentNode.nodeType === 11;
}

function sibling( cur, dir ) {
	do {
		cur = cur[ dir ];
	} while ( cur && cur.nodeType !== 1 );

	return cur;
}

jQuery.each({
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return jQuery.dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return jQuery.dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return jQuery.dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return jQuery.sibling( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return jQuery.sibling( elem.firstChild );
	},
	contents: function( elem ) {
		return jQuery.nodeName( elem, "iframe" ) ?
			elem.contentDocument || elem.contentWindow.document :
			jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var ret = jQuery.map( this, fn, until );

		if ( !runtil.test( name ) ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			ret = jQuery.filter( selector, ret );
		}

		ret = this.length > 1 && !guaranteedUnique[ name ] ? jQuery.unique( ret ) : ret;

		if ( this.length > 1 && rparentsprev.test( name ) ) {
			ret = ret.reverse();
		}

		return this.pushStack( ret, name, core_slice.call( arguments ).join(",") );
	};
});

jQuery.extend({
	filter: function( expr, elems, not ) {
		if ( not ) {
			expr = ":not(" + expr + ")";
		}

		return elems.length === 1 ?
			jQuery.find.matchesSelector(elems[0], expr) ? [ elems[0] ] : [] :
			jQuery.find.matches(expr, elems);
	},

	dir: function( elem, dir, until ) {
		var matched = [],
			cur = elem[ dir ];

		while ( cur && cur.nodeType !== 9 && (until === undefined || cur.nodeType !== 1 || !jQuery( cur ).is( until )) ) {
			if ( cur.nodeType === 1 ) {
				matched.push( cur );
			}
			cur = cur[dir];
		}
		return matched;
	},

	sibling: function( n, elem ) {
		var r = [];

		for ( ; n; n = n.nextSibling ) {
			if ( n.nodeType === 1 && n !== elem ) {
				r.push( n );
			}
		}

		return r;
	}
});

// Implement the identical functionality for filter and not
function winnow( elements, qualifier, keep ) {

	// Can't pass null or undefined to indexOf in Firefox 4
	// Set to 0 to skip string check
	qualifier = qualifier || 0;

	if ( jQuery.isFunction( qualifier ) ) {
		return jQuery.grep(elements, function( elem, i ) {
			var retVal = !!qualifier.call( elem, i, elem );
			return retVal === keep;
		});

	} else if ( qualifier.nodeType ) {
		return jQuery.grep(elements, function( elem, i ) {
			return ( elem === qualifier ) === keep;
		});

	} else if ( typeof qualifier === "string" ) {
		var filtered = jQuery.grep(elements, function( elem ) {
			return elem.nodeType === 1;
		});

		if ( isSimple.test( qualifier ) ) {
			return jQuery.filter(qualifier, filtered, !keep);
		} else {
			qualifier = jQuery.filter( qualifier, filtered );
		}
	}

	return jQuery.grep(elements, function( elem, i ) {
		return ( jQuery.inArray( elem, qualifier ) >= 0 ) === keep;
	});
}
function createSafeFragment( document ) {
	var list = nodeNames.split( "|" ),
	safeFrag = document.createDocumentFragment();

	if ( safeFrag.createElement ) {
		while ( list.length ) {
			safeFrag.createElement(
				list.pop()
			);
		}
	}
	return safeFrag;
}

var nodeNames = "abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|" +
		"header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",
	rinlinejQuery = / jQuery\d+="(?:null|\d+)"/g,
	rleadingWhitespace = /^\s+/,
	rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
	rtagName = /<([\w:]+)/,
	rtbody = /<tbody/i,
	rhtml = /<|&#?\w+;/,
	rnoInnerhtml = /<(?:script|style|link)/i,
	rnocache = /<(?:script|object|embed|option|style)/i,
	rnoshimcache = new RegExp("<(?:" + nodeNames + ")[\\s/>]", "i"),
	rcheckableType = /^(?:checkbox|radio)$/,
	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rscriptType = /\/(java|ecma)script/i,
	rcleanScript = /^\s*<!(?:\[CDATA\[|\-\-)|[\]\-]{2}>\s*$/g,
	wrapMap = {
		option: [ 1, "<select multiple='multiple'>", "</select>" ],
		legend: [ 1, "<fieldset>", "</fieldset>" ],
		thead: [ 1, "<table>", "</table>" ],
		tr: [ 2, "<table><tbody>", "</tbody></table>" ],
		td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],
		col: [ 2, "<table><tbody></tbody><colgroup>", "</colgroup></table>" ],
		area: [ 1, "<map>", "</map>" ],
		_default: [ 0, "", "" ]
	},
	safeFragment = createSafeFragment( document ),
	fragmentDiv = safeFragment.appendChild( document.createElement("div") );

wrapMap.optgroup = wrapMap.option;
wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

// IE6-8 can't serialize link, script, style, or any html5 (NoScope) tags,
// unless wrapped in a div with non-breaking characters in front of it.
if ( !jQuery.support.htmlSerialize ) {
	wrapMap._default = [ 1, "X<div>", "</div>" ];
}

jQuery.fn.extend({
	text: function( value ) {
		return jQuery.access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().append( ( this[0] && this[0].ownerDocument || document ).createTextNode( value ) );
		}, null, value, arguments.length );
	},

	wrapAll: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapAll( html.call(this, i) );
			});
		}

		if ( this[0] ) {
			// The elements to wrap the target around
			var wrap = jQuery( html, this[0].ownerDocument ).eq(0).clone(true);

			if ( this[0].parentNode ) {
				wrap.insertBefore( this[0] );
			}

			wrap.map(function() {
				var elem = this;

				while ( elem.firstChild && elem.firstChild.nodeType === 1 ) {
					elem = elem.firstChild;
				}

				return elem;
			}).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapInner( html.call(this, i) );
			});
		}

		return this.each(function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		});
	},

	wrap: function( html ) {
		var isFunction = jQuery.isFunction( html );

		return this.each(function(i) {
			jQuery( this ).wrapAll( isFunction ? html.call(this, i) : html );
		});
	},

	unwrap: function() {
		return this.parent().each(function() {
			if ( !jQuery.nodeName( this, "body" ) ) {
				jQuery( this ).replaceWith( this.childNodes );
			}
		}).end();
	},

	append: function() {
		return this.domManip(arguments, true, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 ) {
				this.appendChild( elem );
			}
		});
	},

	prepend: function() {
		return this.domManip(arguments, true, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 ) {
				this.insertBefore( elem, this.firstChild );
			}
		});
	},

	before: function() {
		if ( !isDisconnected( this[0] ) ) {
			return this.domManip(arguments, false, function( elem ) {
				this.parentNode.insertBefore( elem, this );
			});
		}

		if ( arguments.length ) {
			var set = jQuery.clean( arguments );
			return this.pushStack( jQuery.merge( set, this ), "before", this.selector );
		}
	},

	after: function() {
		if ( !isDisconnected( this[0] ) ) {
			return this.domManip(arguments, false, function( elem ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			});
		}

		if ( arguments.length ) {
			var set = jQuery.clean( arguments );
			return this.pushStack( jQuery.merge( this, set ), "after", this.selector );
		}
	},

	// keepData is for internal use only--do not document
	remove: function( selector, keepData ) {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			if ( !selector || jQuery.filter( selector, [ elem ] ).length ) {
				if ( !keepData && elem.nodeType === 1 ) {
					jQuery.cleanData( elem.getElementsByTagName("*") );
					jQuery.cleanData( [ elem ] );
				}

				if ( elem.parentNode ) {
					elem.parentNode.removeChild( elem );
				}
			}
		}

		return this;
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			// Remove element nodes and prevent memory leaks
			if ( elem.nodeType === 1 ) {
				jQuery.cleanData( elem.getElementsByTagName("*") );
			}

			// Remove any remaining nodes
			while ( elem.firstChild ) {
				elem.removeChild( elem.firstChild );
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map( function () {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		});
	},

	html: function( value ) {
		return jQuery.access( this, function( value ) {
			var elem = this[0] || {},
				i = 0,
				l = this.length;

			if ( value === undefined ) {
				return elem.nodeType === 1 ?
					elem.innerHTML.replace( rinlinejQuery, "" ) :
					undefined;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				( jQuery.support.htmlSerialize || !rnoshimcache.test( value )  ) &&
				( jQuery.support.leadingWhitespace || !rleadingWhitespace.test( value ) ) &&
				!wrapMap[ ( rtagName.exec( value ) || ["", ""] )[1].toLowerCase() ] ) {

				value = value.replace( rxhtmlTag, "<$1></$2>" );

				try {
					for (; i < l; i++ ) {
						// Remove element nodes and prevent memory leaks
						elem = this[i] || {};
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( elem.getElementsByTagName( "*" ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch(e) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function( value ) {
		if ( !isDisconnected( this[0] ) ) {
			// Make sure that the elements are removed from the DOM before they are inserted
			// this can help fix replacing a parent with child elements
			if ( jQuery.isFunction( value ) ) {
				return this.each(function(i) {
					var self = jQuery(this), old = self.html();
					self.replaceWith( value.call( this, i, old ) );
				});
			}

			if ( typeof value !== "string" ) {
				value = jQuery( value ).detach();
			}

			return this.each(function() {
				var next = this.nextSibling,
					parent = this.parentNode;

				jQuery( this ).remove();

				if ( next ) {
					jQuery(next).before( value );
				} else {
					jQuery(parent).append( value );
				}
			});
		}

		return this.length ?
			this.pushStack( jQuery(jQuery.isFunction(value) ? value() : value), "replaceWith", value ) :
			this;
	},

	detach: function( selector ) {
		return this.remove( selector, true );
	},

	domManip: function( args, table, callback ) {

		// Flatten any nested arrays
		args = [].concat.apply( [], args );

		var results, first, fragment, iNoClone,
			i = 0,
			value = args[0],
			scripts = [],
			l = this.length;

		// We can't cloneNode fragments that contain checked, in WebKit
		if ( !jQuery.support.checkClone && l > 1 && typeof value === "string" && rchecked.test( value ) ) {
			return this.each(function() {
				jQuery(this).domManip( args, table, callback );
			});
		}

		if ( jQuery.isFunction(value) ) {
			return this.each(function(i) {
				var self = jQuery(this);
				args[0] = value.call( this, i, table ? self.html() : undefined );
				self.domManip( args, table, callback );
			});
		}

		if ( this[0] ) {
			results = jQuery.buildFragment( args, this, scripts );
			fragment = results.fragment;
			first = fragment.firstChild;

			if ( fragment.childNodes.length === 1 ) {
				fragment = first;
			}

			if ( first ) {
				table = table && jQuery.nodeName( first, "tr" );

				// Use the original fragment for the last item instead of the first because it can end up
				// being emptied incorrectly in certain situations (#8070).
				// Fragments from the fragment cache must always be cloned and never used in place.
				for ( iNoClone = results.cacheable || l - 1; i < l; i++ ) {
					callback.call(
						table && jQuery.nodeName( this[i], "table" ) ?
							findOrAppend( this[i], "tbody" ) :
							this[i],
						i === iNoClone ?
							fragment :
							jQuery.clone( fragment, true, true )
					);
				}
			}

			// Fix #11809: Avoid leaking memory
			fragment = first = null;

			if ( scripts.length ) {
				jQuery.each( scripts, function( i, elem ) {
					if ( elem.src ) {
						if ( jQuery.ajax ) {
							jQuery.ajax({
								url: elem.src,
								type: "GET",
								dataType: "script",
								async: false,
								global: false,
								"throws": true
							});
						} else {
							jQuery.error("no ajax");
						}
					} else {
						jQuery.globalEval( ( elem.text || elem.textContent || elem.innerHTML || "" ).replace( rcleanScript, "" ) );
					}

					if ( elem.parentNode ) {
						elem.parentNode.removeChild( elem );
					}
				});
			}
		}

		return this;
	}
});

function findOrAppend( elem, tag ) {
	return elem.getElementsByTagName( tag )[0] || elem.appendChild( elem.ownerDocument.createElement( tag ) );
}

function cloneCopyEvent( src, dest ) {

	if ( dest.nodeType !== 1 || !jQuery.hasData( src ) ) {
		return;
	}

	var type, i, l,
		oldData = jQuery._data( src ),
		curData = jQuery._data( dest, oldData ),
		events = oldData.events;

	if ( events ) {
		delete curData.handle;
		curData.events = {};

		for ( type in events ) {
			for ( i = 0, l = events[ type ].length; i < l; i++ ) {
				jQuery.event.add( dest, type, events[ type ][ i ] );
			}
		}
	}

	// make the cloned public data object a copy from the original
	if ( curData.data ) {
		curData.data = jQuery.extend( {}, curData.data );
	}
}

function cloneFixAttributes( src, dest ) {
	var nodeName;

	// We do not need to do anything for non-Elements
	if ( dest.nodeType !== 1 ) {
		return;
	}

	// clearAttributes removes the attributes, which we don't want,
	// but also removes the attachEvent events, which we *do* want
	if ( dest.clearAttributes ) {
		dest.clearAttributes();
	}

	// mergeAttributes, in contrast, only merges back on the
	// original attributes, not the events
	if ( dest.mergeAttributes ) {
		dest.mergeAttributes( src );
	}

	nodeName = dest.nodeName.toLowerCase();

	if ( nodeName === "object" ) {
		// IE6-10 improperly clones children of object elements using classid.
		// IE10 throws NoModificationAllowedError if parent is null, #12132.
		if ( dest.parentNode ) {
			dest.outerHTML = src.outerHTML;
		}

		// This path appears unavoidable for IE9. When cloning an object
		// element in IE9, the outerHTML strategy above is not sufficient.
		// If the src has innerHTML and the destination does not,
		// copy the src.innerHTML into the dest.innerHTML. #10324
		if ( jQuery.support.html5Clone && (src.innerHTML && !jQuery.trim(dest.innerHTML)) ) {
			dest.innerHTML = src.innerHTML;
		}

	} else if ( nodeName === "input" && rcheckableType.test( src.type ) ) {
		// IE6-8 fails to persist the checked state of a cloned checkbox
		// or radio button. Worse, IE6-7 fail to give the cloned element
		// a checked appearance if the defaultChecked value isn't also set

		dest.defaultChecked = dest.checked = src.checked;

		// IE6-7 get confused and end up setting the value of a cloned
		// checkbox/radio button to an empty string instead of "on"
		if ( dest.value !== src.value ) {
			dest.value = src.value;
		}

	// IE6-8 fails to return the selected option to the default selected
	// state when cloning options
	} else if ( nodeName === "option" ) {
		dest.selected = src.defaultSelected;

	// IE6-8 fails to set the defaultValue to the correct value when
	// cloning other types of input fields
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;

	// IE blanks contents when cloning scripts
	} else if ( nodeName === "script" && dest.text !== src.text ) {
		dest.text = src.text;
	}

	// Event data gets referenced instead of copied if the expando
	// gets copied too
	dest.removeAttribute( jQuery.expando );
}

jQuery.buildFragment = function( args, context, scripts ) {
	var fragment, cacheable, cachehit,
		first = args[ 0 ];

	// Set context from what may come in as undefined or a jQuery collection or a node
	// Updated to fix #12266 where accessing context[0] could throw an exception in IE9/10 &
	// also doubles as fix for #8950 where plain objects caused createDocumentFragment exception
	context = context || document;
	context = !context.nodeType && context[0] || context;
	context = context.ownerDocument || context;

	// Only cache "small" (1/2 KB) HTML strings that are associated with the main document
	// Cloning options loses the selected state, so don't cache them
	// IE 6 doesn't like it when you put <object> or <embed> elements in a fragment
	// Also, WebKit does not clone 'checked' attributes on cloneNode, so don't cache
	// Lastly, IE6,7,8 will not correctly reuse cached fragments that were created from unknown elems #10501
	if ( args.length === 1 && typeof first === "string" && first.length < 512 && context === document &&
		first.charAt(0) === "<" && !rnocache.test( first ) &&
		(jQuery.support.checkClone || !rchecked.test( first )) &&
		(jQuery.support.html5Clone || !rnoshimcache.test( first )) ) {

		// Mark cacheable and look for a hit
		cacheable = true;
		fragment = jQuery.fragments[ first ];
		cachehit = fragment !== undefined;
	}

	if ( !fragment ) {
		fragment = context.createDocumentFragment();
		jQuery.clean( args, context, fragment, scripts );

		// Update the cache, but only store false
		// unless this is a second parsing of the same content
		if ( cacheable ) {
			jQuery.fragments[ first ] = cachehit && fragment;
		}
	}

	return { fragment: fragment, cacheable: cacheable };
};

jQuery.fragments = {};

jQuery.each({
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			i = 0,
			ret = [],
			insert = jQuery( selector ),
			l = insert.length,
			parent = this.length === 1 && this[0].parentNode;

		if ( (parent == null || parent && parent.nodeType === 11 && parent.childNodes.length === 1) && l === 1 ) {
			insert[ original ]( this[0] );
			return this;
		} else {
			for ( ; i < l; i++ ) {
				elems = ( i > 0 ? this.clone(true) : this ).get();
				jQuery( insert[i] )[ original ]( elems );
				ret = ret.concat( elems );
			}

			return this.pushStack( ret, name, insert.selector );
		}
	};
});

function getAll( elem ) {
	if ( typeof elem.getElementsByTagName !== "undefined" ) {
		return elem.getElementsByTagName( "*" );

	} else if ( typeof elem.querySelectorAll !== "undefined" ) {
		return elem.querySelectorAll( "*" );

	} else {
		return [];
	}
}

// Used in clean, fixes the defaultChecked property
function fixDefaultChecked( elem ) {
	if ( rcheckableType.test( elem.type ) ) {
		elem.defaultChecked = elem.checked;
	}
}

jQuery.extend({
	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var srcElements,
			destElements,
			i,
			clone;

		if ( jQuery.support.html5Clone || jQuery.isXMLDoc(elem) || !rnoshimcache.test( "<" + elem.nodeName + ">" ) ) {
			clone = elem.cloneNode( true );

		// IE<=8 does not properly clone detached, unknown element nodes
		} else {
			fragmentDiv.innerHTML = elem.outerHTML;
			fragmentDiv.removeChild( clone = fragmentDiv.firstChild );
		}

		if ( (!jQuery.support.noCloneEvent || !jQuery.support.noCloneChecked) &&
				(elem.nodeType === 1 || elem.nodeType === 11) && !jQuery.isXMLDoc(elem) ) {
			// IE copies events bound via attachEvent when using cloneNode.
			// Calling detachEvent on the clone will also remove the events
			// from the original. In order to get around this, we use some
			// proprietary methods to clear the events. Thanks to MooTools
			// guys for this hotness.

			cloneFixAttributes( elem, clone );

			// Using Sizzle here is crazy slow, so we use getElementsByTagName instead
			srcElements = getAll( elem );
			destElements = getAll( clone );

			// Weird iteration because IE will replace the length property
			// with an element if you are cloning the body and one of the
			// elements on the page has a name or id of "length"
			for ( i = 0; srcElements[i]; ++i ) {
				// Ensure that the destination node is not null; Fixes #9587
				if ( destElements[i] ) {
					cloneFixAttributes( srcElements[i], destElements[i] );
				}
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			cloneCopyEvent( elem, clone );

			if ( deepDataAndEvents ) {
				srcElements = getAll( elem );
				destElements = getAll( clone );

				for ( i = 0; srcElements[i]; ++i ) {
					cloneCopyEvent( srcElements[i], destElements[i] );
				}
			}
		}

		srcElements = destElements = null;

		// Return the cloned set
		return clone;
	},

	clean: function( elems, context, fragment, scripts ) {
		var i, j, elem, tag, wrap, depth, div, hasBody, tbody, len, handleScript, jsTags,
			safe = context === document && safeFragment,
			ret = [];

		// Ensure that context is a document
		if ( !context || typeof context.createDocumentFragment === "undefined" ) {
			context = document;
		}

		// Use the already-created safe fragment if context permits
		for ( i = 0; (elem = elems[i]) != null; i++ ) {
			if ( typeof elem === "number" ) {
				elem += "";
			}

			if ( !elem ) {
				continue;
			}

			// Convert html string into DOM nodes
			if ( typeof elem === "string" ) {
				if ( !rhtml.test( elem ) ) {
					elem = context.createTextNode( elem );
				} else {
					// Ensure a safe container in which to render the html
					safe = safe || createSafeFragment( context );
					div = context.createElement("div");
					safe.appendChild( div );

					// Fix "XHTML"-style tags in all browsers
					elem = elem.replace(rxhtmlTag, "<$1></$2>");

					// Go to html and back, then peel off extra wrappers
					tag = ( rtagName.exec( elem ) || ["", ""] )[1].toLowerCase();
					wrap = wrapMap[ tag ] || wrapMap._default;
					depth = wrap[0];
					div.innerHTML = wrap[1] + elem + wrap[2];

					// Move to the right depth
					while ( depth-- ) {
						div = div.lastChild;
					}

					// Remove IE's autoinserted <tbody> from table fragments
					if ( !jQuery.support.tbody ) {

						// String was a <table>, *may* have spurious <tbody>
						hasBody = rtbody.test(elem);
							tbody = tag === "table" && !hasBody ?
								div.firstChild && div.firstChild.childNodes :

								// String was a bare <thead> or <tfoot>
								wrap[1] === "<table>" && !hasBody ?
									div.childNodes :
									[];

						for ( j = tbody.length - 1; j >= 0 ; --j ) {
							if ( jQuery.nodeName( tbody[ j ], "tbody" ) && !tbody[ j ].childNodes.length ) {
								tbody[ j ].parentNode.removeChild( tbody[ j ] );
							}
						}
					}

					// IE completely kills leading whitespace when innerHTML is used
					if ( !jQuery.support.leadingWhitespace && rleadingWhitespace.test( elem ) ) {
						div.insertBefore( context.createTextNode( rleadingWhitespace.exec(elem)[0] ), div.firstChild );
					}

					elem = div.childNodes;

					// Take out of fragment container (we need a fresh div each time)
					div.parentNode.removeChild( div );
				}
			}

			if ( elem.nodeType ) {
				ret.push( elem );
			} else {
				jQuery.merge( ret, elem );
			}
		}

		// Fix #11356: Clear elements from safeFragment
		if ( div ) {
			elem = div = safe = null;
		}

		// Reset defaultChecked for any radios and checkboxes
		// about to be appended to the DOM in IE 6/7 (#8060)
		if ( !jQuery.support.appendChecked ) {
			for ( i = 0; (elem = ret[i]) != null; i++ ) {
				if ( jQuery.nodeName( elem, "input" ) ) {
					fixDefaultChecked( elem );
				} else if ( typeof elem.getElementsByTagName !== "undefined" ) {
					jQuery.grep( elem.getElementsByTagName("input"), fixDefaultChecked );
				}
			}
		}

		// Append elements to a provided document fragment
		if ( fragment ) {
			// Special handling of each script element
			handleScript = function( elem ) {
				// Check if we consider it executable
				if ( !elem.type || rscriptType.test( elem.type ) ) {
					// Detach the script and store it in the scripts array (if provided) or the fragment
					// Return truthy to indicate that it has been handled
					return scripts ?
						scripts.push( elem.parentNode ? elem.parentNode.removeChild( elem ) : elem ) :
						fragment.appendChild( elem );
				}
			};

			for ( i = 0; (elem = ret[i]) != null; i++ ) {
				// Check if we're done after handling an executable script
				if ( !( jQuery.nodeName( elem, "script" ) && handleScript( elem ) ) ) {
					// Append to fragment and handle embedded scripts
					fragment.appendChild( elem );
					if ( typeof elem.getElementsByTagName !== "undefined" ) {
						// handleScript alters the DOM, so use jQuery.merge to ensure snapshot iteration
						jsTags = jQuery.grep( jQuery.merge( [], elem.getElementsByTagName("script") ), handleScript );

						// Splice the scripts into ret after their former ancestor and advance our index beyond them
						ret.splice.apply( ret, [i + 1, 0].concat( jsTags ) );
						i += jsTags.length;
					}
				}
			}
		}

		return ret;
	},

	cleanData: function( elems, /* internal */ acceptData ) {
		var data, id, elem, type,
			i = 0,
			internalKey = jQuery.expando,
			cache = jQuery.cache,
			deleteExpando = jQuery.support.deleteExpando,
			special = jQuery.event.special;

		for ( ; (elem = elems[i]) != null; i++ ) {

			if ( acceptData || jQuery.acceptData( elem ) ) {

				id = elem[ internalKey ];
				data = id && cache[ id ];

				if ( data ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Remove cache only if it was not already removed by jQuery.event.remove
					if ( cache[ id ] ) {

						delete cache[ id ];

						// IE does not allow us to delete expando properties from nodes,
						// nor does it have a removeAttribute function on Document nodes;
						// we must handle all of these cases
						if ( deleteExpando ) {
							delete elem[ internalKey ];

						} else if ( elem.removeAttribute ) {
							elem.removeAttribute( internalKey );

						} else {
							elem[ internalKey ] = null;
						}

						jQuery.deletedIds.push( id );
					}
				}
			}
		}
	}
});
// Limit scope pollution from any deprecated API
(function() {

var matched, browser;

// Use of jQuery.browser is frowned upon.
// More details: http://api.jquery.com/jQuery.browser
// jQuery.uaMatch maintained for back-compat
jQuery.uaMatch = function( ua ) {
	ua = ua.toLowerCase();

	var match = /(chrome)[ \/]([\w.]+)/.exec( ua ) ||
		/(webkit)[ \/]([\w.]+)/.exec( ua ) ||
		/(opera)(?:.*version|)[ \/]([\w.]+)/.exec( ua ) ||
		/(msie) ([\w.]+)/.exec( ua ) ||
		ua.indexOf("compatible") < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec( ua ) ||
		[];

	return {
		browser: match[ 1 ] || "",
		version: match[ 2 ] || "0"
	};
};

matched = jQuery.uaMatch( navigator.userAgent );
browser = {};

if ( matched.browser ) {
	browser[ matched.browser ] = true;
	browser.version = matched.version;
}

// Chrome is Webkit, but Webkit is also Safari.
if ( browser.chrome ) {
	browser.webkit = true;
} else if ( browser.webkit ) {
	browser.safari = true;
}

jQuery.browser = browser;

jQuery.sub = function() {
	function jQuerySub( selector, context ) {
		return new jQuerySub.fn.init( selector, context );
	}
	jQuery.extend( true, jQuerySub, this );
	jQuerySub.superclass = this;
	jQuerySub.fn = jQuerySub.prototype = this();
	jQuerySub.fn.constructor = jQuerySub;
	jQuerySub.sub = this.sub;
	jQuerySub.fn.init = function init( selector, context ) {
		if ( context && context instanceof jQuery && !(context instanceof jQuerySub) ) {
			context = jQuerySub( context );
		}

		return jQuery.fn.init.call( this, selector, context, rootjQuerySub );
	};
	jQuerySub.fn.init.prototype = jQuerySub.fn;
	var rootjQuerySub = jQuerySub(document);
	return jQuerySub;
};

})();
var curCSS, iframe, iframeDoc,
	ralpha = /alpha\([^)]*\)/i,
	ropacity = /opacity=([^)]*)/,
	rposition = /^(top|right|bottom|left)$/,
	// swappable if display is none or starts with table except "table", "table-cell", or "table-caption"
	// see here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rmargin = /^margin/,
	rnumsplit = new RegExp( "^(" + core_pnum + ")(.*)$", "i" ),
	rnumnonpx = new RegExp( "^(" + core_pnum + ")(?!px)[a-z%]+$", "i" ),
	rrelNum = new RegExp( "^([-+])=(" + core_pnum + ")", "i" ),
	elemdisplay = { BODY: "block" },

	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: 0,
		fontWeight: 400
	},

	cssExpand = [ "Top", "Right", "Bottom", "Left" ],
	cssPrefixes = [ "Webkit", "O", "Moz", "ms" ],

	eventsToggle = jQuery.fn.toggle;

// return a css property mapped to a potentially vendor prefixed property
function vendorPropName( style, name ) {

	// shortcut for names that are not vendor prefixed
	if ( name in style ) {
		return name;
	}

	// check for vendor prefixed names
	var capName = name.charAt(0).toUpperCase() + name.slice(1),
		origName = name,
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in style ) {
			return name;
		}
	}

	return origName;
}

function isHidden( elem, el ) {
	elem = el || elem;
	return jQuery.css( elem, "display" ) === "none" || !jQuery.contains( elem.ownerDocument, elem );
}

function showHide( elements, show ) {
	var elem, display,
		values = [],
		index = 0,
		length = elements.length;

	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		values[ index ] = jQuery._data( elem, "olddisplay" );
		if ( show ) {
			// Reset the inline display of this element to learn if it is
			// being hidden by cascaded rules or not
			if ( !values[ index ] && elem.style.display === "none" ) {
				elem.style.display = "";
			}

			// Set elements which have been overridden with display: none
			// in a stylesheet to whatever the default browser style is
			// for such an element
			if ( elem.style.display === "" && isHidden( elem ) ) {
				values[ index ] = jQuery._data( elem, "olddisplay", css_defaultDisplay(elem.nodeName) );
			}
		} else {
			display = curCSS( elem, "display" );

			if ( !values[ index ] && display !== "none" ) {
				jQuery._data( elem, "olddisplay", display );
			}
		}
	}

	// Set the display of most of the elements in a second loop
	// to avoid the constant reflow
	for ( index = 0; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
			elem.style.display = show ? values[ index ] || "" : "none";
		}
	}

	return elements;
}

jQuery.fn.extend({
	css: function( name, value ) {
		return jQuery.access( this, function( elem, name, value ) {
			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	},
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state, fn2 ) {
		var bool = typeof state === "boolean";

		if ( jQuery.isFunction( state ) && jQuery.isFunction( fn2 ) ) {
			return eventsToggle.apply( this, arguments );
		}

		return this.each(function() {
			if ( bool ? state : isHidden( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		});
	}
});

jQuery.extend({
	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {
					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;

				}
			}
		}
	},

	// Exclude the following css properties to add px
	cssNumber: {
		"fillOpacity": true,
		"fontWeight": true,
		"lineHeight": true,
		"opacity": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {
		// normalize float css property
		"float": jQuery.support.cssFloat ? "cssFloat" : "styleFloat"
	},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {
		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = jQuery.camelCase( name ),
			style = elem.style;

		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// convert relative number strings (+= or -=) to relative numbers. #7345
			if ( type === "string" && (ret = rrelNum.exec( value )) ) {
				value = ( ret[1] + 1 ) * ret[2] + parseFloat( jQuery.css( elem, name ) );
				// Fixes bug #9237
				type = "number";
			}

			// Make sure that NaN and null values aren't set. See: #7116
			if ( value == null || type === "number" && isNaN( value ) ) {
				return;
			}

			// If a number was passed in, add 'px' to the (except for certain CSS properties)
			if ( type === "number" && !jQuery.cssNumber[ origName ] ) {
				value += "px";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !("set" in hooks) || (value = hooks.set( elem, value, extra )) !== undefined ) {
				// Wrapped to prevent IE from throwing errors when 'invalid' values are provided
				// Fixes bug #5509
				try {
					style[ name ] = value;
				} catch(e) {}
			}

		} else {
			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, false, extra )) !== undefined ) {
				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, numeric, extra ) {
		var val, num, hooks,
			origName = jQuery.camelCase( name );

		// Make sure that we're working with the right name
		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( elem.style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name );
		}

		//convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Return, converting to number if forced or a qualifier was provided and val looks numeric
		if ( numeric || extra !== undefined ) {
			num = parseFloat( val );
			return numeric || jQuery.isNumeric( num ) ? num || 0 : val;
		}
		return val;
	},

	// A method for quickly swapping in/out CSS properties to get correct calculations
	swap: function( elem, options, callback ) {
		var ret, name,
			old = {};

		// Remember the old values, and insert the new ones
		for ( name in options ) {
			old[ name ] = elem.style[ name ];
			elem.style[ name ] = options[ name ];
		}

		ret = callback.call( elem );

		// Revert the old values
		for ( name in options ) {
			elem.style[ name ] = old[ name ];
		}

		return ret;
	}
});

// NOTE: To any future maintainer, we've window.getComputedStyle
// because jsdom on node.js will break without it.
if ( window.getComputedStyle ) {
	curCSS = function( elem, name ) {
		var ret, width, minWidth, maxWidth,
			computed = window.getComputedStyle( elem, null ),
			style = elem.style;

		if ( computed ) {

			// getPropertyValue is only needed for .css('filter') in IE9, see #12537
			ret = computed.getPropertyValue( name ) || computed[ name ];

			if ( ret === "" && !jQuery.contains( elem.ownerDocument, elem ) ) {
				ret = jQuery.style( elem, name );
			}

			// A tribute to the "awesome hack by Dean Edwards"
			// Chrome < 17 and Safari 5.0 uses "computed value" instead of "used value" for margin-right
			// Safari 5.1.7 (at least) returns percentage for a larger set of values, but width seems to be reliably pixels
			// this is against the CSSOM draft spec: http://dev.w3.org/csswg/cssom/#resolved-values
			if ( rnumnonpx.test( ret ) && rmargin.test( name ) ) {
				width = style.width;
				minWidth = style.minWidth;
				maxWidth = style.maxWidth;

				style.minWidth = style.maxWidth = style.width = ret;
				ret = computed.width;

				style.width = width;
				style.minWidth = minWidth;
				style.maxWidth = maxWidth;
			}
		}

		return ret;
	};
} else if ( document.documentElement.currentStyle ) {
	curCSS = function( elem, name ) {
		var left, rsLeft,
			ret = elem.currentStyle && elem.currentStyle[ name ],
			style = elem.style;

		// Avoid setting ret to empty string here
		// so we don't default to auto
		if ( ret == null && style && style[ name ] ) {
			ret = style[ name ];
		}

		// From the awesome hack by Dean Edwards
		// http://erik.eae.net/archives/2007/07/27/18.54.15/#comment-102291

		// If we're not dealing with a regular pixel number
		// but a number that has a weird ending, we need to convert it to pixels
		// but not position css attributes, as those are proportional to the parent element instead
		// and we can't measure the parent instead because it might trigger a "stacking dolls" problem
		if ( rnumnonpx.test( ret ) && !rposition.test( name ) ) {

			// Remember the original values
			left = style.left;
			rsLeft = elem.runtimeStyle && elem.runtimeStyle.left;

			// Put in the new values to get a computed value out
			if ( rsLeft ) {
				elem.runtimeStyle.left = elem.currentStyle.left;
			}
			style.left = name === "fontSize" ? "1em" : ret;
			ret = style.pixelLeft + "px";

			// Revert the changed values
			style.left = left;
			if ( rsLeft ) {
				elem.runtimeStyle.left = rsLeft;
			}
		}

		return ret === "" ? "auto" : ret;
	};
}

function setPositiveNumber( elem, value, subtract ) {
	var matches = rnumsplit.exec( value );
	return matches ?
			Math.max( 0, matches[ 1 ] - ( subtract || 0 ) ) + ( matches[ 2 ] || "px" ) :
			value;
}

function augmentWidthOrHeight( elem, name, extra, isBorderBox ) {
	var i = extra === ( isBorderBox ? "border" : "content" ) ?
		// If we already have the right measurement, avoid augmentation
		4 :
		// Otherwise initialize for horizontal or vertical properties
		name === "width" ? 1 : 0,

		val = 0;

	for ( ; i < 4; i += 2 ) {
		// both box models exclude margin, so add it if we want it
		if ( extra === "margin" ) {
			// we use jQuery.css instead of curCSS here
			// because of the reliableMarginRight CSS hook!
			val += jQuery.css( elem, extra + cssExpand[ i ], true );
		}

		// From this point on we use curCSS for maximum performance (relevant in animations)
		if ( isBorderBox ) {
			// border-box includes padding, so remove it if we want content
			if ( extra === "content" ) {
				val -= parseFloat( curCSS( elem, "padding" + cssExpand[ i ] ) ) || 0;
			}

			// at this point, extra isn't border nor margin, so remove border
			if ( extra !== "margin" ) {
				val -= parseFloat( curCSS( elem, "border" + cssExpand[ i ] + "Width" ) ) || 0;
			}
		} else {
			// at this point, extra isn't content, so add padding
			val += parseFloat( curCSS( elem, "padding" + cssExpand[ i ] ) ) || 0;

			// at this point, extra isn't content nor padding, so add border
			if ( extra !== "padding" ) {
				val += parseFloat( curCSS( elem, "border" + cssExpand[ i ] + "Width" ) ) || 0;
			}
		}
	}

	return val;
}

function getWidthOrHeight( elem, name, extra ) {

	// Start with offset property, which is equivalent to the border-box value
	var val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
		valueIsBorderBox = true,
		isBorderBox = jQuery.support.boxSizing && jQuery.css( elem, "boxSizing" ) === "border-box";

	// some non-html elements return undefined for offsetWidth, so check for null/undefined
	// svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
	// MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
	if ( val <= 0 || val == null ) {
		// Fall back to computed then uncomputed css if necessary
		val = curCSS( elem, name );
		if ( val < 0 || val == null ) {
			val = elem.style[ name ];
		}

		// Computed unit is not pixels. Stop here and return.
		if ( rnumnonpx.test(val) ) {
			return val;
		}

		// we need the check for style in case a browser which returns unreliable values
		// for getComputedStyle silently falls back to the reliable elem.style
		valueIsBorderBox = isBorderBox && ( jQuery.support.boxSizingReliable || val === elem.style[ name ] );

		// Normalize "", auto, and prepare for extra
		val = parseFloat( val ) || 0;
	}

	// use the active box-sizing model to add/subtract irrelevant styles
	return ( val +
		augmentWidthOrHeight(
			elem,
			name,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox
		)
	) + "px";
}


// Try to determine the default display value of an element
function css_defaultDisplay( nodeName ) {
	if ( elemdisplay[ nodeName ] ) {
		return elemdisplay[ nodeName ];
	}

	var elem = jQuery( "<" + nodeName + ">" ).appendTo( document.body ),
		display = elem.css("display");
	elem.remove();

	// If the simple way fails,
	// get element's real default display by attaching it to a temp iframe
	if ( display === "none" || display === "" ) {
		// Use the already-created iframe if possible
		iframe = document.body.appendChild(
			iframe || jQuery.extend( document.createElement("iframe"), {
				frameBorder: 0,
				width: 0,
				height: 0
			})
		);

		// Create a cacheable copy of the iframe document on first call.
		// IE and Opera will allow us to reuse the iframeDoc without re-writing the fake HTML
		// document to it; WebKit & Firefox won't allow reusing the iframe document.
		if ( !iframeDoc || !iframe.createElement ) {
			iframeDoc = ( iframe.contentWindow || iframe.contentDocument ).document;
			iframeDoc.write("<!doctype html><html><body>");
			iframeDoc.close();
		}

		elem = iframeDoc.body.appendChild( iframeDoc.createElement(nodeName) );

		display = curCSS( elem, "display" );
		document.body.removeChild( iframe );
	}

	// Store the correct default display
	elemdisplay[ nodeName ] = display;

	return display;
}

jQuery.each([ "height", "width" ], function( i, name ) {
	jQuery.cssHooks[ name ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {
				// certain elements can have dimension info if we invisibly show them
				// however, it must have a current display style that would benefit from this
				if ( elem.offsetWidth === 0 && rdisplayswap.test( curCSS( elem, "display" ) ) ) {
					return jQuery.swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, name, extra );
					});
				} else {
					return getWidthOrHeight( elem, name, extra );
				}
			}
		},

		set: function( elem, value, extra ) {
			return setPositiveNumber( elem, value, extra ?
				augmentWidthOrHeight(
					elem,
					name,
					extra,
					jQuery.support.boxSizing && jQuery.css( elem, "boxSizing" ) === "border-box"
				) : 0
			);
		}
	};
});

if ( !jQuery.support.opacity ) {
	jQuery.cssHooks.opacity = {
		get: function( elem, computed ) {
			// IE uses filters for opacity
			return ropacity.test( (computed && elem.currentStyle ? elem.currentStyle.filter : elem.style.filter) || "" ) ?
				( 0.01 * parseFloat( RegExp.$1 ) ) + "" :
				computed ? "1" : "";
		},

		set: function( elem, value ) {
			var style = elem.style,
				currentStyle = elem.currentStyle,
				opacity = jQuery.isNumeric( value ) ? "alpha(opacity=" + value * 100 + ")" : "",
				filter = currentStyle && currentStyle.filter || style.filter || "";

			// IE has trouble with opacity if it does not have layout
			// Force it by setting the zoom level
			style.zoom = 1;

			// if setting opacity to 1, and no other filters exist - attempt to remove filter attribute #6652
			if ( value >= 1 && jQuery.trim( filter.replace( ralpha, "" ) ) === "" &&
				style.removeAttribute ) {

				// Setting style.filter to null, "" & " " still leave "filter:" in the cssText
				// if "filter:" is present at all, clearType is disabled, we want to avoid this
				// style.removeAttribute is IE Only, but so apparently is this code path...
				style.removeAttribute( "filter" );

				// if there there is no filter style applied in a css rule, we are done
				if ( currentStyle && !currentStyle.filter ) {
					return;
				}
			}

			// otherwise, set new filter values
			style.filter = ralpha.test( filter ) ?
				filter.replace( ralpha, opacity ) :
				filter + " " + opacity;
		}
	};
}

// These hooks cannot be added until DOM ready because the support test
// for it is not run until after DOM ready
jQuery(function() {
	if ( !jQuery.support.reliableMarginRight ) {
		jQuery.cssHooks.marginRight = {
			get: function( elem, computed ) {
				// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
				// Work around by temporarily setting element display to inline-block
				return jQuery.swap( elem, { "display": "inline-block" }, function() {
					if ( computed ) {
						return curCSS( elem, "marginRight" );
					}
				});
			}
		};
	}

	// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
	// getComputedStyle returns percent when specified for top/left/bottom/right
	// rather than make the css module depend on the offset module, we just check for it here
	if ( !jQuery.support.pixelPosition && jQuery.fn.position ) {
		jQuery.each( [ "top", "left" ], function( i, prop ) {
			jQuery.cssHooks[ prop ] = {
				get: function( elem, computed ) {
					if ( computed ) {
						var ret = curCSS( elem, prop );
						// if curCSS returns percentage, fallback to offset
						return rnumnonpx.test( ret ) ? jQuery( elem ).position()[ prop ] + "px" : ret;
					}
				}
			};
		});
	}

});

if ( jQuery.expr && jQuery.expr.filters ) {
	jQuery.expr.filters.hidden = function( elem ) {
		return ( elem.offsetWidth === 0 && elem.offsetHeight === 0 ) || (!jQuery.support.reliableHiddenOffsets && ((elem.style && elem.style.display) || curCSS( elem, "display" )) === "none");
	};

	jQuery.expr.filters.visible = function( elem ) {
		return !jQuery.expr.filters.hidden( elem );
	};
}

// These hooks are used by animate to expand properties
jQuery.each({
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i,

				// assumes a single number if not a string
				parts = typeof value === "string" ? value.split(" ") : [ value ],
				expanded = {};

			for ( i = 0; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( !rmargin.test( prefix ) ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
});
var r20 = /%20/g,
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rinput = /^(?:color|date|datetime|datetime-local|email|hidden|month|number|password|range|search|tel|text|time|url|week)$/i,
	rselectTextarea = /^(?:select|textarea)/i;

jQuery.fn.extend({
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map(function(){
			return this.elements ? jQuery.makeArray( this.elements ) : this;
		})
		.filter(function(){
			return this.name && !this.disabled &&
				( this.checked || rselectTextarea.test( this.nodeName ) ||
					rinput.test( this.type ) );
		})
		.map(function( i, elem ){
			var val = jQuery( this ).val();

			return val == null ?
				null :
				jQuery.isArray( val ) ?
					jQuery.map( val, function( val, i ){
						return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					}) :
					{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		}).get();
	}
});

//Serialize an array of form elements or a set of
//key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, value ) {
			// If value is a function, invoke it and return its value
			value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
			s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
		};

	// Set traditional to true for jQuery <= 1.3.2 behavior.
	if ( traditional === undefined ) {
		traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {
		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		});

	} else {
		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" ).replace( r20, "+" );
};

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( jQuery.isArray( obj ) ) {
		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {
				// Treat each array item as a scalar.
				add( prefix, v );

			} else {
				// If array item is non-scalar (array or object), encode its
				// numeric index to resolve deserialization ambiguity issues.
				// Note that rack (as of 1.0.0) can't currently deserialize
				// nested arrays properly, and attempting to do so may cause
				// a server error. Possible fixes are to modify rack's
				// deserialization algorithm or to provide an option or flag
				// to force array serialization to be shallow.
				buildParams( prefix + "[" + ( typeof v === "object" ? i : "" ) + "]", v, traditional, add );
			}
		});

	} else if ( !traditional && jQuery.type( obj ) === "object" ) {
		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {
		// Serialize scalar item.
		add( prefix, obj );
	}
}
var
	// Document location
	ajaxLocParts,
	ajaxLocation,

	rhash = /#.*$/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)\r?$/mg, // IE leaves an \r character at EOL
	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app\-storage|.+\-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,
	rquery = /\?/,
	rscript = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
	rts = /([?&])_=[^&]*/,
	rurl = /^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,

	// Keep a copy of the old load method
	_load = jQuery.fn.load,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = ["*/"] + ["*"];

// #8138, IE may throw an exception when accessing
// a field from window.location if document.domain has been set
try {
	ajaxLocation = location.href;
} catch( e ) {
	// Use the href attribute of an A element
	// since IE will modify it given document.location
	ajaxLocation = document.createElement( "a" );
	ajaxLocation.href = "";
	ajaxLocation = ajaxLocation.href;
}

// Segment location into parts
ajaxLocParts = rurl.exec( ajaxLocation.toLowerCase() ) || [];

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType, list, placeBefore,
			dataTypes = dataTypeExpression.toLowerCase().split( core_rspace ),
			i = 0,
			length = dataTypes.length;

		if ( jQuery.isFunction( func ) ) {
			// For each dataType in the dataTypeExpression
			for ( ; i < length; i++ ) {
				dataType = dataTypes[ i ];
				// We control if we're asked to add before
				// any existing element
				placeBefore = /^\+/.test( dataType );
				if ( placeBefore ) {
					dataType = dataType.substr( 1 ) || "*";
				}
				list = structure[ dataType ] = structure[ dataType ] || [];
				// then we add to the structure accordingly
				list[ placeBefore ? "unshift" : "push" ]( func );
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR,
		dataType /* internal */, inspected /* internal */ ) {

	dataType = dataType || options.dataTypes[ 0 ];
	inspected = inspected || {};

	inspected[ dataType ] = true;

	var selection,
		list = structure[ dataType ],
		i = 0,
		length = list ? list.length : 0,
		executeOnly = ( structure === prefilters );

	for ( ; i < length && ( executeOnly || !selection ); i++ ) {
		selection = list[ i ]( options, originalOptions, jqXHR );
		// If we got redirected to another dataType
		// we try there if executing only and not done already
		if ( typeof selection === "string" ) {
			if ( !executeOnly || inspected[ selection ] ) {
				selection = undefined;
			} else {
				options.dataTypes.unshift( selection );
				selection = inspectPrefiltersOrTransports(
						structure, options, originalOptions, jqXHR, selection, inspected );
			}
		}
	}
	// If we're only executing or nothing was selected
	// we try the catchall dataType if not done already
	if ( ( executeOnly || !selection ) && !inspected[ "*" ] ) {
		selection = inspectPrefiltersOrTransports(
				structure, options, originalOptions, jqXHR, "*", inspected );
	}
	// unnecessary when only executing (prefilters)
	// but it'll be ignored by the caller in that case
	return selection;
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var key, deep,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};
	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || ( deep = {} ) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}
}

jQuery.fn.load = function( url, params, callback ) {
	if ( typeof url !== "string" && _load ) {
		return _load.apply( this, arguments );
	}

	// Don't do a request if no elements are being requested
	if ( !this.length ) {
		return this;
	}

	var selector, type, response,
		self = this,
		off = url.indexOf(" ");

	if ( off >= 0 ) {
		selector = url.slice( off, url.length );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( jQuery.isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// Request the remote document
	jQuery.ajax({
		url: url,

		// if "type" variable is undefined, then "GET" method will be used
		type: type,
		dataType: "html",
		data: params,
		complete: function( jqXHR, status ) {
			if ( callback ) {
				self.each( callback, response || [ jqXHR.responseText, status, jqXHR ] );
			}
		}
	}).done(function( responseText ) {

		// Save response for use in complete callback
		response = arguments;

		// See if a selector was specified
		self.html( selector ?

			// Create a dummy div to hold the results
			jQuery("<div>")

				// inject the contents of the document in, removing the scripts
				// to avoid any 'Permission Denied' errors in IE
				.append( responseText.replace( rscript, "" ) )

				// Locate the specified elements
				.find( selector ) :

			// If not, just inject the full result
			responseText );

	});

	return this;
};

// Attach a bunch of functions for handling common AJAX events
jQuery.each( "ajaxStart ajaxStop ajaxComplete ajaxError ajaxSuccess ajaxSend".split( " " ), function( i, o ){
	jQuery.fn[ o ] = function( f ){
		return this.on( o, f );
	};
});

jQuery.each( [ "get", "post" ], function( i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {
		// shift arguments if data argument was omitted
		if ( jQuery.isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		return jQuery.ajax({
			type: method,
			url: url,
			data: data,
			success: callback,
			dataType: type
		});
	};
});

jQuery.extend({

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		if ( settings ) {
			// Building a settings object
			ajaxExtend( target, jQuery.ajaxSettings );
		} else {
			// Extending ajaxSettings
			settings = target;
			target = jQuery.ajaxSettings;
		}
		ajaxExtend( target, settings );
		return target;
	},

	ajaxSettings: {
		url: ajaxLocation,
		isLocal: rlocalProtocol.test( ajaxLocParts[ 1 ] ),
		global: true,
		type: "GET",
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",
		processData: true,
		async: true,
		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			xml: "application/xml, text/xml",
			html: "text/html",
			text: "text/plain",
			json: "application/json, text/javascript",
			"*": allTypes
		},

		contents: {
			xml: /xml/,
			html: /html/,
			json: /json/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText"
		},

		// List of data converters
		// 1) key format is "source_type destination_type" (a single space in-between)
		// 2) the catchall symbol "*" can be used for source_type
		converters: {

			// Convert anything to text
			"* text": window.String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": jQuery.parseJSON,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			context: true,
			url: true
		}
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var // ifModified key
			ifModifiedKey,
			// Response headers
			responseHeadersString,
			responseHeaders,
			// transport
			transport,
			// timeout handle
			timeoutTimer,
			// Cross-domain detection vars
			parts,
			// To know if global events are to be dispatched
			fireGlobals,
			// Loop variable
			i,
			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),
			// Callbacks context
			callbackContext = s.context || s,
			// Context for global events
			// It's the callbackContext if one was provided in the options
			// and if it's a DOM node or a jQuery collection
			globalEventContext = callbackContext !== s &&
				( callbackContext.nodeType || callbackContext instanceof jQuery ) ?
						jQuery( callbackContext ) : jQuery.event,
			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks( "once memory" ),
			// Status-dependent callbacks
			statusCode = s.statusCode || {},
			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},
			// The jqXHR state
			state = 0,
			// Default abort message
			strAbort = "canceled",
			// Fake xhr
			jqXHR = {

				readyState: 0,

				// Caches the header
				setRequestHeader: function( name, value ) {
					if ( !state ) {
						var lname = name.toLowerCase();
						name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Raw string
				getAllResponseHeaders: function() {
					return state === 2 ? responseHeadersString : null;
				},

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( state === 2 ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while( ( match = rheaders.exec( responseHeadersString ) ) ) {
								responseHeaders[ match[1].toLowerCase() ] = match[ 2 ];
							}
						}
						match = responseHeaders[ key.toLowerCase() ];
					}
					return match === undefined ? null : match;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( !state ) {
						s.mimeType = type;
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					statusText = statusText || strAbort;
					if ( transport ) {
						transport.abort( statusText );
					}
					done( 0, statusText );
					return this;
				}
			};

		// Callback for when everything is done
		// It is defined here because jslint complains if it is declared
		// at the end of the function (which would be more logical and readable)
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Called once
			if ( state === 2 ) {
				return;
			}

			// State is "done" now
			state = 2;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// If successful, handle type chaining
			if ( status >= 200 && status < 300 || status === 304 ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {

					modified = jqXHR.getResponseHeader("Last-Modified");
					if ( modified ) {
						jQuery.lastModified[ ifModifiedKey ] = modified;
					}
					modified = jqXHR.getResponseHeader("Etag");
					if ( modified ) {
						jQuery.etag[ ifModifiedKey ] = modified;
					}
				}

				// If not modified
				if ( status === 304 ) {

					statusText = "notmodified";
					isSuccess = true;

				// If we have data
				} else {

					isSuccess = ajaxConvert( s, response );
					statusText = isSuccess.state;
					success = isSuccess.data;
					error = isSuccess.error;
					isSuccess = !error;
				}
			} else {
				// We extract error from statusText
				// then normalize statusText and status for non-aborts
				error = statusText;
				if ( !statusText || status ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajax" + ( isSuccess ? "Success" : "Error" ),
						[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );
				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger( "ajaxStop" );
				}
			}
		}

		// Attach deferreds
		deferred.promise( jqXHR );
		jqXHR.success = jqXHR.done;
		jqXHR.error = jqXHR.fail;
		jqXHR.complete = completeDeferred.add;

		// Status-dependent callbacks
		jqXHR.statusCode = function( map ) {
			if ( map ) {
				var tmp;
				if ( state < 2 ) {
					for ( tmp in map ) {
						statusCode[ tmp ] = [ statusCode[tmp], map[tmp] ];
					}
				} else {
					tmp = map[ jqXHR.status ];
					jqXHR.always( tmp );
				}
			}
			return this;
		};

		// Remove hash character (#7531: and string promotion)
		// Add protocol if not provided (#5866: IE7 issue with protocol-less urls)
		// We also use the url parameter if available
		s.url = ( ( url || s.url ) + "" ).replace( rhash, "" ).replace( rprotocol, ajaxLocParts[ 1 ] + "//" );

		// Extract dataTypes list
		s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().split( core_rspace );

		// A cross-domain request is in order when we have a protocol:host:port mismatch
		if ( s.crossDomain == null ) {
			parts = rurl.exec( s.url.toLowerCase() );
			s.crossDomain = !!( parts &&
				( parts[ 1 ] !== ajaxLocParts[ 1 ] || parts[ 2 ] !== ajaxLocParts[ 2 ] ||
					( parts[ 3 ] || ( parts[ 1 ] === "http:" ? 80 : 443 ) ) !=
						( ajaxLocParts[ 3 ] || ( ajaxLocParts[ 1 ] === "http:" ? 80 : 443 ) ) )
			);
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( state === 2 ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		fireGlobals = s.global;

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger( "ajaxStart" );
		}

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// If data is available, append data to url
			if ( s.data ) {
				s.url += ( rquery.test( s.url ) ? "&" : "?" ) + s.data;
				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Get ifModifiedKey before adding the anti-cache parameter
			ifModifiedKey = s.url;

			// Add anti-cache in url if needed
			if ( s.cache === false ) {

				var ts = jQuery.now(),
					// try replacing _= if it is there
					ret = s.url.replace( rts, "$1_=" + ts );

				// if nothing was replaced, add timestamp to the end
				s.url = ret + ( ( ret === s.url ) ? ( rquery.test( s.url ) ? "&" : "?" ) + "_=" + ts : "" );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			ifModifiedKey = ifModifiedKey || s.url;
			if ( jQuery.lastModified[ ifModifiedKey ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ ifModifiedKey ] );
			}
			if ( jQuery.etag[ ifModifiedKey ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ ifModifiedKey ] );
			}
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[0] ] ?
				s.accepts[ s.dataTypes[0] ] + ( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend && ( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {
				// Abort if not done already and return
				return jqXHR.abort();

		}

		// aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		for ( i in { success: 1, error: 1, complete: 1 } ) {
			jqXHR[ i ]( s[ i ] );
		}

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;
			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}
			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = setTimeout( function(){
					jqXHR.abort( "timeout" );
				}, s.timeout );
			}

			try {
				state = 1;
				transport.send( requestHeaders, done );
			} catch (e) {
				// Propagate exception as error if not done
				if ( state < 2 ) {
					done( -1, e );
				// Simply rethrow otherwise
				} else {
					throw e;
				}
			}
		}

		return jqXHR;
	},

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {}

});

/* Handles responses to an ajax request:
 * - sets all responseXXX fields accordingly
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {

	var ct, type, finalDataType, firstDataType,
		contents = s.contents,
		dataTypes = s.dataTypes,
		responseFields = s.responseFields;

	// Fill responseXXX fields
	for ( type in responseFields ) {
		if ( type in responses ) {
			jqXHR[ responseFields[type] ] = responses[ type ];
		}
	}

	// Remove auto dataType and get content-type in the process
	while( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader( "content-type" );
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {
		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[0] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}
		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

// Chain conversions given the request and the original response
function ajaxConvert( s, response ) {

	var conv, conv2, current, tmp,
		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice(),
		prev = dataTypes[ 0 ],
		converters = {},
		i = 0;

	// Apply the dataFilter if provided
	if ( s.dataFilter ) {
		response = s.dataFilter( response, s.dataType );
	}

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	// Convert to each sequential dataType, tolerating list modification
	for ( ; (current = dataTypes[++i]); ) {

		// There's only work to do if current dataType is non-auto
		if ( current !== "*" ) {

			// Convert response if prev dataType is non-auto and differs from current
			if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split(" ");
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {
								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.splice( i--, 0, current );
								}

								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s["throws"] ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return { state: "parsererror", error: conv ? e : "No conversion from " + prev + " to " + current };
						}
					}
				}
			}

			// Update prev for next iteration
			prev = current;
		}
	}

	return { state: "success", data: response };
}
var oldCallbacks = [],
	rquestion = /\?/,
	rjsonp = /(=)\?(?=&|$)|\?\?/,
	nonce = jQuery.now();

// Default jsonp settings
jQuery.ajaxSetup({
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( nonce++ ) );
		this[ callback ] = true;
		return callback;
	}
});

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		data = s.data,
		url = s.url,
		hasCallback = s.jsonp !== false,
		replaceInUrl = hasCallback && rjsonp.test( url ),
		replaceInData = hasCallback && !replaceInUrl && typeof data === "string" &&
			!( s.contentType || "" ).indexOf("application/x-www-form-urlencoded") &&
			rjsonp.test( data );

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( s.dataTypes[ 0 ] === "jsonp" || replaceInUrl || replaceInData ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;
		overwritten = window[ callbackName ];

		// Insert callback into url or form data
		if ( replaceInUrl ) {
			s.url = url.replace( rjsonp, "$1" + callbackName );
		} else if ( replaceInData ) {
			s.data = data.replace( rjsonp, "$1" + callbackName );
		} else if ( hasCallback ) {
			s.url += ( rquestion.test( url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters["script json"] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always(function() {
			// Restore preexisting value
			window[ callbackName ] = overwritten;

			// Save back as free
			if ( s[ callbackName ] ) {
				// make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && jQuery.isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		});

		// Delegate to script
		return "script";
	}
});
// Install script dataType
jQuery.ajaxSetup({
	accepts: {
		script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /javascript|ecmascript/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
});

// Handle cache's special case and global
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
		s.global = false;
	}
});

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function(s) {

	// This transport only deals with cross domain requests
	if ( s.crossDomain ) {

		var script,
			head = document.head || document.getElementsByTagName( "head" )[0] || document.documentElement;

		return {

			send: function( _, callback ) {

				script = document.createElement( "script" );

				script.async = "async";

				if ( s.scriptCharset ) {
					script.charset = s.scriptCharset;
				}

				script.src = s.url;

				// Attach handlers for all browsers
				script.onload = script.onreadystatechange = function( _, isAbort ) {

					if ( isAbort || !script.readyState || /loaded|complete/.test( script.readyState ) ) {

						// Handle memory leak in IE
						script.onload = script.onreadystatechange = null;

						// Remove the script
						if ( head && script.parentNode ) {
							head.removeChild( script );
						}

						// Dereference the script
						script = undefined;

						// Callback if not abort
						if ( !isAbort ) {
							callback( 200, "success" );
						}
					}
				};
				// Use insertBefore instead of appendChild  to circumvent an IE6 bug.
				// This arises when a base node is used (#2709 and #4378).
				head.insertBefore( script, head.firstChild );
			},

			abort: function() {
				if ( script ) {
					script.onload( 0, 1 );
				}
			}
		};
	}
});
var xhrCallbacks,
	// #5280: Internet Explorer will keep connections alive if we don't abort on unload
	xhrOnUnloadAbort = window.ActiveXObject ? function() {
		// Abort all pending requests
		for ( var key in xhrCallbacks ) {
			xhrCallbacks[ key ]( 0, 1 );
		}
	} : false,
	xhrId = 0;

// Functions to create xhrs
function createStandardXHR() {
	try {
		return new window.XMLHttpRequest();
	} catch( e ) {}
}

function createActiveXHR() {
	try {
		return new window.ActiveXObject( "Microsoft.XMLHTTP" );
	} catch( e ) {}
}

// Create the request object
// (This is still attached to ajaxSettings for backward compatibility)
jQuery.ajaxSettings.xhr = window.ActiveXObject ?
	/* Microsoft failed to properly
	 * implement the XMLHttpRequest in IE7 (can't request local files),
	 * so we use the ActiveXObject when it is available
	 * Additionally XMLHttpRequest can be disabled in IE7/IE8 so
	 * we need a fallback.
	 */
	function() {
		return !this.isLocal && createStandardXHR() || createActiveXHR();
	} :
	// For all other browsers, use the standard XMLHttpRequest object
	createStandardXHR;

// Determine support properties
(function( xhr ) {
	jQuery.extend( jQuery.support, {
		ajax: !!xhr,
		cors: !!xhr && ( "withCredentials" in xhr )
	});
})( jQuery.ajaxSettings.xhr() );

// Create transport if the browser can provide an xhr
if ( jQuery.support.ajax ) {

	jQuery.ajaxTransport(function( s ) {
		// Cross domain only allowed if supported through XMLHttpRequest
		if ( !s.crossDomain || jQuery.support.cors ) {

			var callback;

			return {
				send: function( headers, complete ) {

					// Get a new xhr
					var handle, i,
						xhr = s.xhr();

					// Open the socket
					// Passing null username, generates a login popup on Opera (#2865)
					if ( s.username ) {
						xhr.open( s.type, s.url, s.async, s.username, s.password );
					} else {
						xhr.open( s.type, s.url, s.async );
					}

					// Apply custom fields if provided
					if ( s.xhrFields ) {
						for ( i in s.xhrFields ) {
							xhr[ i ] = s.xhrFields[ i ];
						}
					}

					// Override mime type if needed
					if ( s.mimeType && xhr.overrideMimeType ) {
						xhr.overrideMimeType( s.mimeType );
					}

					// X-Requested-With header
					// For cross-domain requests, seeing as conditions for a preflight are
					// akin to a jigsaw puzzle, we simply never set it to be sure.
					// (it can always be set on a per-request basis or even using ajaxSetup)
					// For same-domain requests, won't change header if already provided.
					if ( !s.crossDomain && !headers["X-Requested-With"] ) {
						headers[ "X-Requested-With" ] = "XMLHttpRequest";
					}

					// Need an extra try/catch for cross domain requests in Firefox 3
					try {
						for ( i in headers ) {
							xhr.setRequestHeader( i, headers[ i ] );
						}
					} catch( _ ) {}

					// Do send the request
					// This may raise an exception which is actually
					// handled in jQuery.ajax (so no try/catch here)
					xhr.send( ( s.hasContent && s.data ) || null );

					// Listener
					callback = function( _, isAbort ) {

						var status,
							statusText,
							responseHeaders,
							responses,
							xml;

						// Firefox throws exceptions when accessing properties
						// of an xhr when a network error occurred
						// http://helpful.knobs-dials.com/index.php/Component_returned_failure_code:_0x80040111_(NS_ERROR_NOT_AVAILABLE)
						try {

							// Was never called and is aborted or complete
							if ( callback && ( isAbort || xhr.readyState === 4 ) ) {

								// Only called once
								callback = undefined;

								// Do not keep as active anymore
								if ( handle ) {
									xhr.onreadystatechange = jQuery.noop;
									if ( xhrOnUnloadAbort ) {
										delete xhrCallbacks[ handle ];
									}
								}

								// If it's an abort
								if ( isAbort ) {
									// Abort it manually if needed
									if ( xhr.readyState !== 4 ) {
										xhr.abort();
									}
								} else {
									status = xhr.status;
									responseHeaders = xhr.getAllResponseHeaders();
									responses = {};
									xml = xhr.responseXML;

									// Construct response list
									if ( xml && xml.documentElement /* #4958 */ ) {
										responses.xml = xml;
									}

									// When requesting binary data, IE6-9 will throw an exception
									// on any attempt to access responseText (#11426)
									try {
										responses.text = xhr.responseText;
									} catch( e ) {
									}

									// Firefox throws an exception when accessing
									// statusText for faulty cross-domain requests
									try {
										statusText = xhr.statusText;
									} catch( e ) {
										// We normalize with Webkit giving an empty statusText
										statusText = "";
									}

									// Filter status for non standard behaviors

									// If the request is local and we have data: assume a success
									// (success with no data won't get notified, that's the best we
									// can do given current implementations)
									if ( !status && s.isLocal && !s.crossDomain ) {
										status = responses.text ? 200 : 404;
									// IE - #1450: sometimes returns 1223 when it should be 204
									} else if ( status === 1223 ) {
										status = 204;
									}
								}
							}
						} catch( firefoxAccessException ) {
							if ( !isAbort ) {
								complete( -1, firefoxAccessException );
							}
						}

						// Call complete if needed
						if ( responses ) {
							complete( status, statusText, responses, responseHeaders );
						}
					};

					if ( !s.async ) {
						// if we're in sync mode we fire the callback
						callback();
					} else if ( xhr.readyState === 4 ) {
						// (IE6 & IE7) if it's in cache and has been
						// retrieved directly we need to fire the callback
						setTimeout( callback, 0 );
					} else {
						handle = ++xhrId;
						if ( xhrOnUnloadAbort ) {
							// Create the active xhrs callbacks list if needed
							// and attach the unload handler
							if ( !xhrCallbacks ) {
								xhrCallbacks = {};
								jQuery( window ).unload( xhrOnUnloadAbort );
							}
							// Add to list of active xhrs callbacks
							xhrCallbacks[ handle ] = callback;
						}
						xhr.onreadystatechange = callback;
					}
				},

				abort: function() {
					if ( callback ) {
						callback(0,1);
					}
				}
			};
		}
	});
}
var fxNow, timerId,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rfxnum = new RegExp( "^(?:([-+])=|)(" + core_pnum + ")([a-z%]*)$", "i" ),
	rrun = /queueHooks$/,
	animationPrefilters = [ defaultPrefilter ],
	tweeners = {
		"*": [function( prop, value ) {
			var end, unit,
				tween = this.createTween( prop, value ),
				parts = rfxnum.exec( value ),
				target = tween.cur(),
				start = +target || 0,
				scale = 1,
				maxIterations = 20;

			if ( parts ) {
				end = +parts[2];
				unit = parts[3] || ( jQuery.cssNumber[ prop ] ? "" : "px" );

				// We need to compute starting value
				if ( unit !== "px" && start ) {
					// Iteratively approximate from a nonzero starting point
					// Prefer the current property, because this process will be trivial if it uses the same units
					// Fallback to end or a simple constant
					start = jQuery.css( tween.elem, prop, true ) || end || 1;

					do {
						// If previous iteration zeroed out, double until we get *something*
						// Use a string for doubling factor so we don't accidentally see scale as unchanged below
						scale = scale || ".5";

						// Adjust and apply
						start = start / scale;
						jQuery.style( tween.elem, prop, start + unit );

					// Update scale, tolerating zero or NaN from tween.cur()
					// And breaking the loop if scale is unchanged or perfect, or if we've just had enough
					} while ( scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations );
				}

				tween.unit = unit;
				tween.start = start;
				// If a +=/-= token was provided, we're doing a relative animation
				tween.end = parts[1] ? start + ( parts[1] + 1 ) * end : end;
			}
			return tween;
		}]
	};

// Animations created synchronously will run synchronously
function createFxNow() {
	setTimeout(function() {
		fxNow = undefined;
	}, 0 );
	return ( fxNow = jQuery.now() );
}

function createTweens( animation, props ) {
	jQuery.each( props, function( prop, value ) {
		var collection = ( tweeners[ prop ] || [] ).concat( tweeners[ "*" ] ),
			index = 0,
			length = collection.length;
		for ( ; index < length; index++ ) {
			if ( collection[ index ].call( animation, prop, value ) ) {

				// we're done with this property
				return;
			}
		}
	});
}

function Animation( elem, properties, options ) {
	var result,
		index = 0,
		tweenerIndex = 0,
		length = animationPrefilters.length,
		deferred = jQuery.Deferred().always( function() {
			// don't match elem in the :animated selector
			delete tick.elem;
		}),
		tick = function() {
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),
				// archaic crash bug won't allow us to use 1 - ( 0.5 || 0 ) (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length ; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ]);

			if ( percent < 1 && length ) {
				return remaining;
			} else {
				deferred.resolveWith( elem, [ animation ] );
				return false;
			}
		},
		animation = deferred.promise({
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, { specialEasing: {} }, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end, easing ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,
					// if we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;

				for ( ; index < length ; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// resolve when we played the last frame
				// otherwise, reject
				if ( gotoEnd ) {
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		}),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length ; index++ ) {
		result = animationPrefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			return result;
		}
	}

	createTweens( animation, props );

	if ( jQuery.isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	jQuery.fx.timer(
		jQuery.extend( tick, {
			anim: animation,
			queue: animation.opts.queue,
			elem: elem
		})
	);

	// attach callbacks from options
	return animation.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = jQuery.camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( jQuery.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// not quite $.extend, this wont overwrite keys already present.
			// also - reusing 'index' from above because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

jQuery.Animation = jQuery.extend( Animation, {

	tweener: function( props, callback ) {
		if ( jQuery.isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.split(" ");
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length ; index++ ) {
			prop = props[ index ];
			tweeners[ prop ] = tweeners[ prop ] || [];
			tweeners[ prop ].unshift( callback );
		}
	},

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			animationPrefilters.unshift( callback );
		} else {
			animationPrefilters.push( callback );
		}
	}
});

function defaultPrefilter( elem, props, opts ) {
	var index, prop, value, length, dataShow, toggle, tween, hooks, oldfire,
		anim = this,
		style = elem.style,
		orig = {},
		handled = [],
		hidden = elem.nodeType && isHidden( elem );

	// handle queue: false promises
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always(function() {
			// doing this makes sure that the complete handler will be called
			// before this completes
			anim.always(function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			});
		});
	}

	// height/width overflow pass
	if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {
		// Make sure that nothing sneaks out
		// Record all 3 overflow attributes because IE does not
		// change the overflow attribute when overflowX and
		// overflowY are set to the same value
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Set display property to inline-block for height/width
		// animations on inline elements that are having width/height animated
		if ( jQuery.css( elem, "display" ) === "inline" &&
				jQuery.css( elem, "float" ) === "none" ) {

			// inline-level elements accept inline-block;
			// block-level elements need to be inline with layout
			if ( !jQuery.support.inlineBlockNeedsLayout || css_defaultDisplay( elem.nodeName ) === "inline" ) {
				style.display = "inline-block";

			} else {
				style.zoom = 1;
			}
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		if ( !jQuery.support.shrinkWrapBlocks ) {
			anim.done(function() {
				style.overflow = opts.overflow[ 0 ];
				style.overflowX = opts.overflow[ 1 ];
				style.overflowY = opts.overflow[ 2 ];
			});
		}
	}


	// show/hide pass
	for ( index in props ) {
		value = props[ index ];
		if ( rfxtypes.exec( value ) ) {
			delete props[ index ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {
				continue;
			}
			handled.push( index );
		}
	}

	length = handled.length;
	if ( length ) {
		dataShow = jQuery._data( elem, "fxshow" ) || jQuery._data( elem, "fxshow", {} );
		if ( "hidden" in dataShow ) {
			hidden = dataShow.hidden;
		}

		// store state if its toggle - enables .stop().toggle() to "reverse"
		if ( toggle ) {
			dataShow.hidden = !hidden;
		}
		if ( hidden ) {
			jQuery( elem ).show();
		} else {
			anim.done(function() {
				jQuery( elem ).hide();
			});
		}
		anim.done(function() {
			var prop;
			jQuery.removeData( elem, "fxshow", true );
			for ( prop in orig ) {
				jQuery.style( elem, prop, orig[ prop ] );
			}
		});
		for ( index = 0 ; index < length ; index++ ) {
			prop = handled[ index ];
			tween = anim.createTween( prop, hidden ? dataShow[ prop ] : 0 );
			orig[ prop ] = dataShow[ prop ] || jQuery.style( elem, prop );

			if ( !( prop in dataShow ) ) {
				dataShow[ prop ] = tween.start;
				if ( hidden ) {
					tween.end = tween.start;
					tween.start = prop === "width" || prop === "height" ? 1 : 0;
				}
			}
		}
	}
}

function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || "swing";
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			if ( tween.elem[ tween.prop ] != null &&
				(!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
				return tween.elem[ tween.prop ];
			}

			// passing any value as a 4th parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails
			// so, simple values such as "10px" are parsed to Float.
			// complex values such as "rotate(1rad)" are returned as is.
			result = jQuery.css( tween.elem, tween.prop, false, "" );
			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {
			// use step hook for back compat - use cssHook if its there - use .style if its
			// available and use plain properties where available
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Remove in 2.0 - this supports IE8's panic based approach
// to setting things on disconnected nodes

Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.each([ "toggle", "show", "hide" ], function( i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ||
			// special check for .toggle( handler, handler, ... )
			( !i && jQuery.isFunction( speed ) && jQuery.isFunction( easing ) ) ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
});

jQuery.fn.extend({
	fadeTo: function( speed, to, easing, callback ) {

		// show any hidden elements after setting opacity to 0
		return this.filter( isHidden ).css( "opacity", 0 ).show()

			// animate to the value specified
			.end().animate({ opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {
				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations resolve immediately
				if ( empty ) {
					anim.stop( true );
				}
			};

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue && type !== false ) {
			this.queue( type || "fx", [] );
		}

		return this.each(function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = jQuery._data( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && (type == null || timers[ index ].queue === type) ) {
					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// start the next in the queue if the last step wasn't forced
			// timers currently will call their complete callbacks, which will dequeue
			// but only if they were gotoEnd
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		});
	}
});

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		attrs = { height: type },
		i = 0;

	// if we include width, step value is 1 to do all cssExpand values,
	// if we don't include width, step value is 2 to skip over Left and Right
	includeWidth = includeWidth? 1 : 0;
	for( ; i < 4 ; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

// Generate shortcuts for custom animations
jQuery.each({
	slideDown: genFx("show"),
	slideUp: genFx("hide"),
	slideToggle: genFx("toggle"),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
});

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			jQuery.isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
	};

	opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration :
		opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

	// normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( jQuery.isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p*Math.PI ) / 2;
	}
};

jQuery.timers = [];
jQuery.fx = Tween.prototype.init;
jQuery.fx.tick = function() {
	var timer,
		timers = jQuery.timers,
		i = 0;

	fxNow = jQuery.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];
		// Checks the timer has not already been removed
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	if ( timer() && jQuery.timers.push( timer ) && !timerId ) {
		timerId = setInterval( jQuery.fx.tick, jQuery.fx.interval );
	}
};

jQuery.fx.interval = 13;

jQuery.fx.stop = function() {
	clearInterval( timerId );
	timerId = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,
	// Default speed
	_default: 400
};

// Back Compat <1.8 extension point
jQuery.fx.step = {};

if ( jQuery.expr && jQuery.expr.filters ) {
	jQuery.expr.filters.animated = function( elem ) {
		return jQuery.grep(jQuery.timers, function( fn ) {
			return elem === fn.elem;
		}).length;
	};
}
var rroot = /^(?:body|html)$/i;

jQuery.fn.offset = function( options ) {
	if ( arguments.length ) {
		return options === undefined ?
			this :
			this.each(function( i ) {
				jQuery.offset.setOffset( this, options, i );
			});
	}

	var docElem, body, win, clientTop, clientLeft, scrollTop, scrollLeft,
		box = { top: 0, left: 0 },
		elem = this[ 0 ],
		doc = elem && elem.ownerDocument;

	if ( !doc ) {
		return;
	}

	if ( (body = doc.body) === elem ) {
		return jQuery.offset.bodyOffset( elem );
	}

	docElem = doc.documentElement;

	// Make sure it's not a disconnected DOM node
	if ( !jQuery.contains( docElem, elem ) ) {
		return box;
	}

	// If we don't have gBCR, just use 0,0 rather than error
	// BlackBerry 5, iOS 3 (original iPhone)
	if ( typeof elem.getBoundingClientRect !== "undefined" ) {
		box = elem.getBoundingClientRect();
	}
	win = getWindow( doc );
	clientTop  = docElem.clientTop  || body.clientTop  || 0;
	clientLeft = docElem.clientLeft || body.clientLeft || 0;
	scrollTop  = win.pageYOffset || docElem.scrollTop;
	scrollLeft = win.pageXOffset || docElem.scrollLeft;
	return {
		top: box.top  + scrollTop  - clientTop,
		left: box.left + scrollLeft - clientLeft
	};
};

jQuery.offset = {

	bodyOffset: function( body ) {
		var top = body.offsetTop,
			left = body.offsetLeft;

		if ( jQuery.support.doesNotIncludeMarginInBodyOffset ) {
			top  += parseFloat( jQuery.css(body, "marginTop") ) || 0;
			left += parseFloat( jQuery.css(body, "marginLeft") ) || 0;
		}

		return { top: top, left: left };
	},

	setOffset: function( elem, options, i ) {
		var position = jQuery.css( elem, "position" );

		// set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		var curElem = jQuery( elem ),
			curOffset = curElem.offset(),
			curCSSTop = jQuery.css( elem, "top" ),
			curCSSLeft = jQuery.css( elem, "left" ),
			calculatePosition = ( position === "absolute" || position === "fixed" ) && jQuery.inArray("auto", [curCSSTop, curCSSLeft]) > -1,
			props = {}, curPosition = {}, curTop, curLeft;

		// need to be able to calculate position if either top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;
		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( jQuery.isFunction( options ) ) {
			options = options.call( elem, i, curOffset );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );
		} else {
			curElem.css( props );
		}
	}
};


jQuery.fn.extend({

	position: function() {
		if ( !this[0] ) {
			return;
		}

		var elem = this[0],

		// Get *real* offsetParent
		offsetParent = this.offsetParent(),

		// Get correct offsets
		offset       = this.offset(),
		parentOffset = rroot.test(offsetParent[0].nodeName) ? { top: 0, left: 0 } : offsetParent.offset();

		// Subtract element margins
		// note: when an element has margin: auto the offsetLeft and marginLeft
		// are the same in Safari causing offset.left to incorrectly be 0
		offset.top  -= parseFloat( jQuery.css(elem, "marginTop") ) || 0;
		offset.left -= parseFloat( jQuery.css(elem, "marginLeft") ) || 0;

		// Add offsetParent borders
		parentOffset.top  += parseFloat( jQuery.css(offsetParent[0], "borderTopWidth") ) || 0;
		parentOffset.left += parseFloat( jQuery.css(offsetParent[0], "borderLeftWidth") ) || 0;

		// Subtract the two offsets
		return {
			top:  offset.top  - parentOffset.top,
			left: offset.left - parentOffset.left
		};
	},

	offsetParent: function() {
		return this.map(function() {
			var offsetParent = this.offsetParent || document.body;
			while ( offsetParent && (!rroot.test(offsetParent.nodeName) && jQuery.css(offsetParent, "position") === "static") ) {
				offsetParent = offsetParent.offsetParent;
			}
			return offsetParent || document.body;
		});
	}
});


// Create scrollLeft and scrollTop methods
jQuery.each( {scrollLeft: "pageXOffset", scrollTop: "pageYOffset"}, function( method, prop ) {
	var top = /Y/.test( prop );

	jQuery.fn[ method ] = function( val ) {
		return jQuery.access( this, function( elem, method, val ) {
			var win = getWindow( elem );

			if ( val === undefined ) {
				return win ? (prop in win) ? win[ prop ] :
					win.document.documentElement[ method ] :
					elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : jQuery( win ).scrollLeft(),
					 top ? val : jQuery( win ).scrollTop()
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length, null );
	};
});

function getWindow( elem ) {
	return jQuery.isWindow( elem ) ?
		elem :
		elem.nodeType === 9 ?
			elem.defaultView || elem.parentWindow :
			false;
}
// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name }, function( defaultExtra, funcName ) {
		// margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return jQuery.access( this, function( elem, type, value ) {
				var doc;

				if ( jQuery.isWindow( elem ) ) {
					// As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
					// isn't a whole lot we can do. See pull request at this URL for discussion:
					// https://github.com/jquery/jquery/pull/764
					return elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height], whichever is greatest
					// unfortunately, this causes bug #3838 in IE6/8 only, but there is currently no good, small way to fix it.
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?
					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, value, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable, null );
		};
	});
});
// Expose jQuery to the global object
window.jQuery = window.$ = jQuery;

// Expose jQuery as an AMD module, but only for AMD loaders that
// understand the issues with loading multiple versions of jQuery
// in a page that all might call define(). The loader will indicate
// they have special allowances for multiple jQuery versions by
// specifying define.amd.jQuery = true. Register as a named module,
// since jQuery can be concatenated with other files that may use define,
// but not use a proper concatenation script that understands anonymous
// AMD modules. A named AMD is safest and most robust way to register.
// Lowercase jquery is used because AMD module names are derived from
// file names, and jQuery is normally delivered in a lowercase file name.
// Do this after creating the global so that if an AMD module wants to call
// noConflict to hide this version of jQuery, it will work.
if ( typeof define === "function" && define.amd && define.amd.jQuery ) {
	define( "jquery", [], function () { return jQuery; } );
}

})( window );

/**
 * @license
 * Lo-Dash 1.0.0 (Custom Build) <http://lodash.com/>
 * Build: `lodash underscore -o ./dist/lodash.underscore.js`
 * Copyright 2012-2013 The Dojo Foundation <http://dojofoundation.org/>
 * Based on Underscore.js 1.4.4 <http://underscorejs.org/>
 * Copyright 2009-2013 Jeremy Ashkenas, DocumentCloud Inc.
 * Available under MIT license <http://lodash.com/license>
 */
;(function(window, undefined) {

  /** Detect free variable `exports` */
  var freeExports = typeof exports == 'object' && exports;

  /** Detect free variable `global` and use it as `window` */
  var freeGlobal = typeof global == 'object' && global;
  if (freeGlobal.global === freeGlobal) {
    window = freeGlobal;
  }

  /** Used for array and object method references */
  var arrayRef = [],
      objectRef = {};

  /** Used to generate unique IDs */
  var idCounter = 0;

  /** Used internally to indicate various things */
  var indicatorObject = objectRef;

  /** Used to restore the original `_` reference in `noConflict` */
  var oldDash = window._;

  /** Used to match HTML entities */
  var reEscapedHtml = /&(?:amp|lt|gt|quot|#39);/g;

  /** Used to match empty string literals in compiled template source */
  var reEmptyStringLeading = /\b__p \+= '';/g,
      reEmptyStringMiddle = /\b(__p \+=) '' \+/g,
      reEmptyStringTrailing = /(__e\(.*?\)|\b__t\)) \+\n'';/g;

  /** Used to match regexp flags from their coerced string values */
  var reFlags = /\w*$/;

  /** Used to detect if a method is native */
  var reNative = RegExp('^' +
    (objectRef.valueOf + '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/valueOf|for [^\]]+/g, '.+?') + '$'
  );

  /**
   * Used to match ES6 template delimiters
   * http://people.mozilla.org/~jorendorff/es6-draft.html#sec-7.8.6
   */
  var reEsTemplate = /\$\{((?:(?=\\?)\\?[\s\S])*?)\}/g;

  /** Used to match "interpolate" template delimiters */
  var reInterpolate = /<%=([\s\S]+?)%>/g;

  /** Used to ensure capturing order of template delimiters */
  var reNoMatch = /($^)/;

  /** Used to match HTML characters */
  var reUnescapedHtml = /[&<>"']/g;

  /** Used to match unescaped characters in compiled string literals */
  var reUnescapedString = /['\n\r\t\u2028\u2029\\]/g;

  /** Used to make template sourceURLs easier to identify */
  var templateCounter = 0;

  /** Native method shortcuts */
  var ceil = Math.ceil,
      concat = arrayRef.concat,
      floor = Math.floor,
      hasOwnProperty = objectRef.hasOwnProperty,
      push = arrayRef.push,
      toString = objectRef.toString;

  /* Native method shortcuts for methods with the same name as other `lodash` methods */
  var nativeBind = reNative.test(nativeBind = slice.bind) && nativeBind,
      nativeIsArray = reNative.test(nativeIsArray = Array.isArray) && nativeIsArray,
      nativeIsFinite = window.isFinite,
      nativeIsNaN = window.isNaN,
      nativeKeys = reNative.test(nativeKeys = Object.keys) && nativeKeys,
      nativeMax = Math.max,
      nativeMin = Math.min,
      nativeRandom = Math.random;

  /** `Object#toString` result shortcuts */
  var argsClass = '[object Arguments]',
      arrayClass = '[object Array]',
      boolClass = '[object Boolean]',
      dateClass = '[object Date]',
      funcClass = '[object Function]',
      numberClass = '[object Number]',
      objectClass = '[object Object]',
      regexpClass = '[object RegExp]',
      stringClass = '[object String]';

  /** Detect various environments */
  var isIeOpera = !!window.attachEvent,
      isV8 = nativeBind && !/\n|true/.test(nativeBind + isIeOpera);

  /* Detect if `Function#bind` exists and is inferred to be fast (all but V8) */
  var isBindFast = nativeBind && !isV8;

  /**
   * Detect if `Array#shift` and `Array#splice` augment array-like objects
   * incorrectly:
   *
   * Firefox < 10, IE compatibility mode, and IE < 9 have buggy Array `shift()`
   * and `splice()` functions that fail to remove the last element, `value[0]`,
   * of array-like objects even though the `length` property is set to `0`.
   * The `shift()` method is buggy in IE 8 compatibility mode, while `splice()`
   * is buggy regardless of mode in IE < 9 and buggy in compatibility mode in IE 9.
   */
  var hasObjectSpliceBug = (hasObjectSpliceBug = { '0': 1, 'length': 1 },
    arrayRef.splice.call(hasObjectSpliceBug, 0, 1), hasObjectSpliceBug[0]);

  /** Detect if `arguments` objects are `Object` objects (all but Opera < 10.5) */
  var argsAreObjects = arguments.constructor == Object;

  /** Used to determine if values are of the language type Object */
  var objectTypes = {
    'boolean': false,
    'function': true,
    'object': true,
    'number': false,
    'string': false,
    'undefined': false
  };

  /** Used to escape characters for inclusion in compiled string literals */
  var stringEscapes = {
    '\\': '\\',
    "'": "'",
    '\n': 'n',
    '\r': 'r',
    '\t': 't',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  /*--------------------------------------------------------------------------*/

  /**
   * Creates a `lodash` object, that wraps the given `value`, to enable method
   * chaining.
   *
   * In addition to Lo-Dash methods, wrappers also have the following `Array` methods:
   * `concat`, `join`, `pop`, `push`, `reverse`, `shift`, `slice`, `sort`, `splice`,
   * and `unshift`
   *
   * The chainable wrapper functions are:
   * `after`, `assign`, `bind`, `bindAll`, `bindKey`, `chain`, `compact`, `compose`,
   * `concat`, `countBy`, `debounce`, `defaults`, `defer`, `delay`, `difference`,
   * `filter`, `flatten`, `forEach`, `forIn`, `forOwn`, `functions`, `groupBy`,
   * `initial`, `intersection`, `invert`, `invoke`, `keys`, `map`, `max`, `memoize`,
   * `merge`, `min`, `object`, `omit`, `once`, `pairs`, `partial`, `partialRight`,
   * `pick`, `pluck`, `push`, `range`, `reject`, `rest`, `reverse`, `shuffle`,
   * `slice`, `sort`, `sortBy`, `splice`, `tap`, `throttle`, `times`, `toArray`,
   * `union`, `uniq`, `unshift`, `values`, `where`, `without`, `wrap`, and `zip`
   *
   * The non-chainable wrapper functions are:
   * `clone`, `cloneDeep`, `contains`, `escape`, `every`, `find`, `has`, `identity`,
   * `indexOf`, `isArguments`, `isArray`, `isBoolean`, `isDate`, `isElement`, `isEmpty`,
   * `isEqual`, `isFinite`, `isFunction`, `isNaN`, `isNull`, `isNumber`, `isObject`,
   * `isPlainObject`, `isRegExp`, `isString`, `isUndefined`, `join`, `lastIndexOf`,
   * `mixin`, `noConflict`, `pop`, `random`, `reduce`, `reduceRight`, `result`,
   * `shift`, `size`, `some`, `sortedIndex`, `template`, `unescape`, and `uniqueId`
   *
   * The wrapper functions `first` and `last` return wrapped values when `n` is
   * passed, otherwise they return unwrapped values.
   *
   * @name _
   * @constructor
   * @category Chaining
   * @param {Mixed} value The value to wrap in a `lodash` instance.
   * @returns {Object} Returns a `lodash` instance.
   */
  function lodash(value) {
    // exit early if already wrapped, even if wrapped by a different `lodash` constructor
    if (value && typeof value == 'object' && value.__wrapped__) {
      return value;
    }
    // allow invoking `lodash` without the `new` operator
    if (!(this instanceof lodash)) {
      return new lodash(value);
    }
    this.__wrapped__ = value;
  }

  /**
   * By default, the template delimiters used by Lo-Dash are similar to those in
   * embedded Ruby (ERB). Change the following template settings to use alternative
   * delimiters.
   *
   * @static
   * @memberOf _
   * @type Object
   */
  lodash.templateSettings = {

    /**
     * Used to detect `data` property values to be HTML-escaped.
     *
     * @memberOf _.templateSettings
     * @type RegExp
     */
    'escape': /<%-([\s\S]+?)%>/g,

    /**
     * Used to detect code to be evaluated.
     *
     * @memberOf _.templateSettings
     * @type RegExp
     */
    'evaluate': /<%([\s\S]+?)%>/g,

    /**
     * Used to detect `data` property values to inject.
     *
     * @memberOf _.templateSettings
     * @type RegExp
     */
    'interpolate': reInterpolate,

    /**
     * Used to reference the data object in the template text.
     *
     * @memberOf _.templateSettings
     * @type String
     */
    'variable': ''
  };

  /*--------------------------------------------------------------------------*/

  /**
   * Used by `_.max` and `_.min` as the default `callback` when a given
   * `collection` is a string value.
   *
   * @private
   * @param {String} value The character to inspect.
   * @returns {Number} Returns the code unit of given character.
   */
  function charAtCallback(value) {
    return value.charCodeAt(0);
  }

  /**
   * Used by `sortBy` to compare transformed `collection` values, stable sorting
   * them in ascending order.
   *
   * @private
   * @param {Object} a The object to compare to `b`.
   * @param {Object} b The object to compare to `a`.
   * @returns {Number} Returns the sort order indicator of `1` or `-1`.
   */
  function compareAscending(a, b) {
    var ai = a.index,
        bi = b.index;

    a = a.criteria;
    b = b.criteria;

    // ensure a stable sort in V8 and other engines
    // http://code.google.com/p/v8/issues/detail?id=90
    if (a !== b) {
      if (a > b || typeof a == 'undefined') {
        return 1;
      }
      if (a < b || typeof b == 'undefined') {
        return -1;
      }
    }
    return ai < bi ? -1 : 1;
  }

  /**
   * Creates a function that, when called, invokes `func` with the `this` binding
   * of `thisArg` and prepends any `partialArgs` to the arguments passed to the
   * bound function.
   *
   * @private
   * @param {Function|String} func The function to bind or the method name.
   * @param {Mixed} [thisArg] The `this` binding of `func`.
   * @param {Array} partialArgs An array of arguments to be partially applied.
   * @param {Object} [rightIndicator] Used to indicate partially applying arguments from the right.
   * @returns {Function} Returns the new bound function.
   */
  function createBound(func, thisArg, partialArgs, rightIndicator) {
    var isFunc = isFunction(func),
        isPartial = !partialArgs,
        key = thisArg;

    // juggle arguments
    if (isPartial) {
      partialArgs = thisArg;
    }
    if (!isFunc) {
      thisArg = func;
    }

    function bound() {
      // `Function#bind` spec
      // http://es5.github.com/#x15.3.4.5
      var args = arguments,
          thisBinding = isPartial ? this : thisArg;

      if (!isFunc) {
        func = thisArg[key];
      }
      if (partialArgs.length) {
        args = args.length
          ? (args = slice(args), rightIndicator ? args.concat(partialArgs) : partialArgs.concat(args))
          : partialArgs;
      }
      if (this instanceof bound) {
        // ensure `new bound` is an instance of `bound` and `func`
        noop.prototype = func.prototype;
        thisBinding = new noop;
        noop.prototype = null;

        // mimic the constructor's `return` behavior
        // http://es5.github.com/#x13.2.2
        var result = func.apply(thisBinding, args);
        return isObject(result) ? result : thisBinding;
      }
      return func.apply(thisBinding, args);
    }
    return bound;
  }

  /**
   * Produces a callback bound to an optional `thisArg`. If `func` is a property
   * name, the created callback will return the property value for a given element.
   * If `func` is an object, the created callback will return `true` for elements
   * that contain the equivalent object properties, otherwise it will return `false`.
   *
   * @private
   * @param {Mixed} [func=identity] The value to convert to a callback.
   * @param {Mixed} [thisArg] The `this` binding of the created callback.
   * @param {Number} [argCount=3] The number of arguments the callback accepts.
   * @returns {Function} Returns a callback function.
   */
  function createCallback(func, thisArg, argCount) {
    if (func == null) {
      return identity;
    }
    var type = typeof func;
    if (type != 'function') {
      if (type != 'object') {
        return function(object) {
          return object[func];
        };
      }
      var props = keys(func);
      return function(object) {
        var length = props.length,
            result = false;
        while (length--) {
          if (!(result = object[props[length]] === func[props[length]])) {
            break;
          }
        }
        return result;
      };
    }
    if (typeof thisArg != 'undefined') {
      if (argCount === 1) {
        return function(value) {
          return func.call(thisArg, value);
        };
      }
      if (argCount === 2) {
        return function(a, b) {
          return func.call(thisArg, a, b);
        };
      }
      if (argCount === 4) {
        return function(accumulator, value, index, object) {
          return func.call(thisArg, accumulator, value, index, object);
        };
      }
      return function(value, index, object) {
        return func.call(thisArg, value, index, object);
      };
    }
    return func;
  }

  /**
   * A function compiled to iterate `arguments` objects, arrays, objects, and
   * strings consistenly across environments, executing the `callback` for each
   * element in the `collection`. The `callback` is bound to `thisArg` and invoked
   * with three arguments; (value, index|key, collection). Callbacks may exit
   * iteration early by explicitly returning `false`.
   *
   * @private
   * @type Function
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function} [callback=identity] The function called per iteration.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array|Object|String} Returns `collection`.
   */
  var each = function (collection, callback, thisArg) {
    var index, iterable = collection, result = iterable;
    if (!iterable) return result;
    callback = callback && typeof thisArg == 'undefined' ? callback : createCallback(callback, thisArg);
    var length = iterable.length; index = -1;
    if (typeof length == 'number') {
      while (++index < length) {
        if (callback(iterable[index], index, collection) === indicatorObject) return result
      }
    }
    else {  
      for (index in iterable) {
        if (hasOwnProperty.call(iterable, index)) {    
        if (callback(iterable[index], index, collection) === indicatorObject) return result;    
        }
      }  
    }
  };

  /**
   * Used by `template` to escape characters for inclusion in compiled
   * string literals.
   *
   * @private
   * @param {String} match The matched character to escape.
   * @returns {String} Returns the escaped character.
   */
  function escapeStringChar(match) {
    return '\\' + stringEscapes[match];
  }

  /**
   * Used by `escape` to convert characters to HTML entities.
   *
   * @private
   * @param {String} match The matched character to escape.
   * @returns {String} Returns the escaped character.
   */
  function escapeHtmlChar(match) {
    return htmlEscapes[match];
  }

  /**
   * Checks if `value` is a DOM node in IE < 9.
   *
   * @private
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true` if the `value` is a DOM node, else `false`.
   */
  function isNode(value) {
    // IE < 9 presents DOM nodes as `Object` objects except they have `toString`
    // methods that are `typeof` "string" and still can coerce nodes to strings
    return typeof value.toString != 'function' && typeof (value + '') == 'string';
  }

  /**
   * A no-operation function.
   *
   * @private
   */
  function noop() {
    // no operation performed
  }

  /**
   * Slices the `collection` from the `start` index up to, but not including,
   * the `end` index.
   *
   * Note: This function is used, instead of `Array#slice`, to support node lists
   * in IE < 9 and to ensure dense arrays are returned.
   *
   * @private
   * @param {Array|Object|String} collection The collection to slice.
   * @param {Number} start The start index.
   * @param {Number} end The end index.
   * @returns {Array} Returns the new array.
   */
  function slice(array, start, end) {
    start || (start = 0);
    if (typeof end == 'undefined') {
      end = array ? array.length : 0;
    }
    var index = -1,
        length = end - start || 0,
        result = Array(length < 0 ? 0 : length);

    while (++index < length) {
      result[index] = array[start + index];
    }
    return result;
  }

  /**
   * Used by `unescape` to convert HTML entities to characters.
   *
   * @private
   * @param {String} match The matched character to unescape.
   * @returns {String} Returns the unescaped character.
   */
  function unescapeHtmlChar(match) {
    return htmlUnescapes[match];
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Checks if `value` is an `arguments` object.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is an `arguments` object, else `false`.
   * @example
   *
   * (function() { return _.isArguments(arguments); })(1, 2, 3);
   * // => true
   *
   * _.isArguments([1, 2, 3]);
   * // => false
   */
  function isArguments(value) {
    return toString.call(value) == argsClass;
  }
  // fallback for browsers that can't detect `arguments` objects by [[Class]]
  if (!isArguments(arguments)) {
    isArguments = function(value) {
      return value ? hasOwnProperty.call(value, 'callee') : false;
    };
  }

  /**
   * Iterates over `object`'s own and inherited enumerable properties, executing
   * the `callback` for each property. The `callback` is bound to `thisArg` and
   * invoked with three arguments; (value, key, object). Callbacks may exit iteration
   * early by explicitly returning `false`.
   *
   * @static
   * @memberOf _
   * @type Function
   * @category Objects
   * @param {Object} object The object to iterate over.
   * @param {Function} [callback=identity] The function called per iteration.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Object} Returns `object`.
   * @example
   *
   * function Dog(name) {
   *   this.name = name;
   * }
   *
   * Dog.prototype.bark = function() {
   *   alert('Woof, woof!');
   * };
   *
   * _.forIn(new Dog('Dagny'), function(value, key) {
   *   alert(key);
   * });
   * // => alerts 'name' and 'bark' (order is not guaranteed)
   */
  var forIn = function (collection, callback) {
    var index, iterable = collection, result = iterable;
    if (!iterable) return result;
    if (!objectTypes[typeof iterable]) return result;
    callback || (callback = identity);
    
      for (index in iterable) {
        if (callback(iterable[index], index, collection) === indicatorObject) return result;    
      }  
    return result
  };

  /**
   * Iterates over an object's own enumerable properties, executing the `callback`
   * for each property. The `callback` is bound to `thisArg` and invoked with three
   * arguments; (value, key, object). Callbacks may exit iteration early by explicitly
   * returning `false`.
   *
   * @static
   * @memberOf _
   * @type Function
   * @category Objects
   * @param {Object} object The object to iterate over.
   * @param {Function} [callback=identity] The function called per iteration.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Object} Returns `object`.
   * @example
   *
   * _.forOwn({ '0': 'zero', '1': 'one', 'length': 2 }, function(num, key) {
   *   alert(key);
   * });
   * // => alerts '0', '1', and 'length' (order is not guaranteed)
   */
  var forOwn = function (collection, callback) {
    var index, iterable = collection, result = iterable;
    if (!iterable) return result;
    if (!objectTypes[typeof iterable]) return result;
    callback || (callback = identity);
    
      for (index in iterable) {
        if (hasOwnProperty.call(iterable, index)) {    
        if (callback(iterable[index], index, collection) === indicatorObject) return result;    
        }
      }  
    return result
  };

  /**
   * Checks if `value` is an array.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is an array, else `false`.
   * @example
   *
   * (function() { return _.isArray(arguments); })();
   * // => false
   *
   * _.isArray([1, 2, 3]);
   * // => true
   */
  var isArray = nativeIsArray || function(value) {
    // `instanceof` may cause a memory leak in IE 7 if `value` is a host object
    // http://ajaxian.com/archives/working-aroung-the-instanceof-memory-leak
    return (argsAreObjects && value instanceof Array) || toString.call(value) == arrayClass;
  };

  /**
   * Creates an array composed of the own enumerable property names of `object`.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Object} object The object to inspect.
   * @returns {Array} Returns a new array of property names.
   * @example
   *
   * _.keys({ 'one': 1, 'two': 2, 'three': 3 });
   * // => ['one', 'two', 'three'] (order is not guaranteed)
   */
  var keys = !nativeKeys ? shimKeys : function(object) {
    if (!isObject(object)) {
      return [];
    }
    return nativeKeys(object);
  };

  /**
   * A fallback implementation of `isPlainObject` that checks if a given `value`
   * is an object created by the `Object` constructor, assuming objects created
   * by the `Object` constructor have no inherited enumerable properties and that
   * there are no `Object.prototype` extensions.
   *
   * @private
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if `value` is a plain object, else `false`.
   */
  function shimIsPlainObject(value) {
    // avoid non-objects and false positives for `arguments` objects
    var result = false;
    if (!(value && typeof value == 'object') || isArguments(value)) {
      return result;
    }
    // check that the constructor is `Object` (i.e. `Object instanceof Object`)
    var ctor = value.constructor;
    if ((!isFunction(ctor)) || ctor instanceof ctor) {
      // In most environments an object's own properties are iterated before
      // its inherited properties. If the last iterated property is an object's
      // own property then there are no inherited enumerable properties.
      forIn(value, function(value, key) {
        result = key;
      });
      return result === false || hasOwnProperty.call(value, result);
    }
    return result;
  }

  /**
   * A fallback implementation of `Object.keys` that produces an array of the
   * given object's own enumerable property names.
   *
   * @private
   * @param {Object} object The object to inspect.
   * @returns {Array} Returns a new array of property names.
   */
  function shimKeys(object) {
    var result = [];
    forOwn(object, function(value, key) {
      result.push(key);
    });
    return result;
  }

  /**
   * Used to convert characters to HTML entities:
   *
   * Though the `>` character is escaped for symmetry, characters like `>` and `/`
   * don't require escaping in HTML and have no special meaning unless they're part
   * of a tag or an unquoted attribute value.
   * http://mathiasbynens.be/notes/ambiguous-ampersands (under "semi-related fun fact")
   */
  var htmlEscapes = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  /** Used to convert HTML entities to characters */
  var htmlUnescapes = invert(htmlEscapes);

  /*--------------------------------------------------------------------------*/

  /**
   * Assigns own enumerable properties of source object(s) to the destination
   * object. Subsequent sources will overwrite propery assignments of previous
   * sources. If a `callback` function is passed, it will be executed to produce
   * the assigned values. The `callback` is bound to `thisArg` and invoked with
   * two arguments; (objectValue, sourceValue).
   *
   * @static
   * @memberOf _
   * @type Function
   * @alias extend
   * @category Objects
   * @param {Object} object The destination object.
   * @param {Object} [source1, source2, ...] The source objects.
   * @param {Function} [callback] The function to customize assigning values.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Object} Returns the destination object.
   * @example
   *
   * _.assign({ 'name': 'moe' }, { 'age': 40 });
   * // => { 'name': 'moe', 'age': 40 }
   *
   * var defaults = _.partialRight(_.assign, function(a, b) {
   *   return typeof a == 'undefined' ? b : a;
   * });
   *
   * var food = { 'name': 'apple' };
   * defaults(food, { 'name': 'banana', 'type': 'fruit' });
   * // => { 'name': 'apple', 'type': 'fruit' }
   */
  function assign(object) {
    if (!object) {
      return object;
    }
    for (var argsIndex = 1, argsLength = arguments.length; argsIndex < argsLength; argsIndex++) {
      var iterable = arguments[argsIndex];
      if (iterable) {
        for (var key in iterable) {
          object[key] = iterable[key];
        }
      }
    }
    return object;
  }

  /**
   * Creates a clone of `value`. If `deep` is `true`, nested objects will also
   * be cloned, otherwise they will be assigned by reference. If a `callback`
   * function is passed, it will be executed to produce the cloned values. If
   * `callback` returns `undefined`, cloning will be handled by the method instead.
   * The `callback` is bound to `thisArg` and invoked with one argument; (value).
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to clone.
   * @param {Boolean} [deep=false] A flag to indicate a deep clone.
   * @param {Function} [callback] The function to customize cloning values.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @param- {Array} [stackA=[]] Internally used to track traversed source objects.
   * @param- {Array} [stackB=[]] Internally used to associate clones with source counterparts.
   * @returns {Mixed} Returns the cloned `value`.
   * @example
   *
   * var stooges = [
   *   { 'name': 'moe', 'age': 40 },
   *   { 'name': 'larry', 'age': 50 }
   * ];
   *
   * var shallow = _.clone(stooges);
   * shallow[0] === stooges[0];
   * // => true
   *
   * var deep = _.clone(stooges, true);
   * deep[0] === stooges[0];
   * // => false
   *
   * _.mixin({
   *   'clone': _.partialRight(_.clone, function(value) {
   *     return _.isElement(value) ? value.cloneNode(false) : undefined;
   *   })
   * });
   *
   * var clone = _.clone(document.body);
   * clone.childNodes.length;
   * // => 0
   */
  function clone(value) {
    return isObject(value)
      ? (isArray(value) ? slice(value) : assign({}, value))
      : value
  }

  /**
   * Assigns own enumerable properties of source object(s) to the destination
   * object for all destination properties that resolve to `undefined`. Once a
   * property is set, additional defaults of the same property will be ignored.
   *
   * @static
   * @memberOf _
   * @type Function
   * @category Objects
   * @param {Object} object The destination object.
   * @param {Object} [source1, source2, ...] The source objects.
   * @param- {Object} [guard] Internally used to allow working with `_.reduce`
   *  without using its callback's `key` and `object` arguments as sources.
   * @returns {Object} Returns the destination object.
   * @example
   *
   * var food = { 'name': 'apple' };
   * _.defaults(food, { 'name': 'banana', 'type': 'fruit' });
   * // => { 'name': 'apple', 'type': 'fruit' }
   */
  function defaults(object) {
    if (!object) {
      return object;
    }
    for (var argsIndex = 1, argsLength = arguments.length; argsIndex < argsLength; argsIndex++) {
      var iterable = arguments[argsIndex];
      if (iterable) {
        for (var key in iterable) {
          if (object[key] == null) {
            object[key] = iterable[key];
          }
        }
      }
    }
    return object;
  }

  /**
   * Creates a sorted array of all enumerable properties, own and inherited,
   * of `object` that have function values.
   *
   * @static
   * @memberOf _
   * @alias methods
   * @category Objects
   * @param {Object} object The object to inspect.
   * @returns {Array} Returns a new array of property names that have function values.
   * @example
   *
   * _.functions(_);
   * // => ['all', 'any', 'bind', 'bindAll', 'clone', 'compact', 'compose', ...]
   */
  function functions(object) {
    var result = [];
    forIn(object, function(value, key) {
      if (isFunction(value)) {
        result.push(key);
      }
    });
    return result.sort();
  }

  /**
   * Checks if the specified object `property` exists and is a direct property,
   * instead of an inherited property.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Object} object The object to check.
   * @param {String} property The property to check for.
   * @returns {Boolean} Returns `true` if key is a direct property, else `false`.
   * @example
   *
   * _.has({ 'a': 1, 'b': 2, 'c': 3 }, 'b');
   * // => true
   */
  function has(object, property) {
    return object ? hasOwnProperty.call(object, property) : false;
  }

  /**
   * Creates an object composed of the inverted keys and values of the given `object`.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Object} object The object to invert.
   * @returns {Object} Returns the created inverted object.
   * @example
   *
   *  _.invert({ 'first': 'moe', 'second': 'larry' });
   * // => { 'moe': 'first', 'larry': 'second' } (order is not guaranteed)
   */
  function invert(object) {
    var index = -1,
        props = keys(object),
        length = props.length,
        result = {};

    while (++index < length) {
      var key = props[index];
      result[object[key]] = key;
    }
    return result;
  }

  /**
   * Checks if `value` is a boolean value.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is a boolean value, else `false`.
   * @example
   *
   * _.isBoolean(null);
   * // => false
   */
  function isBoolean(value) {
    return value === true || value === false || toString.call(value) == boolClass;
  }

  /**
   * Checks if `value` is a date.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is a date, else `false`.
   * @example
   *
   * _.isDate(new Date);
   * // => true
   */
  function isDate(value) {
    return value instanceof Date || toString.call(value) == dateClass;
  }

  /**
   * Checks if `value` is a DOM element.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is a DOM element, else `false`.
   * @example
   *
   * _.isElement(document.body);
   * // => true
   */
  function isElement(value) {
    return value ? value.nodeType === 1 : false;
  }

  /**
   * Checks if `value` is empty. Arrays, strings, or `arguments` objects with a
   * length of `0` and objects with no own enumerable properties are considered
   * "empty".
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Array|Object|String} value The value to inspect.
   * @returns {Boolean} Returns `true`, if the `value` is empty, else `false`.
   * @example
   *
   * _.isEmpty([1, 2, 3]);
   * // => false
   *
   * _.isEmpty({});
   * // => true
   *
   * _.isEmpty('');
   * // => true
   */
  function isEmpty(value) {
    if (!value) {
      return true;
    }
    if (isArray(value) || isString(value)) {
      return !value.length;
    }
    for (var key in value) {
      if (hasOwnProperty.call(value, key)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Performs a deep comparison between two values to determine if they are
   * equivalent to each other. If `callback` is passed, it will be executed to
   * compare values. If `callback` returns `undefined`, comparisons will be handled
   * by the method instead. The `callback` is bound to `thisArg` and invoked with
   * two arguments; (a, b).
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} a The value to compare.
   * @param {Mixed} b The other value to compare.
   * @param {Function} [callback] The function to customize comparing values.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @param- {Object} [stackA=[]] Internally used track traversed `a` objects.
   * @param- {Object} [stackB=[]] Internally used track traversed `b` objects.
   * @returns {Boolean} Returns `true`, if the values are equvalent, else `false`.
   * @example
   *
   * var moe = { 'name': 'moe', 'age': 40 };
   * var copy = { 'name': 'moe', 'age': 40 };
   *
   * moe == copy;
   * // => false
   *
   * _.isEqual(moe, copy);
   * // => true
   *
   * var words = ['hello', 'goodbye'];
   * var otherWords = ['hi', 'goodbye'];
   *
   * _.isEqual(words, otherWords, function(a, b) {
   *   var reGreet = /^(?:hello|hi)$/i,
   *       aGreet = _.isString(a) && reGreet.test(a),
   *       bGreet = _.isString(b) && reGreet.test(b);
   *
   *   return (aGreet || bGreet) ? (aGreet == bGreet) : undefined;
   * });
   * // => true
   */
  function isEqual(a, b, stackA, stackB) {
    if (a === b) {
      return a !== 0 || (1 / a == 1 / b);
    }
    var type = typeof a,
        otherType = typeof b;

    if (a === a &&
        (!a || (type != 'function' && type != 'object')) &&
        (!b || (otherType != 'function' && otherType != 'object'))) {
      return false;
    }
    if (a == null || b == null) {
      return a === b;
    }
    var className = toString.call(a),
        otherClass = toString.call(b);

    if (className != otherClass) {
      return false;
    }
    switch (className) {
      case boolClass:
      case dateClass:
        return +a == +b;

      case numberClass:
        return a != +a
          ? b != +b
          : (a == 0 ? (1 / a == 1 / b) : a == +b);

      case regexpClass:
      case stringClass:
        return a == b + '';
    }
    var isArr = className == arrayClass;
    if (!isArr) {
      if (a.__wrapped__ || b.__wrapped__) {
        return isEqual(a.__wrapped__ || a, b.__wrapped__ || b, stackA, stackB);
      }
      if (className != objectClass) {
        return false;
      }
      var ctorA = a.constructor,
          ctorB = b.constructor;

      if (ctorA != ctorB && !(
            isFunction(ctorA) && ctorA instanceof ctorA &&
            isFunction(ctorB) && ctorB instanceof ctorB
          )) {
        return false;
      }
    }
    stackA || (stackA = []);
    stackB || (stackB = []);

    var length = stackA.length;
    while (length--) {
      if (stackA[length] == a) {
        return stackB[length] == b;
      }
    }
    var result = true,
        size = 0;

    stackA.push(a);
    stackB.push(b);

    if (isArr) {
      size = b.length;
      result = size == a.length;

      if (result) {
        while (size--) {
          if (!(result = isEqual(a[size], b[size], stackA, stackB))) {
            break;
          }
        }
      }
      return result;
    }
    forIn(b, function(value, key, b) {
      if (hasOwnProperty.call(b, key)) {
        size++;
        return !(result = hasOwnProperty.call(a, key) && isEqual(a[key], value, stackA, stackB)) && indicatorObject;
      }
    });

    if (result) {
      forIn(a, function(value, key, a) {
        if (hasOwnProperty.call(a, key)) {
          return !(result = --size > -1) && indicatorObject;
        }
      });
    }
    return result;
  }

  /**
   * Checks if `value` is, or can be coerced to, a finite number.
   *
   * Note: This is not the same as native `isFinite`, which will return true for
   * booleans and empty strings. See http://es5.github.com/#x15.1.2.5.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is finite, else `false`.
   * @example
   *
   * _.isFinite(-101);
   * // => true
   *
   * _.isFinite('10');
   * // => true
   *
   * _.isFinite(true);
   * // => false
   *
   * _.isFinite('');
   * // => false
   *
   * _.isFinite(Infinity);
   * // => false
   */
  function isFinite(value) {
    return nativeIsFinite(value) && !nativeIsNaN(parseFloat(value));
  }

  /**
   * Checks if `value` is a function.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is a function, else `false`.
   * @example
   *
   * _.isFunction(_);
   * // => true
   */
  function isFunction(value) {
    return typeof value == 'function';
  }
  // fallback for older versions of Chrome and Safari
  if (isFunction(/x/)) {
    isFunction = function(value) {
      return value instanceof Function || toString.call(value) == funcClass;
    };
  }

  /**
   * Checks if `value` is the language type of Object.
   * (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is an object, else `false`.
   * @example
   *
   * _.isObject({});
   * // => true
   *
   * _.isObject([1, 2, 3]);
   * // => true
   *
   * _.isObject(1);
   * // => false
   */
  function isObject(value) {
    // check if the value is the ECMAScript language type of Object
    // http://es5.github.com/#x8
    // and avoid a V8 bug
    // http://code.google.com/p/v8/issues/detail?id=2291
    return value ? objectTypes[typeof value] : false;
  }

  /**
   * Checks if `value` is `NaN`.
   *
   * Note: This is not the same as native `isNaN`, which will return `true` for
   * `undefined` and other values. See http://es5.github.com/#x15.1.2.4.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is `NaN`, else `false`.
   * @example
   *
   * _.isNaN(NaN);
   * // => true
   *
   * _.isNaN(new Number(NaN));
   * // => true
   *
   * isNaN(undefined);
   * // => true
   *
   * _.isNaN(undefined);
   * // => false
   */
  function isNaN(value) {
    // `NaN` as a primitive is the only value that is not equal to itself
    // (perform the [[Class]] check first to avoid errors with some host objects in IE)
    return isNumber(value) && value != +value
  }

  /**
   * Checks if `value` is `null`.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is `null`, else `false`.
   * @example
   *
   * _.isNull(null);
   * // => true
   *
   * _.isNull(undefined);
   * // => false
   */
  function isNull(value) {
    return value === null;
  }

  /**
   * Checks if `value` is a number.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is a number, else `false`.
   * @example
   *
   * _.isNumber(8.4 * 5);
   * // => true
   */
  function isNumber(value) {
    return typeof value == 'number' || toString.call(value) == numberClass;
  }

  /**
   * Checks if `value` is a regular expression.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is a regular expression, else `false`.
   * @example
   *
   * _.isRegExp(/moe/);
   * // => true
   */
  function isRegExp(value) {
    return value instanceof RegExp || toString.call(value) == regexpClass;
  }

  /**
   * Checks if `value` is a string.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is a string, else `false`.
   * @example
   *
   * _.isString('moe');
   * // => true
   */
  function isString(value) {
    return typeof value == 'string' || toString.call(value) == stringClass;
  }

  /**
   * Checks if `value` is `undefined`.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns `true`, if the `value` is `undefined`, else `false`.
   * @example
   *
   * _.isUndefined(void 0);
   * // => true
   */
  function isUndefined(value) {
    return typeof value == 'undefined';
  }

  /**
   * Creates a shallow clone of `object` excluding the specified properties.
   * Property names may be specified as individual arguments or as arrays of
   * property names. If a `callback` function is passed, it will be executed
   * for each property in the `object`, omitting the properties `callback`
   * returns truthy for. The `callback` is bound to `thisArg` and invoked
   * with three arguments; (value, key, object).
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Object} object The source object.
   * @param {Function|String} callback|[prop1, prop2, ...] The properties to omit
   *  or the function called per iteration.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Object} Returns an object without the omitted properties.
   * @example
   *
   * _.omit({ 'name': 'moe', 'age': 40 }, 'age');
   * // => { 'name': 'moe' }
   *
   * _.omit({ 'name': 'moe', 'age': 40 }, function(value) {
   *   return typeof value == 'number';
   * });
   * // => { 'name': 'moe' }
   */
  function omit(object) {
    var props = concat.apply(arrayRef, arguments),
        result = {};

    forIn(object, function(value, key) {
      if (indexOf(props, key, 1) < 0) {
        result[key] = value;
      }
    });
    return result;
  }

  /**
   * Creates a two dimensional array of the given object's key-value pairs,
   * i.e. `[[key1, value1], [key2, value2]]`.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Object} object The object to inspect.
   * @returns {Array} Returns new array of key-value pairs.
   * @example
   *
   * _.pairs({ 'moe': 30, 'larry': 40 });
   * // => [['moe', 30], ['larry', 40]] (order is not guaranteed)
   */
  function pairs(object) {
    var index = -1,
        props = keys(object),
        length = props.length,
        result = Array(length);

    while (++index < length) {
      var key = props[index];
      result[index] = [key, object[key]];
    }
    return result;
  }

  /**
   * Creates a shallow clone of `object` composed of the specified properties.
   * Property names may be specified as individual arguments or as arrays of property
   * names. If `callback` is passed, it will be executed for each property in the
   * `object`, picking the properties `callback` returns truthy for. The `callback`
   * is bound to `thisArg` and invoked with three arguments; (value, key, object).
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Object} object The source object.
   * @param {Array|Function|String} callback|[prop1, prop2, ...] The function called
   *  per iteration or properties to pick, either as individual arguments or arrays.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Object} Returns an object composed of the picked properties.
   * @example
   *
   * _.pick({ 'name': 'moe', '_userid': 'moe1' }, 'name');
   * // => { 'name': 'moe' }
   *
   * _.pick({ 'name': 'moe', '_userid': 'moe1' }, function(value, key) {
   *   return key.charAt(0) != '_';
   * });
   * // => { 'name': 'moe' }
   */
  function pick(object) {
    var index = 0,
        props = concat.apply(arrayRef, arguments),
        length = props.length,
        result = {};

    while (++index < length) {
      var prop = props[index];
      if (prop in object) {
        result[prop] = object[prop];
      }
    }
    return result;
  }

  /**
   * Creates an array composed of the own enumerable property values of `object`.
   *
   * @static
   * @memberOf _
   * @category Objects
   * @param {Object} object The object to inspect.
   * @returns {Array} Returns a new array of property values.
   * @example
   *
   * _.values({ 'one': 1, 'two': 2, 'three': 3 });
   * // => [1, 2, 3]
   */
  function values(object) {
    var index = -1,
        props = keys(object),
        length = props.length,
        result = Array(length);

    while (++index < length) {
      result[index] = object[props[index]];
    }
    return result;
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Checks if a given `target` element is present in a `collection` using strict
   * equality for comparisons, i.e. `===`. If `fromIndex` is negative, it is used
   * as the offset from the end of the collection.
   *
   * @static
   * @memberOf _
   * @alias include
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Mixed} target The value to check for.
   * @param {Number} [fromIndex=0] The index to search from.
   * @returns {Boolean} Returns `true` if the `target` element is found, else `false`.
   * @example
   *
   * _.contains([1, 2, 3], 1);
   * // => true
   *
   * _.contains([1, 2, 3], 1, 2);
   * // => false
   *
   * _.contains({ 'name': 'moe', 'age': 40 }, 'moe');
   * // => true
   *
   * _.contains('curly', 'ur');
   * // => true
   */
  function contains(collection, target) {
    var length = collection ? collection.length : 0,
        result = false;
    if (typeof length == 'number') {
      result = indexOf(collection, target) > -1;
    } else {
      each(collection, function(value) {
        return (result = value === target) && indicatorObject;
      });
    }
    return result;
  }

  /**
   * Creates an object composed of keys returned from running each element of the
   * `collection` through the given `callback`. The corresponding value of each key
   * is the number of times the key was returned by the `callback`. The `callback`
   * is bound to `thisArg` and invoked with three arguments; (value, index|key, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Object} Returns the composed aggregate object.
   * @example
   *
   * _.countBy([4.3, 6.1, 6.4], function(num) { return Math.floor(num); });
   * // => { '4': 1, '6': 2 }
   *
   * _.countBy([4.3, 6.1, 6.4], function(num) { return this.floor(num); }, Math);
   * // => { '4': 1, '6': 2 }
   *
   * _.countBy(['one', 'two', 'three'], 'length');
   * // => { '3': 2, '5': 1 }
   */
  function countBy(collection, callback, thisArg) {
    var result = {};
    callback = createCallback(callback, thisArg);

    forEach(collection, function(value, key, collection) {
      key = callback(value, key, collection) + '';
      (hasOwnProperty.call(result, key) ? result[key]++ : result[key] = 1);
    });
    return result;
  }

  /**
   * Checks if the `callback` returns a truthy value for **all** elements of a
   * `collection`. The `callback` is bound to `thisArg` and invoked with three
   * arguments; (value, index|key, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @alias all
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Boolean} Returns `true` if all elements pass the callback check,
   *  else `false`.
   * @example
   *
   * _.every([true, 1, null, 'yes'], Boolean);
   * // => false
   *
   * var stooges = [
   *   { 'name': 'moe', 'age': 40 },
   *   { 'name': 'larry', 'age': 50 }
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.every(stooges, 'age');
   * // => true
   *
   * // using "_.where" callback shorthand
   * _.every(stooges, { 'age': 50 });
   * // => false
   */
  function every(collection, callback, thisArg) {
    var result = true;
    callback = createCallback(callback, thisArg);

    if (isArray(collection)) {
      var index = -1,
          length = collection.length;

      while (++index < length) {
        if (!(result = !!callback(collection[index], index, collection))) {
          break;
        }
      }
    } else {
      each(collection, function(value, index, collection) {
        return !(result = !!callback(value, index, collection)) && indicatorObject;
      });
    }
    return result;
  }

  /**
   * Examines each element in a `collection`, returning an array of all elements
   * the `callback` returns truthy for. The `callback` is bound to `thisArg` and
   * invoked with three arguments; (value, index|key, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @alias select
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array} Returns a new array of elements that passed the callback check.
   * @example
   *
   * var evens = _.filter([1, 2, 3, 4, 5, 6], function(num) { return num % 2 == 0; });
   * // => [2, 4, 6]
   *
   * var food = [
   *   { 'name': 'apple',  'organic': false, 'type': 'fruit' },
   *   { 'name': 'carrot', 'organic': true,  'type': 'vegetable' }
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.filter(food, 'organic');
   * // => [{ 'name': 'carrot', 'organic': true, 'type': 'vegetable' }]
   *
   * // using "_.where" callback shorthand
   * _.filter(food, { 'type': 'fruit' });
   * // => [{ 'name': 'apple', 'organic': false, 'type': 'fruit' }]
   */
  function filter(collection, callback, thisArg) {
    var result = [];
    callback = createCallback(callback, thisArg);

    if (isArray(collection)) {
      var index = -1,
          length = collection.length;

      while (++index < length) {
        var value = collection[index];
        if (callback(value, index, collection)) {
          result.push(value);
        }
      }
    } else {
      each(collection, function(value, index, collection) {
        if (callback(value, index, collection)) {
          result.push(value);
        }
      });
    }
    return result;
  }

  /**
   * Examines each element in a `collection`, returning the first that the `callback`
   * returns truthy for. The `callback` is bound to `thisArg` and invoked with three
   * arguments; (value, index|key, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @alias detect
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Mixed} Returns the element that passed the callback check,
   *  else `undefined`.
   * @example
   *
   * var even = _.find([1, 2, 3, 4, 5, 6], function(num) { return num % 2 == 0; });
   * // => 2
   *
   * var food = [
   *   { 'name': 'apple',  'organic': false, 'type': 'fruit' },
   *   { 'name': 'banana', 'organic': true,  'type': 'fruit' },
   *   { 'name': 'beet',   'organic': false, 'type': 'vegetable' },
   *   { 'name': 'carrot', 'organic': true,  'type': 'vegetable' }
   * ];
   *
   * // using "_.where" callback shorthand
   * var veggie = _.find(food, { 'type': 'vegetable' });
   * // => { 'name': 'beet', 'organic': false, 'type': 'vegetable' }
   *
   * // using "_.pluck" callback shorthand
   * var healthy = _.find(food, 'organic');
   * // => { 'name': 'banana', 'organic': true, 'type': 'fruit' }
   */
  function find(collection, callback, thisArg) {
    var result;
    callback = createCallback(callback, thisArg);

    forEach(collection, function(value, index, collection) {
      if (callback(value, index, collection)) {
        result = value;
        return indicatorObject;
      }
    });
    return result;
  }

  function findWhere(object, properties) {
    return where(object, properties, true);
  }

  /**
   * Iterates over a `collection`, executing the `callback` for each element in
   * the `collection`. The `callback` is bound to `thisArg` and invoked with three
   * arguments; (value, index|key, collection). Callbacks may exit iteration early
   * by explicitly returning `false`.
   *
   * @static
   * @memberOf _
   * @alias each
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function} [callback=identity] The function called per iteration.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array|Object|String} Returns `collection`.
   * @example
   *
   * _([1, 2, 3]).forEach(alert).join(',');
   * // => alerts each number and returns '1,2,3'
   *
   * _.forEach({ 'one': 1, 'two': 2, 'three': 3 }, alert);
   * // => alerts each number value (order is not guaranteed)
   */
  function forEach(collection, callback, thisArg) {
    if (callback && typeof thisArg == 'undefined' && isArray(collection)) {
      var index = -1,
          length = collection.length;

      while (++index < length) {
        if (callback(collection[index], index, collection) === indicatorObject) {
          break;
        }
      }
    } else {
      each(collection, callback, thisArg);
    };
  }

  /**
   * Creates an object composed of keys returned from running each element of the
   * `collection` through the `callback`. The corresponding value of each key is
   * an array of elements passed to `callback` that returned the key. The `callback`
   * is bound to `thisArg` and invoked with three arguments; (value, index|key, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Object} Returns the composed aggregate object.
   * @example
   *
   * _.groupBy([4.2, 6.1, 6.4], function(num) { return Math.floor(num); });
   * // => { '4': [4.2], '6': [6.1, 6.4] }
   *
   * _.groupBy([4.2, 6.1, 6.4], function(num) { return this.floor(num); }, Math);
   * // => { '4': [4.2], '6': [6.1, 6.4] }
   *
   * // using "_.pluck" callback shorthand
   * _.groupBy(['one', 'two', 'three'], 'length');
   * // => { '3': ['one', 'two'], '5': ['three'] }
   */
  function groupBy(collection, callback, thisArg) {
    var result = {};
    callback = createCallback(callback, thisArg);

    forEach(collection, function(value, key, collection) {
      key = callback(value, key, collection) + '';
      (hasOwnProperty.call(result, key) ? result[key] : result[key] = []).push(value);
    });
    return result;
  }

  /**
   * Invokes the method named by `methodName` on each element in the `collection`,
   * returning an array of the results of each invoked method. Additional arguments
   * will be passed to each invoked method. If `methodName` is a function, it will
   * be invoked for, and `this` bound to, each element in the `collection`.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|String} methodName The name of the method to invoke or
   *  the function invoked per iteration.
   * @param {Mixed} [arg1, arg2, ...] Arguments to invoke the method with.
   * @returns {Array} Returns a new array of the results of each invoked method.
   * @example
   *
   * _.invoke([[5, 1, 7], [3, 2, 1]], 'sort');
   * // => [[1, 5, 7], [1, 2, 3]]
   *
   * _.invoke([123, 456], String.prototype.split, '');
   * // => [['1', '2', '3'], ['4', '5', '6']]
   */
  function invoke(collection, methodName) {
    var args = slice(arguments, 2),
        index = -1,
        isFunc = typeof methodName == 'function',
        length = collection ? collection.length : 0,
        result = Array(typeof length == 'number' ? length : 0);

    forEach(collection, function(value) {
      result[++index] = (isFunc ? methodName : value[methodName]).apply(value, args);
    });
    return result;
  }

  /**
   * Creates an array of values by running each element in the `collection`
   * through the `callback`. The `callback` is bound to `thisArg` and invoked with
   * three arguments; (value, index|key, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @alias collect
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array} Returns a new array of the results of each `callback` execution.
   * @example
   *
   * _.map([1, 2, 3], function(num) { return num * 3; });
   * // => [3, 6, 9]
   *
   * _.map({ 'one': 1, 'two': 2, 'three': 3 }, function(num) { return num * 3; });
   * // => [3, 6, 9] (order is not guaranteed)
   *
   * var stooges = [
   *   { 'name': 'moe', 'age': 40 },
   *   { 'name': 'larry', 'age': 50 }
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.map(stooges, 'name');
   * // => ['moe', 'larry']
   */
  function map(collection, callback, thisArg) {
    var index = -1,
        length = collection ? collection.length : 0,
        result = Array(typeof length == 'number' ? length : 0);

    callback = createCallback(callback, thisArg);
    if (isArray(collection)) {
      while (++index < length) {
        result[index] = callback(collection[index], index, collection);
      }
    } else {
      each(collection, function(value, key, collection) {
        result[++index] = callback(value, key, collection);
      });
    }
    return result;
  }

  /**
   * Retrieves the maximum value of an `array`. If `callback` is passed,
   * it will be executed for each value in the `array` to generate the
   * criterion by which the value is ranked. The `callback` is bound to
   * `thisArg` and invoked with three arguments; (value, index, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Mixed} Returns the maximum value.
   * @example
   *
   * _.max([4, 2, 8, 6]);
   * // => 8
   *
   * var stooges = [
   *   { 'name': 'moe', 'age': 40 },
   *   { 'name': 'larry', 'age': 50 }
   * ];
   *
   * _.max(stooges, function(stooge) { return stooge.age; });
   * // => { 'name': 'larry', 'age': 50 };
   *
   * // using "_.pluck" callback shorthand
   * _.max(stooges, 'age');
   * // => { 'name': 'larry', 'age': 50 };
   */
  function max(collection, callback, thisArg) {
    var computed = -Infinity,
        result = computed;

    if (!callback && isArray(collection)) {
      var index = -1,
          length = collection.length;

      while (++index < length) {
        var value = collection[index];
        if (value > result) {
          result = value;
        }
      }
    } else {
      callback = createCallback(callback, thisArg);

      each(collection, function(value, index, collection) {
        var current = callback(value, index, collection);
        if (current > computed) {
          computed = current;
          result = value;
        }
      });
    }
    return result;
  }

  /**
   * Retrieves the minimum value of an `array`. If `callback` is passed,
   * it will be executed for each value in the `array` to generate the
   * criterion by which the value is ranked. The `callback` is bound to `thisArg`
   * and invoked with three arguments; (value, index, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Mixed} Returns the minimum value.
   * @example
   *
   * _.min([4, 2, 8, 6]);
   * // => 2
   *
   * var stooges = [
   *   { 'name': 'moe', 'age': 40 },
   *   { 'name': 'larry', 'age': 50 }
   * ];
   *
   * _.min(stooges, function(stooge) { return stooge.age; });
   * // => { 'name': 'moe', 'age': 40 };
   *
   * // using "_.pluck" callback shorthand
   * _.min(stooges, 'age');
   * // => { 'name': 'moe', 'age': 40 };
   */
  function min(collection, callback, thisArg) {
    var computed = Infinity,
        result = computed;

    if (!callback && isArray(collection)) {
      var index = -1,
          length = collection.length;

      while (++index < length) {
        var value = collection[index];
        if (value < result) {
          result = value;
        }
      }
    } else {
      callback = createCallback(callback, thisArg);

      each(collection, function(value, index, collection) {
        var current = callback(value, index, collection);
        if (current < computed) {
          computed = current;
          result = value;
        }
      });
    }
    return result;
  }

  /**
   * Retrieves the value of a specified property from all elements in the `collection`.
   *
   * @static
   * @memberOf _
   * @type Function
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {String} property The property to pluck.
   * @returns {Array} Returns a new array of property values.
   * @example
   *
   * var stooges = [
   *   { 'name': 'moe', 'age': 40 },
   *   { 'name': 'larry', 'age': 50 }
   * ];
   *
   * _.pluck(stooges, 'name');
   * // => ['moe', 'larry']
   */
  var pluck = map;

  /**
   * Reduces a `collection` to a value that is the accumulated result of running
   * each element in the `collection` through the `callback`, where each successive
   * `callback` execution consumes the return value of the previous execution.
   * If `accumulator` is not passed, the first element of the `collection` will be
   * used as the initial `accumulator` value. The `callback` is bound to `thisArg`
   * and invoked with four arguments; (accumulator, value, index|key, collection).
   *
   * @static
   * @memberOf _
   * @alias foldl, inject
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function} [callback=identity] The function called per iteration.
   * @param {Mixed} [accumulator] Initial value of the accumulator.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Mixed} Returns the accumulated value.
   * @example
   *
   * var sum = _.reduce([1, 2, 3], function(sum, num) {
   *   return sum + num;
   * });
   * // => 6
   *
   * var mapped = _.reduce({ 'a': 1, 'b': 2, 'c': 3 }, function(result, num, key) {
   *   result[key] = num * 3;
   *   return result;
   * }, {});
   * // => { 'a': 3, 'b': 6, 'c': 9 }
   */
  function reduce(collection, callback, accumulator, thisArg) {
    var noaccum = arguments.length < 3;
    callback = createCallback(callback, thisArg, 4);

    if (isArray(collection)) {
      var index = -1,
          length = collection.length;

      if (noaccum) {
        accumulator = collection[++index];
      }
      while (++index < length) {
        accumulator = callback(accumulator, collection[index], index, collection);
      }
    } else {
      each(collection, function(value, index, collection) {
        accumulator = noaccum
          ? (noaccum = false, value)
          : callback(accumulator, value, index, collection)
      });
    }
    return accumulator;
  }

  /**
   * This method is similar to `_.reduce`, except that it iterates over a
   * `collection` from right to left.
   *
   * @static
   * @memberOf _
   * @alias foldr
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function} [callback=identity] The function called per iteration.
   * @param {Mixed} [accumulator] Initial value of the accumulator.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Mixed} Returns the accumulated value.
   * @example
   *
   * var list = [[0, 1], [2, 3], [4, 5]];
   * var flat = _.reduceRight(list, function(a, b) { return a.concat(b); }, []);
   * // => [4, 5, 2, 3, 0, 1]
   */
  function reduceRight(collection, callback, accumulator, thisArg) {
    var iterable = collection,
        length = collection ? collection.length : 0,
        noaccum = arguments.length < 3;

    if (typeof length != 'number') {
      var props = keys(collection);
      length = props.length;
    }
    callback = createCallback(callback, thisArg, 4);
    forEach(collection, function(value, index, collection) {
      index = props ? props[--length] : --length;
      accumulator = noaccum
        ? (noaccum = false, iterable[index])
        : callback(accumulator, iterable[index], index, collection);
    });
    return accumulator;
  }

  /**
   * The opposite of `_.filter`, this method returns the elements of a
   * `collection` that `callback` does **not** return truthy for.
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array} Returns a new array of elements that did **not** pass the
   *  callback check.
   * @example
   *
   * var odds = _.reject([1, 2, 3, 4, 5, 6], function(num) { return num % 2 == 0; });
   * // => [1, 3, 5]
   *
   * var food = [
   *   { 'name': 'apple',  'organic': false, 'type': 'fruit' },
   *   { 'name': 'carrot', 'organic': true,  'type': 'vegetable' }
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.reject(food, 'organic');
   * // => [{ 'name': 'apple', 'organic': false, 'type': 'fruit' }]
   *
   * // using "_.where" callback shorthand
   * _.reject(food, { 'type': 'fruit' });
   * // => [{ 'name': 'carrot', 'organic': true, 'type': 'vegetable' }]
   */
  function reject(collection, callback, thisArg) {
    callback = createCallback(callback, thisArg);
    return filter(collection, function(value, index, collection) {
      return !callback(value, index, collection);
    });
  }

  /**
   * Creates an array of shuffled `array` values, using a version of the
   * Fisher-Yates shuffle. See http://en.wikipedia.org/wiki/Fisher-Yates_shuffle.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to shuffle.
   * @returns {Array} Returns a new shuffled collection.
   * @example
   *
   * _.shuffle([1, 2, 3, 4, 5, 6]);
   * // => [4, 1, 6, 3, 5, 2]
   */
  function shuffle(collection) {
    var index = -1,
        length = collection ? collection.length : 0,
        result = Array(typeof length == 'number' ? length : 0);

    forEach(collection, function(value) {
      var rand = floor(nativeRandom() * (++index + 1));
      result[index] = result[rand];
      result[rand] = value;
    });
    return result;
  }

  /**
   * Gets the size of the `collection` by returning `collection.length` for arrays
   * and array-like objects or the number of own enumerable properties for objects.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to inspect.
   * @returns {Number} Returns `collection.length` or number of own enumerable properties.
   * @example
   *
   * _.size([1, 2]);
   * // => 2
   *
   * _.size({ 'one': 1, 'two': 2, 'three': 3 });
   * // => 3
   *
   * _.size('curly');
   * // => 5
   */
  function size(collection) {
    var length = collection ? collection.length : 0;
    return typeof length == 'number' ? length : keys(collection).length;
  }

  /**
   * Checks if the `callback` returns a truthy value for **any** element of a
   * `collection`. The function returns as soon as it finds passing value, and
   * does not iterate over the entire `collection`. The `callback` is bound to
   * `thisArg` and invoked with three arguments; (value, index|key, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @alias any
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Boolean} Returns `true` if any element passes the callback check,
   *  else `false`.
   * @example
   *
   * _.some([null, 0, 'yes', false], Boolean);
   * // => true
   *
   * var food = [
   *   { 'name': 'apple',  'organic': false, 'type': 'fruit' },
   *   { 'name': 'carrot', 'organic': true,  'type': 'vegetable' }
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.some(food, 'organic');
   * // => true
   *
   * // using "_.where" callback shorthand
   * _.some(food, { 'type': 'meat' });
   * // => false
   */
  function some(collection, callback, thisArg) {
    var result;
    callback = createCallback(callback, thisArg);

    if (isArray(collection)) {
      var index = -1,
          length = collection.length;

      while (++index < length) {
        if ((result = callback(collection[index], index, collection))) {
          break;
        }
      }
    } else {
      each(collection, function(value, index, collection) {
        return (result = callback(value, index, collection)) && indicatorObject;
      });
    }
    return !!result;
  }

  /**
   * Creates an array of elements, sorted in ascending order by the results of
   * running each element in the `collection` through the `callback`. This method
   * performs a stable sort, that is, it will preserve the original sort order of
   * equal elements. The `callback` is bound to `thisArg` and invoked with three
   * arguments; (value, index|key, collection).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array} Returns a new array of sorted elements.
   * @example
   *
   * _.sortBy([1, 2, 3], function(num) { return Math.sin(num); });
   * // => [3, 1, 2]
   *
   * _.sortBy([1, 2, 3], function(num) { return this.sin(num); }, Math);
   * // => [3, 1, 2]
   *
   * // using "_.pluck" callback shorthand
   * _.sortBy(['banana', 'strawberry', 'apple'], 'length');
   * // => ['apple', 'banana', 'strawberry']
   */
  function sortBy(collection, callback, thisArg) {
    var index = -1,
        length = collection ? collection.length : 0,
        result = Array(typeof length == 'number' ? length : 0);

    callback = createCallback(callback, thisArg);
    forEach(collection, function(value, key, collection) {
      result[++index] = {
        'criteria': callback(value, key, collection),
        'index': index,
        'value': value
      };
    });

    length = result.length;
    result.sort(compareAscending);
    while (length--) {
      result[length] = result[length].value;
    }
    return result;
  }

  /**
   * Converts the `collection` to an array.
   *
   * @static
   * @memberOf _
   * @category Collections
   * @param {Array|Object|String} collection The collection to convert.
   * @returns {Array} Returns the new converted array.
   * @example
   *
   * (function() { return _.toArray(arguments).slice(1); })(1, 2, 3, 4);
   * // => [2, 3, 4]
   */
  function toArray(collection) {
    if (collection && typeof collection.length == 'number') {
      return  slice(collection);
    }
    return values(collection);
  }

  /**
   * Examines each element in a `collection`, returning an array of all elements
   * that have the given `properties`. When checking `properties`, this method
   * performs a deep comparison between values to determine if they are equivalent
   * to each other.
   *
   * @static
   * @memberOf _
   * @type Function
   * @category Collections
   * @param {Array|Object|String} collection The collection to iterate over.
   * @param {Object} properties The object of property values to filter by.
   * @returns {Array} Returns a new array of elements that have the given `properties`.
   * @example
   *
   * var stooges = [
   *   { 'name': 'moe', 'age': 40 },
   *   { 'name': 'larry', 'age': 50 }
   * ];
   *
   * _.where(stooges, { 'age': 40 });
   * // => [{ 'name': 'moe', 'age': 40 }]
   */
  function where(collection, properties, first) {
    return (first && isEmpty(properties))
      ? null
      : (first ? find : filter)(collection, properties);
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Creates an array with all falsey values of `array` removed. The values
   * `false`, `null`, `0`, `""`, `undefined` and `NaN` are all falsey.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to compact.
   * @returns {Array} Returns a new filtered array.
   * @example
   *
   * _.compact([0, 1, false, 2, '', 3]);
   * // => [1, 2, 3]
   */
  function compact(array) {
    var index = -1,
        length = array ? array.length : 0,
        result = [];

    while (++index < length) {
      var value = array[index];
      if (value) {
        result.push(value);
      }
    }
    return result;
  }

  /**
   * Creates an array of `array` elements not present in the other arrays
   * using strict equality for comparisons, i.e. `===`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to process.
   * @param {Array} [array1, array2, ...] Arrays to check.
   * @returns {Array} Returns a new array of `array` elements not present in the
   *  other arrays.
   * @example
   *
   * _.difference([1, 2, 3, 4, 5], [5, 2, 10]);
   * // => [1, 3, 4]
   */
  function difference(array) {
    var index = -1,
        length = array.length,
        flattened = concat.apply(arrayRef, arguments),
        result = [];

    while (++index < length) {
      var value = array[index]
      if (indexOf(flattened, value, length) < 0) {
        result.push(value);
      }
    }
    return result
  }

  /**
   * Gets the first element of the `array`. If a number `n` is passed, the first
   * `n` elements of the `array` are returned. If a `callback` function is passed,
   * the first elements the `callback` returns truthy for are returned. The `callback`
   * is bound to `thisArg` and invoked with three arguments; (value, index, array).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @alias head, take
   * @category Arrays
   * @param {Array} array The array to query.
   * @param {Function|Object|Number|String} [callback|n] The function called
   *  per element or the number of elements to return. If a property name or
   *  object is passed, it will be used to create a "_.pluck" or "_.where"
   *  style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Mixed} Returns the first element(s) of `array`.
   * @example
   *
   * _.first([1, 2, 3]);
   * // => 1
   *
   * _.first([1, 2, 3], 2);
   * // => [1, 2]
   *
   * _.first([1, 2, 3], function(num) {
   *   return num < 3;
   * });
   * // => [1, 2]
   *
   * var food = [
   *   { 'name': 'banana', 'organic': true },
   *   { 'name': 'beet',   'organic': false },
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.first(food, 'organic');
   * // => [{ 'name': 'banana', 'organic': true }]
   *
   * var food = [
   *   { 'name': 'apple',  'type': 'fruit' },
   *   { 'name': 'banana', 'type': 'fruit' },
   *   { 'name': 'beet',   'type': 'vegetable' }
   * ];
   *
   * // using "_.where" callback shorthand
   * _.first(food, { 'type': 'fruit' });
   * // => [{ 'name': 'apple', 'type': 'fruit' }, { 'name': 'banana', 'type': 'fruit' }]
   */
  function first(array, callback, thisArg) {
    if (array) {
      var n = 0,
          length = array.length;

      if (typeof callback != 'number' && callback != null) {
        var index = -1;
        callback = createCallback(callback, thisArg);
        while (++index < length && callback(array[index], index, array)) {
          n++;
        }
      } else {
        n = callback;
        if (n == null || thisArg) {
          return array[0];
        }
      }
      return slice(array, 0, nativeMin(nativeMax(0, n), length));
    }
  }

  /**
   * Flattens a nested array (the nesting can be to any depth). If `shallow` is
   * truthy, `array` will only be flattened a single level.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to compact.
   * @param {Boolean} shallow A flag to indicate only flattening a single level.
   * @returns {Array} Returns a new flattened array.
   * @example
   *
   * _.flatten([1, [2], [3, [[4]]]]);
   * // => [1, 2, 3, 4];
   *
   * _.flatten([1, [2], [3, [[4]]]], true);
   * // => [1, 2, 3, [[4]]];
   */
  function flatten(array, shallow) {
    var index = -1,
        length = array ? array.length : 0,
        result = [];

    while (++index < length) {
      var value = array[index];

      // recursively flatten arrays (susceptible to call stack limits)
      if (isArray(value)) {
        push.apply(result, shallow ? value : flatten(value));
      } else {
        result.push(value);
      }
    }
    return result;
  }

  /**
   * Gets the index at which the first occurrence of `value` is found using
   * strict equality for comparisons, i.e. `===`. If the `array` is already
   * sorted, passing `true` for `fromIndex` will run a faster binary search.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to search.
   * @param {Mixed} value The value to search for.
   * @param {Boolean|Number} [fromIndex=0] The index to search from or `true` to
   *  perform a binary search on a sorted `array`.
   * @returns {Number} Returns the index of the matched value or `-1`.
   * @example
   *
   * _.indexOf([1, 2, 3, 1, 2, 3], 2);
   * // => 1
   *
   * _.indexOf([1, 2, 3, 1, 2, 3], 2, 3);
   * // => 4
   *
   * _.indexOf([1, 1, 2, 2, 3, 3], 2, true);
   * // => 2
   */
  function indexOf(array, value, fromIndex) {
    var index = -1,
        length = array ? array.length : 0;

    if (typeof fromIndex == 'number') {
      index = (fromIndex < 0 ? nativeMax(0, length + fromIndex) : fromIndex || 0) - 1;
    } else if (fromIndex) {
      index = sortedIndex(array, value);
      return array[index] === value ? index : -1;
    }
    while (++index < length) {
      if (array[index] === value) {
        return index;
      }
    }
    return -1;
  }

  /**
   * Gets all but the last element of `array`. If a number `n` is passed, the
   * last `n` elements are excluded from the result. If a `callback` function
   * is passed, the last elements the `callback` returns truthy for are excluded
   * from the result. The `callback` is bound to `thisArg` and invoked with three
   * arguments; (value, index, array).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to query.
   * @param {Function|Object|Number|String} [callback|n=1] The function called
   *  per element or the number of elements to exclude. If a property name or
   *  object is passed, it will be used to create a "_.pluck" or "_.where"
   *  style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array} Returns a slice of `array`.
   * @example
   *
   * _.initial([1, 2, 3]);
   * // => [1, 2]
   *
   * _.initial([1, 2, 3], 2);
   * // => [1]
   *
   * _.initial([1, 2, 3], function(num) {
   *   return num > 1;
   * });
   * // => [1]
   *
   * var food = [
   *   { 'name': 'beet',   'organic': false },
   *   { 'name': 'carrot', 'organic': true }
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.initial(food, 'organic');
   * // => [{ 'name': 'beet',   'organic': false }]
   *
   * var food = [
   *   { 'name': 'banana', 'type': 'fruit' },
   *   { 'name': 'beet',   'type': 'vegetable' },
   *   { 'name': 'carrot', 'type': 'vegetable' }
   * ];
   *
   * // using "_.where" callback shorthand
   * _.initial(food, { 'type': 'vegetable' });
   * // => [{ 'name': 'banana', 'type': 'fruit' }]
   */
  function initial(array, callback, thisArg) {
    if (!array) {
      return [];
    }
    var n = 0,
        length = array.length;

    if (typeof callback != 'number' && callback != null) {
      var index = length;
      callback = createCallback(callback, thisArg);
      while (index-- && callback(array[index], index, array)) {
        n++;
      }
    } else {
      n = (callback == null || thisArg) ? 1 : callback || n;
    }
    return slice(array, 0, nativeMin(nativeMax(0, length - n), length));
  }

  /**
   * Computes the intersection of all the passed-in arrays using strict equality
   * for comparisons, i.e. `===`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} [array1, array2, ...] Arrays to process.
   * @returns {Array} Returns a new array of unique elements that are present
   *  in **all** of the arrays.
   * @example
   *
   * _.intersection([1, 2, 3], [101, 2, 1, 10], [2, 1]);
   * // => [1, 2]
   */
  function intersection(array) {
    var args = arguments,
        argsLength = args.length,
        index = -1,
        length = array ? array.length : 0,
        result = [];

    outer:
    while (++index < length) {
      var value = array[index];
      if (indexOf(result, value) < 0) {
        var argsIndex = argsLength;
        while (--argsIndex) {
          if (indexOf(args[argsIndex], value) < 0) {
            continue outer;
          }
        }
        result.push(value);
      }
    }
    return result;
  }

  /**
   * Gets the last element of the `array`. If a number `n` is passed, the last
   * `n` elements of the `array` are returned. If a `callback` function is passed,
   * the last elements the `callback` returns truthy for are returned. The `callback`
   * is bound to `thisArg` and invoked with three arguments; (value, index, array).
   *
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to query.
   * @param {Function|Object|Number|String} [callback|n] The function called
   *  per element or the number of elements to return. If a property name or
   *  object is passed, it will be used to create a "_.pluck" or "_.where"
   *  style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Mixed} Returns the last element(s) of `array`.
   * @example
   *
   * _.last([1, 2, 3]);
   * // => 3
   *
   * _.last([1, 2, 3], 2);
   * // => [2, 3]
   *
   * _.last([1, 2, 3], function(num) {
   *   return num > 1;
   * });
   * // => [2, 3]
   *
   * var food = [
   *   { 'name': 'beet',   'organic': false },
   *   { 'name': 'carrot', 'organic': true }
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.last(food, 'organic');
   * // => [{ 'name': 'carrot', 'organic': true }]
   *
   * var food = [
   *   { 'name': 'banana', 'type': 'fruit' },
   *   { 'name': 'beet',   'type': 'vegetable' },
   *   { 'name': 'carrot', 'type': 'vegetable' }
   * ];
   *
   * // using "_.where" callback shorthand
   * _.last(food, { 'type': 'vegetable' });
   * // => [{ 'name': 'beet', 'type': 'vegetable' }, { 'name': 'carrot', 'type': 'vegetable' }]
   */
  function last(array, callback, thisArg) {
    if (array) {
      var n = 0,
          length = array.length;

      if (typeof callback != 'number' && callback != null) {
        var index = length;
        callback = createCallback(callback, thisArg);
        while (index-- && callback(array[index], index, array)) {
          n++;
        }
      } else {
        n = callback;
        if (n == null || thisArg) {
          return array[length - 1];
        }
      }
      return slice(array, nativeMax(0, length - n));
    }
  }

  /**
   * Gets the index at which the last occurrence of `value` is found using strict
   * equality for comparisons, i.e. `===`. If `fromIndex` is negative, it is used
   * as the offset from the end of the collection.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to search.
   * @param {Mixed} value The value to search for.
   * @param {Number} [fromIndex=array.length-1] The index to search from.
   * @returns {Number} Returns the index of the matched value or `-1`.
   * @example
   *
   * _.lastIndexOf([1, 2, 3, 1, 2, 3], 2);
   * // => 4
   *
   * _.lastIndexOf([1, 2, 3, 1, 2, 3], 2, 3);
   * // => 1
   */
  function lastIndexOf(array, value, fromIndex) {
    var index = array ? array.length : 0;
    if (typeof fromIndex == 'number') {
      index = (fromIndex < 0 ? nativeMax(0, index + fromIndex) : nativeMin(fromIndex, index - 1)) + 1;
    }
    while (index--) {
      if (array[index] === value) {
        return index;
      }
    }
    return -1;
  }

  /**
   * Creates an object composed from arrays of `keys` and `values`. Pass either
   * a single two dimensional array, i.e. `[[key1, value1], [key2, value2]]`, or
   * two arrays, one of `keys` and one of corresponding `values`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} keys The array of keys.
   * @param {Array} [values=[]] The array of values.
   * @returns {Object} Returns an object composed of the given keys and
   *  corresponding values.
   * @example
   *
   * _.object(['moe', 'larry'], [30, 40]);
   * // => { 'moe': 30, 'larry': 40 }
   */
  function object(keys, values) {
    var index = -1,
        length = keys ? keys.length : 0,
        result = {};

    while (++index < length) {
      var key = keys[index];
      if (values) {
        result[key] = values[index];
      } else {
        result[key[0]] = key[1];
      }
    }
    return result;
  }

  /**
   * Creates an array of numbers (positive and/or negative) progressing from
   * `start` up to but not including `end`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Number} [start=0] The start of the range.
   * @param {Number} end The end of the range.
   * @param {Number} [step=1] The value to increment or descrement by.
   * @returns {Array} Returns a new range array.
   * @example
   *
   * _.range(10);
   * // => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
   *
   * _.range(1, 11);
   * // => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
   *
   * _.range(0, 30, 5);
   * // => [0, 5, 10, 15, 20, 25]
   *
   * _.range(0, -10, -1);
   * // => [0, -1, -2, -3, -4, -5, -6, -7, -8, -9]
   *
   * _.range(0);
   * // => []
   */
  function range(start, end, step) {
    start = +start || 0;
    step = +step || 1;

    if (end == null) {
      end = start;
      start = 0;
    }
    // use `Array(length)` so V8 will avoid the slower "dictionary" mode
    // http://youtu.be/XAqIpGU8ZZk#t=17m25s
    var index = -1,
        length = nativeMax(0, ceil((end - start) / step)),
        result = Array(length);

    while (++index < length) {
      result[index] = start;
      start += step;
    }
    return result;
  }

  /**
   * The opposite of `_.initial`, this method gets all but the first value of `array`.
   * If a number `n` is passed, the first `n` values are excluded from the result.
   * If a `callback` function is passed, the first elements the `callback` returns
   * truthy for are excluded from the result. The `callback` is bound to `thisArg`
   * and invoked with three arguments; (value, index, array).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @alias drop, tail
   * @category Arrays
   * @param {Array} array The array to query.
   * @param {Function|Object|Number|String} [callback|n=1] The function called
   *  per element or the number of elements to exclude. If a property name or
   *  object is passed, it will be used to create a "_.pluck" or "_.where"
   *  style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array} Returns a slice of `array`.
   * @example
   *
   * _.rest([1, 2, 3]);
   * // => [2, 3]
   *
   * _.rest([1, 2, 3], 2);
   * // => [3]
   *
   * _.rest([1, 2, 3], function(num) {
   *   return num < 3;
   * });
   * // => [3]
   *
   * var food = [
   *   { 'name': 'banana', 'organic': true },
   *   { 'name': 'beet',   'organic': false },
   * ];
   *
   * // using "_.pluck" callback shorthand
   * _.rest(food, 'organic');
   * // => [{ 'name': 'beet', 'organic': false }]
   *
   * var food = [
   *   { 'name': 'apple',  'type': 'fruit' },
   *   { 'name': 'banana', 'type': 'fruit' },
   *   { 'name': 'beet',   'type': 'vegetable' }
   * ];
   *
   * // using "_.where" callback shorthand
   * _.rest(food, { 'type': 'fruit' });
   * // => [{ 'name': 'beet', 'type': 'vegetable' }]
   */
  function rest(array, callback, thisArg) {
    if (typeof callback != 'number' && callback != null) {
      var n = 0,
          index = -1,
          length = array ? array.length : 0;

      callback = createCallback(callback, thisArg);
      while (++index < length && callback(array[index], index, array)) {
        n++;
      }
    } else {
      n = (callback == null || thisArg) ? 1 : nativeMax(0, callback);
    }
    return slice(array, n);
  }

  /**
   * Uses a binary search to determine the smallest index at which the `value`
   * should be inserted into `array` in order to maintain the sort order of the
   * sorted `array`. If `callback` is passed, it will be executed for `value` and
   * each element in `array` to compute their sort ranking. The `callback` is
   * bound to `thisArg` and invoked with one argument; (value).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to iterate over.
   * @param {Mixed} value The value to evaluate.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Number} Returns the index at which the value should be inserted
   *  into `array`.
   * @example
   *
   * _.sortedIndex([20, 30, 50], 40);
   * // => 2
   *
   * // using "_.pluck" callback shorthand
   * _.sortedIndex([{ 'x': 20 }, { 'x': 30 }, { 'x': 50 }], { 'x': 40 }, 'x');
   * // => 2
   *
   * var dict = {
   *   'wordToNumber': { 'twenty': 20, 'thirty': 30, 'fourty': 40, 'fifty': 50 }
   * };
   *
   * _.sortedIndex(['twenty', 'thirty', 'fifty'], 'fourty', function(word) {
   *   return dict.wordToNumber[word];
   * });
   * // => 2
   *
   * _.sortedIndex(['twenty', 'thirty', 'fifty'], 'fourty', function(word) {
   *   return this.wordToNumber[word];
   * }, dict);
   * // => 2
   */
  function sortedIndex(array, value, callback, thisArg) {
    var low = 0,
        high = array ? array.length : low;

    // explicitly reference `identity` for better inlining in Firefox
    callback = callback ? createCallback(callback, thisArg, 1) : identity;
    value = callback(value);

    while (low < high) {
      var mid = (low + high) >>> 1;
      callback(array[mid]) < value
        ? low = mid + 1
        : high = mid;
    }
    return low;
  }

  /**
   * Computes the union of the passed-in arrays using strict equality for
   * comparisons, i.e. `===`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} [array1, array2, ...] Arrays to process.
   * @returns {Array} Returns a new array of unique values, in order, that are
   *  present in one or more of the arrays.
   * @example
   *
   * _.union([1, 2, 3], [101, 2, 1, 10], [2, 1]);
   * // => [1, 2, 3, 101, 10]
   */
  function union() {
    return uniq(concat.apply(arrayRef, arguments));
  }

  /**
   * Creates a duplicate-value-free version of the `array` using strict equality
   * for comparisons, i.e. `===`. If the `array` is already sorted, passing `true`
   * for `isSorted` will run a faster algorithm. If `callback` is passed, each
   * element of `array` is passed through a callback` before uniqueness is computed.
   * The `callback` is bound to `thisArg` and invoked with three arguments; (value, index, array).
   *
   * If a property name is passed for `callback`, the created "_.pluck" style
   * callback will return the property value of the given element.
   *
   * If an object is passed for `callback`, the created "_.where" style callback
   * will return `true` for elements that have the propeties of the given object,
   * else `false`.
   *
   * @static
   * @memberOf _
   * @alias unique
   * @category Arrays
   * @param {Array} array The array to process.
   * @param {Boolean} [isSorted=false] A flag to indicate that the `array` is already sorted.
   * @param {Function|Object|String} [callback=identity] The function called per
   *  iteration. If a property name or object is passed, it will be used to create
   *  a "_.pluck" or "_.where" style callback, respectively.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array} Returns a duplicate-value-free array.
   * @example
   *
   * _.uniq([1, 2, 1, 3, 1]);
   * // => [1, 2, 3]
   *
   * _.uniq([1, 1, 2, 2, 3], true);
   * // => [1, 2, 3]
   *
   * _.uniq([1, 2, 1.5, 3, 2.5], function(num) { return Math.floor(num); });
   * // => [1, 2, 3]
   *
   * _.uniq([1, 2, 1.5, 3, 2.5], function(num) { return this.floor(num); }, Math);
   * // => [1, 2, 3]
   *
   * // using "_.pluck" callback shorthand
   * _.uniq([{ 'x': 1 }, { 'x': 2 }, { 'x': 1 }], 'x');
   * // => [{ 'x': 1 }, { 'x': 2 }]
   */
  function uniq(array, isSorted, callback, thisArg) {
    var index = -1,
        length = array ? array.length : 0,
        result = [],
        seen = result;

    if (typeof isSorted == 'function') {
      thisArg = callback;
      callback = isSorted;
      isSorted = false;
    }
    if (callback) {
      seen = [];
      callback = createCallback(callback, thisArg);
    }
    while (++index < length) {
      var value = array[index],
          computed = callback ? callback(value, index, array) : value;

      if (isSorted
            ? !index || seen[seen.length - 1] !== computed
            : indexOf(seen, computed) < 0
          ) {
        if (callback) {
          seen.push(computed);
        }
        result.push(value);
      }
    }
    return result;
  }

  /**
   * Creates an array with all occurrences of the passed values removed using
   * strict equality for comparisons, i.e. `===`.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} array The array to filter.
   * @param {Mixed} [value1, value2, ...] Values to remove.
   * @returns {Array} Returns a new filtered array.
   * @example
   *
   * _.without([1, 2, 1, 0, 3, 1, 4], 0, 1);
   * // => [2, 3, 4]
   */
  function without(array) {
    var index = -1,
        length = array.length,
        result = [];

    while (++index < length) {
      var value = array[index]
      if (indexOf(arguments, value, 1) < 0) {
        result.push(value);
      }
    }
    return result
  }

  /**
   * Groups the elements of each array at their corresponding indexes. Useful for
   * separate data sources that are coordinated through matching array indexes.
   * For a matrix of nested arrays, `_.zip.apply(...)` can transpose the matrix
   * in a similar fashion.
   *
   * @static
   * @memberOf _
   * @category Arrays
   * @param {Array} [array1, array2, ...] Arrays to process.
   * @returns {Array} Returns a new array of grouped elements.
   * @example
   *
   * _.zip(['moe', 'larry'], [30, 40], [true, false]);
   * // => [['moe', 30, true], ['larry', 40, false]]
   */
  function zip(array) {
    var index = -1,
        length = array ? max(pluck(arguments, 'length')) : 0,
        result = Array(length);

    while (++index < length) {
      result[index] = pluck(arguments, index);
    }
    return result;
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Creates a function that is restricted to executing `func` only after it is
   * called `n` times. The `func` is executed with the `this` binding of the
   * created function.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Number} n The number of times the function must be called before
   * it is executed.
   * @param {Function} func The function to restrict.
   * @returns {Function} Returns the new restricted function.
   * @example
   *
   * var renderNotes = _.after(notes.length, render);
   * _.forEach(notes, function(note) {
   *   note.asyncSave({ 'success': renderNotes });
   * });
   * // `renderNotes` is run once, after all notes have saved
   */
  function after(n, func) {
    if (n < 1) {
      return func();
    }
    return function() {
      if (--n < 1) {
        return func.apply(this, arguments);
      }
    };
  }

  /**
   * Creates a function that, when called, invokes `func` with the `this`
   * binding of `thisArg` and prepends any additional `bind` arguments to those
   * passed to the bound function.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} func The function to bind.
   * @param {Mixed} [thisArg] The `this` binding of `func`.
   * @param {Mixed} [arg1, arg2, ...] Arguments to be partially applied.
   * @returns {Function} Returns the new bound function.
   * @example
   *
   * var func = function(greeting) {
   *   return greeting + ' ' + this.name;
   * };
   *
   * func = _.bind(func, { 'name': 'moe' }, 'hi');
   * func();
   * // => 'hi moe'
   */
  function bind(func, thisArg) {
    // use `Function#bind` if it exists and is fast
    // (in V8 `Function#bind` is slower except when partially applied)
    return isBindFast || (nativeBind && arguments.length > 2)
      ? nativeBind.call.apply(nativeBind, arguments)
      : createBound(func, thisArg, slice(arguments, 2));
  }

  /**
   * Binds methods on `object` to `object`, overwriting the existing method.
   * Method names may be specified as individual arguments or as arrays of method
   * names. If no method names are provided, all the function properties of `object`
   * will be bound.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Object} object The object to bind and assign the bound methods to.
   * @param {String} [methodName1, methodName2, ...] Method names on the object to bind.
   * @returns {Object} Returns `object`.
   * @example
   *
   * var view = {
   *  'label': 'docs',
   *  'onClick': function() { alert('clicked ' + this.label); }
   * };
   *
   * _.bindAll(view);
   * jQuery('#docs').on('click', view.onClick);
   * // => alerts 'clicked docs', when the button is clicked
   */
  function bindAll(object) {
    var funcs = concat.apply(arrayRef, arguments),
        index = funcs.length > 1 ? 0 : (funcs = functions(object), -1),
        length = funcs.length;

    while (++index < length) {
      var key = funcs[index];
      object[key] = bind(object[key], object);
    }
    return object;
  }

  /**
   * Creates a function that is the composition of the passed functions,
   * where each function consumes the return value of the function that follows.
   * For example, composing the functions `f()`, `g()`, and `h()` produces `f(g(h()))`.
   * Each function is executed with the `this` binding of the composed function.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} [func1, func2, ...] Functions to compose.
   * @returns {Function} Returns the new composed function.
   * @example
   *
   * var greet = function(name) { return 'hi ' + name; };
   * var exclaim = function(statement) { return statement + '!'; };
   * var welcome = _.compose(exclaim, greet);
   * welcome('moe');
   * // => 'hi moe!'
   */
  function compose() {
    var funcs = arguments;
    return function() {
      var args = arguments,
          length = funcs.length;

      while (length--) {
        args = [funcs[length].apply(this, args)];
      }
      return args[0];
    };
  }

  /**
   * Creates a function that will delay the execution of `func` until after
   * `wait` milliseconds have elapsed since the last time it was invoked. Pass
   * `true` for `immediate` to cause debounce to invoke `func` on the leading,
   * instead of the trailing, edge of the `wait` timeout. Subsequent calls to
   * the debounced function will return the result of the last `func` call.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} func The function to debounce.
   * @param {Number} wait The number of milliseconds to delay.
   * @param {Boolean} immediate A flag to indicate execution is on the leading
   *  edge of the timeout.
   * @returns {Function} Returns the new debounced function.
   * @example
   *
   * var lazyLayout = _.debounce(calculateLayout, 300);
   * jQuery(window).on('resize', lazyLayout);
   */
  function debounce(func, wait, immediate) {
    var args,
        result,
        thisArg,
        timeoutId;

    function delayed() {
      timeoutId = null;
      if (!immediate) {
        result = func.apply(thisArg, args);
      }
    }
    return function() {
      var isImmediate = immediate && !timeoutId;
      args = arguments;
      thisArg = this;

      clearTimeout(timeoutId);
      timeoutId = setTimeout(delayed, wait);

      if (isImmediate) {
        result = func.apply(thisArg, args);
      }
      return result;
    };
  }

  /**
   * Executes the `func` function after `wait` milliseconds. Additional arguments
   * will be passed to `func` when it is invoked.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} func The function to delay.
   * @param {Number} wait The number of milliseconds to delay execution.
   * @param {Mixed} [arg1, arg2, ...] Arguments to invoke the function with.
   * @returns {Number} Returns the `setTimeout` timeout id.
   * @example
   *
   * var log = _.bind(console.log, console);
   * _.delay(log, 1000, 'logged later');
   * // => 'logged later' (Appears after one second.)
   */
  function delay(func, wait) {
    var args = slice(arguments, 2);
    return setTimeout(function() { func.apply(undefined, args); }, wait);
  }

  /**
   * Defers executing the `func` function until the current call stack has cleared.
   * Additional arguments will be passed to `func` when it is invoked.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} func The function to defer.
   * @param {Mixed} [arg1, arg2, ...] Arguments to invoke the function with.
   * @returns {Number} Returns the `setTimeout` timeout id.
   * @example
   *
   * _.defer(function() { alert('deferred'); });
   * // returns from the function before `alert` is called
   */
  function defer(func) {
    var args = slice(arguments, 1);
    return setTimeout(function() { func.apply(undefined, args); }, 1);
  }

  /**
   * Creates a function that memoizes the result of `func`. If `resolver` is
   * passed, it will be used to determine the cache key for storing the result
   * based on the arguments passed to the memoized function. By default, the first
   * argument passed to the memoized function is used as the cache key. The `func`
   * is executed with the `this` binding of the memoized function.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} func The function to have its output memoized.
   * @param {Function} [resolver] A function used to resolve the cache key.
   * @returns {Function} Returns the new memoizing function.
   * @example
   *
   * var fibonacci = _.memoize(function(n) {
   *   return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
   * });
   */
  function memoize(func, resolver) {
    var cache = {};
    return function() {
      var key = (resolver ? resolver.apply(this, arguments) : arguments[0]) + '';
      return hasOwnProperty.call(cache, key)
        ? cache[key]
        : (cache[key] = func.apply(this, arguments));
    };
  }

  /**
   * Creates a function that is restricted to execute `func` once. Repeat calls to
   * the function will return the value of the first call. The `func` is executed
   * with the `this` binding of the created function.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} func The function to restrict.
   * @returns {Function} Returns the new restricted function.
   * @example
   *
   * var initialize = _.once(createApplication);
   * initialize();
   * initialize();
   * // `initialize` executes `createApplication` once
   */
  function once(func) {
    var ran,
        result;

    return function() {
      if (ran) {
        return result;
      }
      ran = true;
      result = func.apply(this, arguments);

      // clear the `func` variable so the function may be garbage collected
      func = null;
      return result;
    };
  }

  /**
   * Creates a function that, when called, invokes `func` with any additional
   * `partial` arguments prepended to those passed to the new function. This
   * method is similar to `_.bind`, except it does **not** alter the `this` binding.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} func The function to partially apply arguments to.
   * @param {Mixed} [arg1, arg2, ...] Arguments to be partially applied.
   * @returns {Function} Returns the new partially applied function.
   * @example
   *
   * var greet = function(greeting, name) { return greeting + ' ' + name; };
   * var hi = _.partial(greet, 'hi');
   * hi('moe');
   * // => 'hi moe'
   */
  function partial(func) {
    return createBound(func, slice(arguments, 1));
  }

  /**
   * Creates a function that, when executed, will only call the `func`
   * function at most once per every `wait` milliseconds. If the throttled
   * function is invoked more than once during the `wait` timeout, `func` will
   * also be called on the trailing edge of the timeout. Subsequent calls to the
   * throttled function will return the result of the last `func` call.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Function} func The function to throttle.
   * @param {Number} wait The number of milliseconds to throttle executions to.
   * @returns {Function} Returns the new throttled function.
   * @example
   *
   * var throttled = _.throttle(updatePosition, 100);
   * jQuery(window).on('scroll', throttled);
   */
  function throttle(func, wait) {
    var args,
        result,
        thisArg,
        timeoutId,
        lastCalled = 0;

    function trailingCall() {
      lastCalled = new Date;
      timeoutId = null;
      result = func.apply(thisArg, args);
    }
    return function() {
      var now = new Date,
          remaining = wait - (now - lastCalled);

      args = arguments;
      thisArg = this;

      if (remaining <= 0) {
        clearTimeout(timeoutId);
        timeoutId = null;
        lastCalled = now;
        result = func.apply(thisArg, args);
      }
      else if (!timeoutId) {
        timeoutId = setTimeout(trailingCall, remaining);
      }
      return result;
    };
  }

  /**
   * Creates a function that passes `value` to the `wrapper` function as its
   * first argument. Additional arguments passed to the function are appended
   * to those passed to the `wrapper` function. The `wrapper` is executed with
   * the `this` binding of the created function.
   *
   * @static
   * @memberOf _
   * @category Functions
   * @param {Mixed} value The value to wrap.
   * @param {Function} wrapper The wrapper function.
   * @returns {Function} Returns the new function.
   * @example
   *
   * var hello = function(name) { return 'hello ' + name; };
   * hello = _.wrap(hello, function(func) {
   *   return 'before, ' + func('moe') + ', after';
   * });
   * hello();
   * // => 'before, hello moe, after'
   */
  function wrap(value, wrapper) {
    return function() {
      var args = [value];
      push.apply(args, arguments);
      return wrapper.apply(this, args);
    };
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Converts the characters `&`, `<`, `>`, `"`, and `'` in `string` to their
   * corresponding HTML entities.
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {String} string The string to escape.
   * @returns {String} Returns the escaped string.
   * @example
   *
   * _.escape('Moe, Larry & Curly');
   * // => 'Moe, Larry &amp; Curly'
   */
  function escape(string) {
    return string == null ? '' : (string + '').replace(reUnescapedHtml, escapeHtmlChar);
  }

  /**
   * This function returns the first argument passed to it.
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {Mixed} value Any value.
   * @returns {Mixed} Returns `value`.
   * @example
   *
   * var moe = { 'name': 'moe' };
   * moe === _.identity(moe);
   * // => true
   */
  function identity(value) {
    return value;
  }

  /**
   * Adds functions properties of `object` to the `lodash` function and chainable
   * wrapper.
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {Object} object The object of function properties to add to `lodash`.
   * @example
   *
   * _.mixin({
   *   'capitalize': function(string) {
   *     return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
   *   }
   * });
   *
   * _.capitalize('moe');
   * // => 'Moe'
   *
   * _('moe').capitalize();
   * // => 'Moe'
   */
  function mixin(object) {
    forEach(functions(object), function(methodName) {
      var func = lodash[methodName] = object[methodName];

      lodash.prototype[methodName] = function() {
        var args = [this.__wrapped__];
        push.apply(args, arguments);
        
        var result = func.apply(lodash, args);
        if (this.__chain__) {
          result = new lodash(result);
          result.__chain__ = true;
        }
        return result;
      };
    });
  }

  /**
   * Reverts the '_' variable to its previous value and returns a reference to
   * the `lodash` function.
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @returns {Function} Returns the `lodash` function.
   * @example
   *
   * var lodash = _.noConflict();
   */
  function noConflict() {
    window._ = oldDash;
    return this;
  }

  /**
   * Produces a random number between `min` and `max` (inclusive). If only one
   * argument is passed, a number between `0` and the given number will be returned.
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {Number} [min=0] The minimum possible value.
   * @param {Number} [max=1] The maximum possible value.
   * @returns {Number} Returns a random number.
   * @example
   *
   * _.random(0, 5);
   * // => a number between 0 and 5
   *
   * _.random(5);
   * // => also a number between 0 and 5
   */
  function random(min, max) {
    if (min == null && max == null) {
      max = 1;
    }
    min = +min || 0;
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + floor(nativeRandom() * ((+max || 0) - min + 1));
  }

  /**
   * Resolves the value of `property` on `object`. If `property` is a function,
   * it will be invoked and its result returned, else the property value is
   * returned. If `object` is falsey, then `null` is returned.
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {Object} object The object to inspect.
   * @param {String} property The property to get the value of.
   * @returns {Mixed} Returns the resolved value.
   * @example
   *
   * var object = {
   *   'cheese': 'crumpets',
   *   'stuff': function() {
   *     return 'nonsense';
   *   }
   * };
   *
   * _.result(object, 'cheese');
   * // => 'crumpets'
   *
   * _.result(object, 'stuff');
   * // => 'nonsense'
   */
  function result(object, property) {
    var value = object ? object[property] : null;
    return isFunction(value) ? object[property]() : value;
  }

  /**
   * A micro-templating method that handles arbitrary delimiters, preserves
   * whitespace, and correctly escapes quotes within interpolated code.
   *
   * Note: In the development build, `_.template` utilizes sourceURLs for easier
   * debugging. See http://www.html5rocks.com/en/tutorials/developertools/sourcemaps/#toc-sourceurl
   *
   * Note: Lo-Dash may be used in Chrome extensions by either creating a `lodash csp`
   * build and using precompiled templates, or loading Lo-Dash in a sandbox.
   *
   * For more information on precompiling templates see:
   * http://lodash.com/#custom-builds
   *
   * For more information on Chrome extension sandboxes see:
   * http://developer.chrome.com/stable/extensions/sandboxingEval.html
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {String} text The template text.
   * @param {Obect} data The data object used to populate the text.
   * @param {Object} options The options object.
   *  escape - The "escape" delimiter regexp.
   *  evaluate - The "evaluate" delimiter regexp.
   *  interpolate - The "interpolate" delimiter regexp.
   *  sourceURL - The sourceURL of the template's compiled source.
   *  variable - The data object variable name.
   *
   * @returns {Function|String} Returns a compiled function when no `data` object
   *  is given, else it returns the interpolated text.
   * @example
   *
   * // using a compiled template
   * var compiled = _.template('hello <%= name %>');
   * compiled({ 'name': 'moe' });
   * // => 'hello moe'
   *
   * var list = '<% _.forEach(people, function(name) { %><li><%= name %></li><% }); %>';
   * _.template(list, { 'people': ['moe', 'larry'] });
   * // => '<li>moe</li><li>larry</li>'
   *
   * // using the "escape" delimiter to escape HTML in data property values
   * _.template('<b><%- value %></b>', { 'value': '<script>' });
   * // => '<b>&lt;script&gt;</b>'
   *
   * // using the ES6 delimiter as an alternative to the default "interpolate" delimiter
   * _.template('hello ${ name }', { 'name': 'curly' });
   * // => 'hello curly'
   *
   * // using the internal `print` function in "evaluate" delimiters
   * _.template('<% print("hello " + epithet); %>!', { 'epithet': 'stooge' });
   * // => 'hello stooge!'
   *
   * // using custom template delimiters
   * _.templateSettings = {
   *   'interpolate': /{{([\s\S]+?)}}/g
   * };
   *
   * _.template('hello {{ name }}!', { 'name': 'mustache' });
   * // => 'hello mustache!'
   *
   * // using the `sourceURL` option to specify a custom sourceURL for the template
   * var compiled = _.template('hello <%= name %>', null, { 'sourceURL': '/basic/greeting.jst' });
   * compiled(data);
   * // => find the source of "greeting.jst" under the Sources tab or Resources panel of the web inspector
   *
   * // using the `variable` option to ensure a with-statement isn't used in the compiled template
   * var compiled = _.template('hi <%= data.name %>!', null, { 'variable': 'data' });
   * compiled.source;
   * // => function(data) {
   *   var __t, __p = '', __e = _.escape;
   *   __p += 'hi ' + ((__t = ( data.name )) == null ? '' : __t) + '!';
   *   return __p;
   * }
   *
   * // using the `source` property to inline compiled templates for meaningful
   * // line numbers in error messages and a stack trace
   * fs.writeFileSync(path.join(cwd, 'jst.js'), '\
   *   var JST = {\
   *     "main": ' + _.template(mainText).source + '\
   *   };\
   * ');
   */
  function template(text, data, options) {
    text || (text = '');
    options = defaults({}, options, lodash.templateSettings);

    var index = 0,
        source = "__p += '",
        variable = options.variable;

    var reDelimiters = RegExp(
      (options.escape || reNoMatch).source + '|' +
      (options.interpolate || reNoMatch).source + '|' +
      (options.evaluate || reNoMatch).source + '|$'
    , 'g');

    text.replace(reDelimiters, function(match, escapeValue, interpolateValue, evaluateValue, offset) {
      source += text.slice(index, offset).replace(reUnescapedString, escapeStringChar);
      if (escapeValue) {
        source += "' +\n_.escape(" + escapeValue + ") +\n'";
      }
      if (evaluateValue) {
        source += "';\n" + evaluateValue + ";\n__p += '";
      }
      if (interpolateValue) {
        source += "' +\n((__t = (" + interpolateValue + ")) == null ? '' : __t) +\n'";
      }
      index = offset + match.length;
      return match;
    });

    source += "';\n";
    if (!variable) {
      variable = 'obj';
      source = 'with (' + variable + ' || {}) {\n' + source + '\n}\n';
    }
    source = 'function(' + variable + ') {\n' +
      "var __t, __p = '', __j = Array.prototype.join;\n" +
      "function print() { __p += __j.call(arguments, '') }\n" +
      source +
      'return __p\n}';

    try {
      var result = Function('_', 'return ' + source)(lodash);
    } catch(e) {
      e.source = source;
      throw e;
    }
    if (data) {
      return result(data);
    }
    result.source = source;
    return result;
  }

  /**
   * Executes the `callback` function `n` times, returning an array of the results
   * of each `callback` execution. The `callback` is bound to `thisArg` and invoked
   * with one argument; (index).
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {Number} n The number of times to execute the callback.
   * @param {Function} callback The function called per iteration.
   * @param {Mixed} [thisArg] The `this` binding of `callback`.
   * @returns {Array} Returns a new array of the results of each `callback` execution.
   * @example
   *
   * var diceRolls = _.times(3, _.partial(_.random, 1, 6));
   * // => [3, 6, 4]
   *
   * _.times(3, function(n) { mage.castSpell(n); });
   * // => calls `mage.castSpell(n)` three times, passing `n` of `0`, `1`, and `2` respectively
   *
   * _.times(3, function(n) { this.cast(n); }, mage);
   * // => also calls `mage.castSpell(n)` three times
   */
  function times(n, callback, thisArg) {
    n = +n || 0;
    var index = -1,
        result = Array(n);

    while (++index < n) {
      result[index] = callback.call(thisArg, index);
    }
    return result;
  }

  /**
   * The opposite of `_.escape`, this method converts the HTML entities
   * `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;` in `string` to their
   * corresponding characters.
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {String} string The string to unescape.
   * @returns {String} Returns the unescaped string.
   * @example
   *
   * _.unescape('Moe, Larry &amp; Curly');
   * // => 'Moe, Larry & Curly'
   */
  function unescape(string) {
    return string == null ? '' : (string + '').replace(reEscapedHtml, unescapeHtmlChar);
  }

  /**
   * Generates a unique ID. If `prefix` is passed, the ID will be appended to it.
   *
   * @static
   * @memberOf _
   * @category Utilities
   * @param {String} [prefix] The value to prefix the ID with.
   * @returns {String} Returns the unique ID.
   * @example
   *
   * _.uniqueId('contact_');
   * // => 'contact_104'
   *
   * _.uniqueId();
   * // => '105'
   */
  function uniqueId(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Creates a `lodash` object that wraps the given `value`.
   *
   * @static
   * @memberOf _
   * @category Chaining
   * @param {Mixed} value The value to wrap.
   * @returns {Object} Returns the wrapper object.
   * @example
   *
   * var stooges = [
   *   { 'name': 'moe', 'age': 40 },
   *   { 'name': 'larry', 'age': 50 },
   *   { 'name': 'curly', 'age': 60 }
   * ];
   *
   * var youngest = _.chain(stooges)
   *     .sortBy(function(stooge) { return stooge.age; })
   *     .map(function(stooge) { return stooge.name + ' is ' + stooge.age; })
   *     .first();
   * // => 'moe is 40'
   */
  function chain(value) {
    value = new lodash(value);
    value.__chain__ = true;
    return value;
  }

  /**
   * Invokes `interceptor` with the `value` as the first argument, and then
   * returns `value`. The purpose of this method is to "tap into" a method chain,
   * in order to perform operations on intermediate results within the chain.
   *
   * @static
   * @memberOf _
   * @category Chaining
   * @param {Mixed} value The value to pass to `interceptor`.
   * @param {Function} interceptor The function to invoke.
   * @returns {Mixed} Returns `value`.
   * @example
   *
   * _([1, 2, 3, 4])
   *  .filter(function(num) { return num % 2 == 0; })
   *  .tap(alert)
   *  .map(function(num) { return num * num; })
   *  .value();
   * // => // [2, 4] (alerted)
   * // => [4, 16]
   */
  function tap(value, interceptor) {
    interceptor(value);
    return value;
  }

  /**
   * Enables method chaining on the wrapper object.
   *
   * @name chain
   * @memberOf _
   * @category Chaining
   * @returns {Mixed} Returns the wrapper object.
   * @example
   *
   * var sum = _([1, 2, 3])
   *     .chain()
   *     .reduce(function(sum, num) { return sum + num; })
   *     .value()
   * // => 6`
   */
  function wrapperChain() {
    this.__chain__ = true;
    return this;
  }

  /**
   * Produces the `toString` result of the wrapped value.
   *
   * @name toString
   * @memberOf _
   * @category Chaining
   * @returns {String} Returns the string result.
   * @example
   *
   * _([1, 2, 3]).toString();
   * // => '1,2,3'
   */
  function wrapperToString() {
    return this.__wrapped__ + '';
  }

  /**
   * Extracts the wrapped value.
   *
   * @name valueOf
   * @memberOf _
   * @alias value
   * @category Chaining
   * @returns {Mixed} Returns the wrapped value.
   * @example
   *
   * _([1, 2, 3]).valueOf();
   * // => [1, 2, 3]
   */
  function wrapperValueOf() {
    return this.__wrapped__;
  }

  /*--------------------------------------------------------------------------*/

  // add functions that return wrapped values when chaining
  lodash.after = after;
  lodash.bind = bind;
  lodash.bindAll = bindAll;
  lodash.compact = compact;
  lodash.compose = compose;
  lodash.countBy = countBy;
  lodash.debounce = debounce;
  lodash.defaults = defaults;
  lodash.defer = defer;
  lodash.delay = delay;
  lodash.difference = difference;
  lodash.filter = filter;
  lodash.flatten = flatten;
  lodash.forEach = forEach;
  lodash.functions = functions;
  lodash.groupBy = groupBy;
  lodash.initial = initial;
  lodash.intersection = intersection;
  lodash.invert = invert;
  lodash.invoke = invoke;
  lodash.keys = keys;
  lodash.map = map;
  lodash.max = max;
  lodash.memoize = memoize;
  lodash.min = min;
  lodash.object = object;
  lodash.omit = omit;
  lodash.once = once;
  lodash.pairs = pairs;
  lodash.partial = partial;
  lodash.pick = pick;
  lodash.pluck = pluck;
  lodash.range = range;
  lodash.reject = reject;
  lodash.rest = rest;
  lodash.shuffle = shuffle;
  lodash.sortBy = sortBy;
  lodash.tap = tap;
  lodash.throttle = throttle;
  lodash.times = times;
  lodash.toArray = toArray;
  lodash.union = union;
  lodash.uniq = uniq;
  lodash.values = values;
  lodash.where = where;
  lodash.without = without;
  lodash.wrap = wrap;
  lodash.zip = zip;

  // add aliases
  lodash.collect = map;
  lodash.drop = rest;
  lodash.each = forEach;
  lodash.extend = assign;
  lodash.methods = functions;
  lodash.select = filter;
  lodash.tail = rest;
  lodash.unique = uniq;

  /*--------------------------------------------------------------------------*/

  // add functions that return unwrapped values when chaining
  lodash.clone = clone;
  lodash.contains = contains;
  lodash.escape = escape;
  lodash.every = every;
  lodash.find = find;
  lodash.findWhere = findWhere;
  lodash.has = has;
  lodash.identity = identity;
  lodash.indexOf = indexOf;
  lodash.isArguments = isArguments;
  lodash.isArray = isArray;
  lodash.isBoolean = isBoolean;
  lodash.isDate = isDate;
  lodash.isElement = isElement;
  lodash.isEmpty = isEmpty;
  lodash.isEqual = isEqual;
  lodash.isFinite = isFinite;
  lodash.isFunction = isFunction;
  lodash.isNaN = isNaN;
  lodash.isNull = isNull;
  lodash.isNumber = isNumber;
  lodash.isObject = isObject;
  lodash.isRegExp = isRegExp;
  lodash.isString = isString;
  lodash.isUndefined = isUndefined;
  lodash.lastIndexOf = lastIndexOf;
  lodash.mixin = mixin;
  lodash.noConflict = noConflict;
  lodash.random = random;
  lodash.reduce = reduce;
  lodash.reduceRight = reduceRight;
  lodash.result = result;
  lodash.size = size;
  lodash.some = some;
  lodash.sortedIndex = sortedIndex;
  lodash.template = template;
  lodash.unescape = unescape;
  lodash.uniqueId = uniqueId;

  // add aliases
  lodash.all = every;
  lodash.any = some;
  lodash.detect = find;
  lodash.foldl = reduce;
  lodash.foldr = reduceRight;
  lodash.include = contains;
  lodash.inject = reduce;

  /*--------------------------------------------------------------------------*/

  // add functions capable of returning wrapped and unwrapped values when chaining
  lodash.first = first;
  lodash.last = last;

  // add aliases
  lodash.take = first;
  lodash.head = first;

  /*--------------------------------------------------------------------------*/

  lodash.chain = chain;

  /**
   * The semantic version number.
   *
   * @static
   * @memberOf _
   * @type String
   */
  lodash.VERSION = '1.0.0';

  // add functions to `lodash.prototype`
  mixin(lodash);

  // add "Chaining" functions to the wrapper
  lodash.prototype.chain = wrapperChain;
  lodash.prototype.value = wrapperValueOf;

  // add `Array` mutator functions to the wrapper
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(methodName) {
    var func = arrayRef[methodName];
    lodash.prototype[methodName] = function() {
      var value = this.__wrapped__;
      func.apply(value, arguments);

      // avoid array-like object bugs with `Array#shift` and `Array#splice`
      // in Firefox < 10 and IE < 9
      if (hasObjectSpliceBug && value.length === 0) {
        delete value[0];
      }
      return this;
    };
  });

  // add `Array` accessor functions to the wrapper
  each(['concat', 'join', 'slice'], function(methodName) {
    var func = arrayRef[methodName];
    lodash.prototype[methodName] = function() {
      var value = this.__wrapped__,
          result = func.apply(value, arguments);

      if (this.__chain__) {
        result = new lodash(result);
        result.__chain__ = true;
      }
      return result;
    };
  });

  /*--------------------------------------------------------------------------*/

  if (freeExports) {
    // in Node.js or RingoJS v0.8.0+
    if (typeof module == 'object' && module && module.exports == freeExports) {
      (module.exports = lodash)._ = lodash;
    }
    // in Narwhal or RingoJS v0.7.0-
    else {
      freeExports._ = lodash;
    }
  }
  else {
    // in a browser or Rhino
    window._ = lodash;
  }
}(this));

define("lodash", (function (global) {
    return function () {
        var ret, fn;
        return ret || global._;
    };
}(this)));

//     Backbone.js 0.9.10

//     (c) 2010-2012 Jeremy Ashkenas, DocumentCloud Inc.
//     Backbone may be freely distributed under the MIT license.
//     For all details and documentation:
//     http://backbonejs.org

(function(){

  // Initial Setup
  // -------------

  // Save a reference to the global object (`window` in the browser, `exports`
  // on the server).
  var root = this;

  // Save the previous value of the `Backbone` variable, so that it can be
  // restored later on, if `noConflict` is used.
  var previousBackbone = root.Backbone;

  // Create a local reference to array methods.
  var array = [];
  var push = array.push;
  var slice = array.slice;
  var splice = array.splice;

  // The top-level namespace. All public Backbone classes and modules will
  // be attached to this. Exported for both CommonJS and the browser.
  var Backbone;
  if (typeof exports !== 'undefined') {
    Backbone = exports;
  } else {
    Backbone = root.Backbone = {};
  }

  // Current version of the library. Keep in sync with `package.json`.
  Backbone.VERSION = '0.9.10';

  // Require Underscore, if we're on the server, and it's not already present.
  var _ = root._;
  if (!_ && (typeof require !== 'undefined')) _ = require('underscore');

  // For Backbone's purposes, jQuery, Zepto, or Ender owns the `$` variable.
  Backbone.$ = root.jQuery || root.Zepto || root.ender;

  // Runs Backbone.js in *noConflict* mode, returning the `Backbone` variable
  // to its previous owner. Returns a reference to this Backbone object.
  Backbone.noConflict = function() {
    root.Backbone = previousBackbone;
    return this;
  };

  // Turn on `emulateHTTP` to support legacy HTTP servers. Setting this option
  // will fake `"PUT"` and `"DELETE"` requests via the `_method` parameter and
  // set a `X-Http-Method-Override` header.
  Backbone.emulateHTTP = false;

  // Turn on `emulateJSON` to support legacy servers that can't deal with direct
  // `application/json` requests ... will encode the body as
  // `application/x-www-form-urlencoded` instead and will send the model in a
  // form param named `model`.
  Backbone.emulateJSON = false;

  // Backbone.Events
  // ---------------

  // Regular expression used to split event strings.
  var eventSplitter = /\s+/;

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  var eventsApi = function(obj, action, name, rest) {
    if (!name) return true;
    if (typeof name === 'object') {
      for (var key in name) {
        obj[action].apply(obj, [key, name[key]].concat(rest));
      }
    } else if (eventSplitter.test(name)) {
      var names = name.split(eventSplitter);
      for (var i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
    } else {
      return true;
    }
  };

  // Optimized internal dispatch function for triggering events. Tries to
  // keep the usual cases speedy (most Backbone events have 3 arguments).
  var triggerEvents = function(events, args) {
    var ev, i = -1, l = events.length;
    switch (args.length) {
    case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx);
    return;
    case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, args[0]);
    return;
    case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, args[0], args[1]);
    return;
    case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, args[0], args[1], args[2]);
    return;
    default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args);
    }
  };

  // A module that can be mixed in to *any object* in order to provide it with
  // custom events. You may bind with `on` or remove with `off` callback
  // functions to an event; `trigger`-ing an event fires all callbacks in
  // succession.
  //
  //     var object = {};
  //     _.extend(object, Backbone.Events);
  //     object.on('expand', function(){ alert('expanded'); });
  //     object.trigger('expand');
  //
  var Events = Backbone.Events = {

    // Bind one or more space separated events, or an events map,
    // to a `callback` function. Passing `"all"` will bind the callback to
    // all events fired.
    on: function(name, callback, context) {
      if (!(eventsApi(this, 'on', name, [callback, context]) && callback)) return this;
      this._events || (this._events = {});
      var list = this._events[name] || (this._events[name] = []);
      list.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind events to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!(eventsApi(this, 'once', name, [callback, context]) && callback)) return this;
      var self = this;
      var once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      this.on(name, once, context);
      return this;
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      var list, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;
      if (!name && !callback && !context) {
        this._events = {};
        return this;
      }

      names = name ? [name] : _.keys(this._events);
      for (i = 0, l = names.length; i < l; i++) {
        name = names[i];
        if (list = this._events[name]) {
          events = [];
          if (callback || context) {
            for (j = 0, k = list.length; j < k; j++) {
              ev = list[j];
              if ((callback && callback !== ev.callback &&
                               callback !== ev.callback._callback) ||
                  (context && context !== ev.context)) {
                events.push(ev);
              }
            }
          }
          this._events[name] = events;
        }
      }

      return this;
    },

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) return this;
      var args = slice.call(arguments, 1);
      if (!eventsApi(this, 'trigger', name, args)) return this;
      var events = this._events[name];
      var allEvents = this._events.all;
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, arguments);
      return this;
    },

    // An inversion-of-control version of `on`. Tell *this* object to listen to
    // an event in another object ... keeping track of what it's listening to.
    listenTo: function(obj, name, callback) {
      var listeners = this._listeners || (this._listeners = {});
      var id = obj._listenerId || (obj._listenerId = _.uniqueId('l'));
      listeners[id] = obj;
      obj.on(name, typeof name === 'object' ? this : callback, this);
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
    stopListening: function(obj, name, callback) {
      var listeners = this._listeners;
      if (!listeners) return;
      if (obj) {
        obj.off(name, typeof name === 'object' ? this : callback, this);
        if (!name && !callback) delete listeners[obj._listenerId];
      } else {
        if (typeof name === 'object') callback = this;
        for (var id in listeners) {
          listeners[id].off(name, callback, this);
        }
        this._listeners = {};
      }
      return this;
    }
  };

  // Aliases for backwards compatibility.
  Events.bind   = Events.on;
  Events.unbind = Events.off;

  // Allow the `Backbone` object to serve as a global event bus, for folks who
  // want global "pubsub" in a convenient place.
  _.extend(Backbone, Events);

  // Backbone.Model
  // --------------

  // Create a new model, with defined attributes. A client id (`cid`)
  // is automatically generated and assigned for you.
  var Model = Backbone.Model = function(attributes, options) {
    var defaults;
    var attrs = attributes || {};
    this.cid = _.uniqueId('c');
    this.attributes = {};
    if (options && options.collection) this.collection = options.collection;
    if (options && options.parse) attrs = this.parse(attrs, options) || {};
    if (defaults = _.result(this, 'defaults')) {
      attrs = _.defaults({}, attrs, defaults);
    }
    this.set(attrs, options);
    this.changed = {};
    this.initialize.apply(this, arguments);
  };

  // Attach all inheritable methods to the Model prototype.
  _.extend(Model.prototype, Events, {

    // A hash of attributes whose current and previous value differ.
    changed: null,

    // The default name for the JSON `id` attribute is `"id"`. MongoDB and
    // CouchDB users may want to set this to `"_id"`.
    idAttribute: 'id',

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Return a copy of the model's `attributes` object.
    toJSON: function(options) {
      return _.clone(this.attributes);
    },

    // Proxy `Backbone.sync` by default.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Get the value of an attribute.
    get: function(attr) {
      return this.attributes[attr];
    },

    // Get the HTML-escaped value of an attribute.
    escape: function(attr) {
      return _.escape(this.get(attr));
    },

    // Returns `true` if the attribute contains a value that is not null
    // or undefined.
    has: function(attr) {
      return this.get(attr) != null;
    },

    // ----------------------------------------------------------------------

    // Set a hash of model attributes on the object, firing `"change"` unless
    // you choose to silence it.
    set: function(key, val, options) {
      var attr, attrs, unset, changes, silent, changing, prev, current;
      if (key == null) return this;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options || (options = {});

      // Run validation.
      if (!this._validate(attrs, options)) return false;

      // Extract attributes and options.
      unset           = options.unset;
      silent          = options.silent;
      changes         = [];
      changing        = this._changing;
      this._changing  = true;

      if (!changing) {
        this._previousAttributes = _.clone(this.attributes);
        this.changed = {};
      }
      current = this.attributes, prev = this._previousAttributes;

      // Check for changes of `id`.
      if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

      // For each `set` attribute, update or delete the current value.
      for (attr in attrs) {
        val = attrs[attr];
        if (!_.isEqual(current[attr], val)) changes.push(attr);
        if (!_.isEqual(prev[attr], val)) {
          this.changed[attr] = val;
        } else {
          delete this.changed[attr];
        }
        unset ? delete current[attr] : current[attr] = val;
      }

      // Trigger all relevant attribute changes.
      if (!silent) {
        if (changes.length) this._pending = true;
        for (var i = 0, l = changes.length; i < l; i++) {
          this.trigger('change:' + changes[i], this, current[changes[i]], options);
        }
      }

      if (changing) return this;
      if (!silent) {
        while (this._pending) {
          this._pending = false;
          this.trigger('change', this, options);
        }
      }
      this._pending = false;
      this._changing = false;
      return this;
    },

    // Remove an attribute from the model, firing `"change"` unless you choose
    // to silence it. `unset` is a noop if the attribute doesn't exist.
    unset: function(attr, options) {
      return this.set(attr, void 0, _.extend({}, options, {unset: true}));
    },

    // Clear all attributes on the model, firing `"change"` unless you choose
    // to silence it.
    clear: function(options) {
      var attrs = {};
      for (var key in this.attributes) attrs[key] = void 0;
      return this.set(attrs, _.extend({}, options, {unset: true}));
    },

    // Determine if the model has changed since the last `"change"` event.
    // If you specify an attribute name, determine if that attribute has changed.
    hasChanged: function(attr) {
      if (attr == null) return !_.isEmpty(this.changed);
      return _.has(this.changed, attr);
    },

    // Return an object containing all the attributes that have changed, or
    // false if there are no changed attributes. Useful for determining what
    // parts of a view need to be updated and/or what attributes need to be
    // persisted to the server. Unset attributes will be set to undefined.
    // You can also pass an attributes object to diff against the model,
    // determining if there *would be* a change.
    changedAttributes: function(diff) {
      if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
      var val, changed = false;
      var old = this._changing ? this._previousAttributes : this.attributes;
      for (var attr in diff) {
        if (_.isEqual(old[attr], (val = diff[attr]))) continue;
        (changed || (changed = {}))[attr] = val;
      }
      return changed;
    },

    // Get the previous value of an attribute, recorded at the time the last
    // `"change"` event was fired.
    previous: function(attr) {
      if (attr == null || !this._previousAttributes) return null;
      return this._previousAttributes[attr];
    },

    // Get all of the attributes of the model at the time of the previous
    // `"change"` event.
    previousAttributes: function() {
      return _.clone(this._previousAttributes);
    },

    // ---------------------------------------------------------------------

    // Fetch the model from the server. If the server's representation of the
    // model differs from its current attributes, they will be overriden,
    // triggering a `"change"` event.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var success = options.success;
      options.success = function(model, resp, options) {
        if (!model.set(model.parse(resp, options), options)) return false;
        if (success) success(model, resp, options);
      };
      return this.sync('read', this, options);
    },

    // Set a hash of model attributes, and sync the model to the server.
    // If the server returns an attributes hash that differs, the model's
    // state will be `set` again.
    save: function(key, val, options) {
      var attrs, success, method, xhr, attributes = this.attributes;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (key == null || typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      // If we're not waiting and attributes exist, save acts as `set(attr).save(null, opts)`.
      if (attrs && (!options || !options.wait) && !this.set(attrs, options)) return false;

      options = _.extend({validate: true}, options);

      // Do not persist invalid models.
      if (!this._validate(attrs, options)) return false;

      // Set temporary attributes if `{wait: true}`.
      if (attrs && options.wait) {
        this.attributes = _.extend({}, attributes, attrs);
      }

      // After a successful server-side save, the client is (optionally)
      // updated with the server-side state.
      if (options.parse === void 0) options.parse = true;
      success = options.success;
      options.success = function(model, resp, options) {
        // Ensure attributes are restored during synchronous saves.
        model.attributes = attributes;
        var serverAttrs = model.parse(resp, options);
        if (options.wait) serverAttrs = _.extend(attrs || {}, serverAttrs);
        if (_.isObject(serverAttrs) && !model.set(serverAttrs, options)) {
          return false;
        }
        if (success) success(model, resp, options);
      };

      // Finish configuring and sending the Ajax request.
      method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
      if (method === 'patch') options.attrs = attrs;
      xhr = this.sync(method, this, options);

      // Restore attributes.
      if (attrs && options.wait) this.attributes = attributes;

      return xhr;
    },

    // Destroy this model on the server if it was already persisted.
    // Optimistically removes the model from its collection, if it has one.
    // If `wait: true` is passed, waits for the server to respond before removal.
    destroy: function(options) {
      options = options ? _.clone(options) : {};
      var model = this;
      var success = options.success;

      var destroy = function() {
        model.trigger('destroy', model, model.collection, options);
      };

      options.success = function(model, resp, options) {
        if (options.wait || model.isNew()) destroy();
        if (success) success(model, resp, options);
      };

      if (this.isNew()) {
        options.success(this, null, options);
        return false;
      }

      var xhr = this.sync('delete', this, options);
      if (!options.wait) destroy();
      return xhr;
    },

    // Default URL for the model's representation on the server -- if you're
    // using Backbone's restful methods, override this to change the endpoint
    // that will be called.
    url: function() {
      var base = _.result(this, 'urlRoot') || _.result(this.collection, 'url') || urlError();
      if (this.isNew()) return base;
      return base + (base.charAt(base.length - 1) === '/' ? '' : '/') + encodeURIComponent(this.id);
    },

    // **parse** converts a response into the hash of attributes to be `set` on
    // the model. The default implementation is just to pass the response along.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new model with identical attributes to this one.
    clone: function() {
      return new this.constructor(this.attributes);
    },

    // A model is new if it has never been saved to the server, and lacks an id.
    isNew: function() {
      return this.id == null;
    },

    // Check if the model is currently in a valid state.
    isValid: function(options) {
      return !this.validate || !this.validate(this.attributes, options);
    },

    // Run validation against the next complete set of model attributes,
    // returning `true` if all is well. Otherwise, fire a general
    // `"error"` event and call the error callback, if specified.
    _validate: function(attrs, options) {
      if (!options.validate || !this.validate) return true;
      attrs = _.extend({}, this.attributes, attrs);
      var error = this.validationError = this.validate(attrs, options) || null;
      if (!error) return true;
      this.trigger('invalid', this, error, options || {});
      return false;
    }

  });

  // Backbone.Collection
  // -------------------

  // Provides a standard collection class for our sets of models, ordered
  // or unordered. If a `comparator` is specified, the Collection will maintain
  // its models in sort order, as they're added and removed.
  var Collection = Backbone.Collection = function(models, options) {
    options || (options = {});
    if (options.model) this.model = options.model;
    if (options.comparator !== void 0) this.comparator = options.comparator;
    this.models = [];
    this._reset();
    this.initialize.apply(this, arguments);
    if (models) this.reset(models, _.extend({silent: true}, options));
  };

  // Define the Collection's inheritable methods.
  _.extend(Collection.prototype, Events, {

    // The default model for a collection is just a **Backbone.Model**.
    // This should be overridden in most cases.
    model: Model,

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // The JSON representation of a Collection is an array of the
    // models' attributes.
    toJSON: function(options) {
      return this.map(function(model){ return model.toJSON(options); });
    },

    // Proxy `Backbone.sync` by default.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Add a model, or list of models to the set.
    add: function(models, options) {
      models = _.isArray(models) ? models.slice() : [models];
      options || (options = {});
      var i, l, model, attrs, existing, doSort, add, at, sort, sortAttr;
      add = [];
      at = options.at;
      sort = this.comparator && (at == null) && options.sort != false;
      sortAttr = _.isString(this.comparator) ? this.comparator : null;

      // Turn bare objects into model references, and prevent invalid models
      // from being added.
      for (i = 0, l = models.length; i < l; i++) {
        if (!(model = this._prepareModel(attrs = models[i], options))) {
          this.trigger('invalid', this, attrs, options);
          continue;
        }

        // If a duplicate is found, prevent it from being added and
        // optionally merge it into the existing model.
        if (existing = this.get(model)) {
          if (options.merge) {
            existing.set(attrs === model ? model.attributes : attrs, options);
            if (sort && !doSort && existing.hasChanged(sortAttr)) doSort = true;
          }
          continue;
        }

        // This is a new model, push it to the `add` list.
        add.push(model);

        // Listen to added models' events, and index models for lookup by
        // `id` and by `cid`.
        model.on('all', this._onModelEvent, this);
        this._byId[model.cid] = model;
        if (model.id != null) this._byId[model.id] = model;
      }

      // See if sorting is needed, update `length` and splice in new models.
      if (add.length) {
        if (sort) doSort = true;
        this.length += add.length;
        if (at != null) {
          splice.apply(this.models, [at, 0].concat(add));
        } else {
          push.apply(this.models, add);
        }
      }

      // Silently sort the collection if appropriate.
      if (doSort) this.sort({silent: true});

      if (options.silent) return this;

      // Trigger `add` events.
      for (i = 0, l = add.length; i < l; i++) {
        (model = add[i]).trigger('add', model, this, options);
      }

      // Trigger `sort` if the collection was sorted.
      if (doSort) this.trigger('sort', this, options);

      return this;
    },

    // Remove a model, or a list of models from the set.
    remove: function(models, options) {
      models = _.isArray(models) ? models.slice() : [models];
      options || (options = {});
      var i, l, index, model;
      for (i = 0, l = models.length; i < l; i++) {
        model = this.get(models[i]);
        if (!model) continue;
        delete this._byId[model.id];
        delete this._byId[model.cid];
        index = this.indexOf(model);
        this.models.splice(index, 1);
        this.length--;
        if (!options.silent) {
          options.index = index;
          model.trigger('remove', model, this, options);
        }
        this._removeReference(model);
      }
      return this;
    },

    // Add a model to the end of the collection.
    push: function(model, options) {
      model = this._prepareModel(model, options);
      this.add(model, _.extend({at: this.length}, options));
      return model;
    },

    // Remove a model from the end of the collection.
    pop: function(options) {
      var model = this.at(this.length - 1);
      this.remove(model, options);
      return model;
    },

    // Add a model to the beginning of the collection.
    unshift: function(model, options) {
      model = this._prepareModel(model, options);
      this.add(model, _.extend({at: 0}, options));
      return model;
    },

    // Remove a model from the beginning of the collection.
    shift: function(options) {
      var model = this.at(0);
      this.remove(model, options);
      return model;
    },

    // Slice out a sub-array of models from the collection.
    slice: function(begin, end) {
      return this.models.slice(begin, end);
    },

    // Get a model from the set by id.
    get: function(obj) {
      if (obj == null) return void 0;
      this._idAttr || (this._idAttr = this.model.prototype.idAttribute);
      return this._byId[obj.id || obj.cid || obj[this._idAttr] || obj];
    },

    // Get the model at the given index.
    at: function(index) {
      return this.models[index];
    },

    // Return models with matching attributes. Useful for simple cases of `filter`.
    where: function(attrs) {
      if (_.isEmpty(attrs)) return [];
      return this.filter(function(model) {
        for (var key in attrs) {
          if (attrs[key] !== model.get(key)) return false;
        }
        return true;
      });
    },

    // Force the collection to re-sort itself. You don't need to call this under
    // normal circumstances, as the set will maintain sort order as each item
    // is added.
    sort: function(options) {
      if (!this.comparator) {
        throw new Error('Cannot sort a set without a comparator');
      }
      options || (options = {});

      // Run sort based on type of `comparator`.
      if (_.isString(this.comparator) || this.comparator.length === 1) {
        this.models = this.sortBy(this.comparator, this);
      } else {
        this.models.sort(_.bind(this.comparator, this));
      }

      if (!options.silent) this.trigger('sort', this, options);
      return this;
    },

    // Pluck an attribute from each model in the collection.
    pluck: function(attr) {
      return _.invoke(this.models, 'get', attr);
    },

    // Smartly update a collection with a change set of models, adding,
    // removing, and merging as necessary.
    update: function(models, options) {
      options = _.extend({add: true, merge: true, remove: true}, options);
      if (options.parse) models = this.parse(models, options);
      var model, i, l, existing;
      var add = [], remove = [], modelMap = {};

      // Allow a single model (or no argument) to be passed.
      if (!_.isArray(models)) models = models ? [models] : [];

      // Proxy to `add` for this case, no need to iterate...
      if (options.add && !options.remove) return this.add(models, options);

      // Determine which models to add and merge, and which to remove.
      for (i = 0, l = models.length; i < l; i++) {
        model = models[i];
        existing = this.get(model);
        if (options.remove && existing) modelMap[existing.cid] = true;
        if ((options.add && !existing) || (options.merge && existing)) {
          add.push(model);
        }
      }
      if (options.remove) {
        for (i = 0, l = this.models.length; i < l; i++) {
          model = this.models[i];
          if (!modelMap[model.cid]) remove.push(model);
        }
      }

      // Remove models (if applicable) before we add and merge the rest.
      if (remove.length) this.remove(remove, options);
      if (add.length) this.add(add, options);
      return this;
    },

    // When you have more items than you want to add or remove individually,
    // you can reset the entire set with a new list of models, without firing
    // any `add` or `remove` events. Fires `reset` when finished.
    reset: function(models, options) {
      options || (options = {});
      if (options.parse) models = this.parse(models, options);
      for (var i = 0, l = this.models.length; i < l; i++) {
        this._removeReference(this.models[i]);
      }
      options.previousModels = this.models.slice();
      this._reset();
      if (models) this.add(models, _.extend({silent: true}, options));
      if (!options.silent) this.trigger('reset', this, options);
      return this;
    },

    // Fetch the default set of models for this collection, resetting the
    // collection when they arrive. If `update: true` is passed, the response
    // data will be passed through the `update` method instead of `reset`.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var success = options.success;
      options.success = function(collection, resp, options) {
        var method = options.update ? 'update' : 'reset';
        collection[method](resp, options);
        if (success) success(collection, resp, options);
      };
      return this.sync('read', this, options);
    },

    // Create a new instance of a model in this collection. Add the model to the
    // collection immediately, unless `wait: true` is passed, in which case we
    // wait for the server to agree.
    create: function(model, options) {
      options = options ? _.clone(options) : {};
      if (!(model = this._prepareModel(model, options))) return false;
      if (!options.wait) this.add(model, options);
      var collection = this;
      var success = options.success;
      options.success = function(model, resp, options) {
        if (options.wait) collection.add(model, options);
        if (success) success(model, resp, options);
      };
      model.save(null, options);
      return model;
    },

    // **parse** converts a response into a list of models to be added to the
    // collection. The default implementation is just to pass it through.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new collection with an identical list of models as this one.
    clone: function() {
      return new this.constructor(this.models);
    },

    // Reset all internal state. Called when the collection is reset.
    _reset: function() {
      this.length = 0;
      this.models.length = 0;
      this._byId  = {};
    },

    // Prepare a model or hash of attributes to be added to this collection.
    _prepareModel: function(attrs, options) {
      if (attrs instanceof Model) {
        if (!attrs.collection) attrs.collection = this;
        return attrs;
      }
      options || (options = {});
      options.collection = this;
      var model = new this.model(attrs, options);
      if (!model._validate(attrs, options)) return false;
      return model;
    },

    // Internal method to remove a model's ties to a collection.
    _removeReference: function(model) {
      if (this === model.collection) delete model.collection;
      model.off('all', this._onModelEvent, this);
    },

    // Internal method called every time a model in the set fires an event.
    // Sets need to update their indexes when models change ids. All other
    // events simply proxy through. "add" and "remove" events that originate
    // in other collections are ignored.
    _onModelEvent: function(event, model, collection, options) {
      if ((event === 'add' || event === 'remove') && collection !== this) return;
      if (event === 'destroy') this.remove(model, options);
      if (model && event === 'change:' + model.idAttribute) {
        delete this._byId[model.previous(model.idAttribute)];
        if (model.id != null) this._byId[model.id] = model;
      }
      this.trigger.apply(this, arguments);
    },

    sortedIndex: function (model, value, context) {
      value || (value = this.comparator);
      var iterator = _.isFunction(value) ? value : function(model) {
        return model.get(value);
      };
      return _.sortedIndex(this.models, model, iterator, context);
    }

  });

  // Underscore methods that we want to implement on the Collection.
  var methods = ['forEach', 'each', 'map', 'collect', 'reduce', 'foldl',
    'inject', 'reduceRight', 'foldr', 'find', 'detect', 'filter', 'select',
    'reject', 'every', 'all', 'some', 'any', 'include', 'contains', 'invoke',
    'max', 'min', 'toArray', 'size', 'first', 'head', 'take', 'initial', 'rest',
    'tail', 'drop', 'last', 'without', 'indexOf', 'shuffle', 'lastIndexOf',
    'isEmpty', 'chain'];

  // Mix in each Underscore method as a proxy to `Collection#models`.
  _.each(methods, function(method) {
    Collection.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.models);
      return _[method].apply(_, args);
    };
  });

  // Underscore methods that take a property name as an argument.
  var attributeMethods = ['groupBy', 'countBy', 'sortBy'];

  // Use attributes instead of properties.
  _.each(attributeMethods, function(method) {
    Collection.prototype[method] = function(value, context) {
      var iterator = _.isFunction(value) ? value : function(model) {
        return model.get(value);
      };
      return _[method](this.models, iterator, context);
    };
  });

  // Backbone.Router
  // ---------------

  // Routers map faux-URLs to actions, and fire events when routes are
  // matched. Creating a new one sets its `routes` hash, if not set statically.
  var Router = Backbone.Router = function(options) {
    options || (options = {});
    if (options.routes) this.routes = options.routes;
    this._bindRoutes();
    this.initialize.apply(this, arguments);
  };

  // Cached regular expressions for matching named param parts and splatted
  // parts of route strings.
  var optionalParam = /\((.*?)\)/g;
  var namedParam    = /(\(\?)?:\w+/g;
  var splatParam    = /\*\w+/g;
  var escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;

  // Set up all inheritable **Backbone.Router** properties and methods.
  _.extend(Router.prototype, Events, {

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Manually bind a single named route to a callback. For example:
    //
    //     this.route('search/:query/p:num', 'search', function(query, num) {
    //       ...
    //     });
    //
    route: function(route, name, callback) {
      if (!_.isRegExp(route)) route = this._routeToRegExp(route);
      if (!callback) callback = this[name];
      Backbone.history.route(route, _.bind(function(fragment) {
        var args = this._extractParameters(route, fragment);
        callback && callback.apply(this, args);
        this.trigger.apply(this, ['route:' + name].concat(args));
        this.trigger('route', name, args);
        Backbone.history.trigger('route', this, name, args);
      }, this));
      return this;
    },

    // Simple proxy to `Backbone.history` to save a fragment into the history.
    navigate: function(fragment, options) {
      Backbone.history.navigate(fragment, options);
      return this;
    },

    // Bind all defined routes to `Backbone.history`. We have to reverse the
    // order of the routes here to support behavior where the most general
    // routes can be defined at the bottom of the route map.
    _bindRoutes: function() {
      if (!this.routes) return;
      var route, routes = _.keys(this.routes);
      while ((route = routes.pop()) != null) {
        this.route(route, this.routes[route]);
      }
    },

    // Convert a route string into a regular expression, suitable for matching
    // against the current location hash.
    _routeToRegExp: function(route) {
      route = route.replace(escapeRegExp, '\\$&')
                   .replace(optionalParam, '(?:$1)?')
                   .replace(namedParam, function(match, optional){
                     return optional ? match : '([^\/]+)';
                   })
                   .replace(splatParam, '(.*?)');
      return new RegExp('^' + route + '$');
    },

    // Given a route, and a URL fragment that it matches, return the array of
    // extracted parameters.
    _extractParameters: function(route, fragment) {
      return route.exec(fragment).slice(1);
    }

  });

  // Backbone.History
  // ----------------

  // Handles cross-browser history management, based on URL fragments. If the
  // browser does not support `onhashchange`, falls back to polling.
  var History = Backbone.History = function() {
    this.handlers = [];
    _.bindAll(this, 'checkUrl');

    // Ensure that `History` can be used outside of the browser.
    if (typeof window !== 'undefined') {
      this.location = window.location;
      this.history = window.history;
    }
  };

  // Cached regex for stripping a leading hash/slash and trailing space.
  var routeStripper = /^[#\/]|\s+$/g;

  // Cached regex for stripping leading and trailing slashes.
  var rootStripper = /^\/+|\/+$/g;

  // Cached regex for detecting MSIE.
  var isExplorer = /msie [\w.]+/;

  // Cached regex for removing a trailing slash.
  var trailingSlash = /\/$/;

  // Has the history handling already been started?
  History.started = false;

  // Set up all inheritable **Backbone.History** properties and methods.
  _.extend(History.prototype, Events, {

    // The default interval to poll for hash changes, if necessary, is
    // twenty times a second.
    interval: 50,

    // Gets the true hash value. Cannot use location.hash directly due to bug
    // in Firefox where location.hash will always be decoded.
    getHash: function(window) {
      var match = (window || this).location.href.match(/#(.*)$/);
      return match ? match[1] : '';
    },

    // Get the cross-browser normalized URL fragment, either from the URL,
    // the hash, or the override.
    getFragment: function(fragment, forcePushState) {
      if (fragment == null) {
        if (this._hasPushState || !this._wantsHashChange || forcePushState) {
          fragment = this.location.pathname;
          var root = this.root.replace(trailingSlash, '');
          if (!fragment.indexOf(root)) fragment = fragment.substr(root.length);
        } else {
          fragment = this.getHash();
        }
      }
      return fragment.replace(routeStripper, '');
    },

    // Start the hash change handling, returning `true` if the current URL matches
    // an existing route, and `false` otherwise.
    start: function(options) {
      if (History.started) throw new Error("Backbone.history has already been started");
      History.started = true;

      // Figure out the initial configuration. Do we need an iframe?
      // Is pushState desired ... is it available?
      this.options          = _.extend({}, {root: '/'}, this.options, options);
      this.root             = this.options.root;
      this._wantsHashChange = this.options.hashChange !== false;
      this._wantsPushState  = !!this.options.pushState;
      this._hasPushState    = !!(this.options.pushState && this.history && this.history.pushState);
      var fragment          = this.getFragment();
      var docMode           = document.documentMode;
      var oldIE             = (isExplorer.exec(navigator.userAgent.toLowerCase()) && (!docMode || docMode <= 7));

      // Normalize root to always include a leading and trailing slash.
      this.root = ('/' + this.root + '/').replace(rootStripper, '/');

      if (oldIE && this._wantsHashChange) {
        this.iframe = Backbone.$('<iframe src="javascript:0" tabindex="-1" />').hide().appendTo('body')[0].contentWindow;
        this.navigate(fragment);
      }

      // Depending on whether we're using pushState or hashes, and whether
      // 'onhashchange' is supported, determine how we check the URL state.
      if (this._hasPushState) {
        Backbone.$(window).on('popstate', this.checkUrl);
      } else if (this._wantsHashChange && ('onhashchange' in window) && !oldIE) {
        Backbone.$(window).on('hashchange', this.checkUrl);
      } else if (this._wantsHashChange) {
        this._checkUrlInterval = setInterval(this.checkUrl, this.interval);
      }

      // Determine if we need to change the base url, for a pushState link
      // opened by a non-pushState browser.
      this.fragment = fragment;
      var loc = this.location;
      var atRoot = loc.pathname.replace(/[^\/]$/, '$&/') === this.root;

      // If we've started off with a route from a `pushState`-enabled browser,
      // but we're currently in a browser that doesn't support it...
      if (this._wantsHashChange && this._wantsPushState && !this._hasPushState && !atRoot) {
        this.fragment = this.getFragment(null, true);
        this.location.replace(this.root + this.location.search + '#' + this.fragment);
        // Return immediately as browser will do redirect to new url
        return true;

      // Or if we've started out with a hash-based route, but we're currently
      // in a browser where it could be `pushState`-based instead...
      } else if (this._wantsPushState && this._hasPushState && atRoot && loc.hash) {
        this.fragment = this.getHash().replace(routeStripper, '');
        this.history.replaceState({}, document.title, this.root + this.fragment + loc.search);
      }

      if (!this.options.silent) return this.loadUrl();
    },

    // Disable Backbone.history, perhaps temporarily. Not useful in a real app,
    // but possibly useful for unit testing Routers.
    stop: function() {
      Backbone.$(window).off('popstate', this.checkUrl).off('hashchange', this.checkUrl);
      clearInterval(this._checkUrlInterval);
      History.started = false;
    },

    // Add a route to be tested when the fragment changes. Routes added later
    // may override previous routes.
    route: function(route, callback) {
      this.handlers.unshift({route: route, callback: callback});
    },

    // Checks the current URL to see if it has changed, and if it has,
    // calls `loadUrl`, normalizing across the hidden iframe.
    checkUrl: function(e) {
      var current = this.getFragment();
      if (current === this.fragment && this.iframe) {
        current = this.getFragment(this.getHash(this.iframe));
      }
      if (current === this.fragment) return false;
      if (this.iframe) this.navigate(current);
      this.loadUrl() || this.loadUrl(this.getHash());
    },

    // Attempt to load the current URL fragment. If a route succeeds with a
    // match, returns `true`. If no defined routes matches the fragment,
    // returns `false`.
    loadUrl: function(fragmentOverride) {
      var fragment = this.fragment = this.getFragment(fragmentOverride);
      var matched = _.any(this.handlers, function(handler) {
        if (handler.route.test(fragment)) {
          handler.callback(fragment);
          return true;
        }
      });
      return matched;
    },

    // Save a fragment into the hash history, or replace the URL state if the
    // 'replace' option is passed. You are responsible for properly URL-encoding
    // the fragment in advance.
    //
    // The options object can contain `trigger: true` if you wish to have the
    // route callback be fired (not usually desirable), or `replace: true`, if
    // you wish to modify the current URL without adding an entry to the history.
    navigate: function(fragment, options) {
      if (!History.started) return false;
      if (!options || options === true) options = {trigger: options};
      fragment = this.getFragment(fragment || '');
      if (this.fragment === fragment) return;
      this.fragment = fragment;
      var url = this.root + fragment;

      // If pushState is available, we use it to set the fragment as a real URL.
      if (this._hasPushState) {
        this.history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);

      // If hash changes haven't been explicitly disabled, update the hash
      // fragment to store history.
      } else if (this._wantsHashChange) {
        this._updateHash(this.location, fragment, options.replace);
        if (this.iframe && (fragment !== this.getFragment(this.getHash(this.iframe)))) {
          // Opening and closing the iframe tricks IE7 and earlier to push a
          // history entry on hash-tag change.  When replace is true, we don't
          // want this.
          if(!options.replace) this.iframe.document.open().close();
          this._updateHash(this.iframe.location, fragment, options.replace);
        }

      // If you've told us that you explicitly don't want fallback hashchange-
      // based history, then `navigate` becomes a page refresh.
      } else {
        return this.location.assign(url);
      }
      if (options.trigger) this.loadUrl(fragment);
    },

    // Update the hash location, either replacing the current entry, or adding
    // a new one to the browser history.
    _updateHash: function(location, fragment, replace) {
      if (replace) {
        var href = location.href.replace(/(javascript:|#).*$/, '');
        location.replace(href + '#' + fragment);
      } else {
        // Some browsers require that `hash` contains a leading #.
        location.hash = '#' + fragment;
      }
    }

  });

  // Create the default Backbone.history.
  Backbone.history = new History;

  // Backbone.View
  // -------------

  // Creating a Backbone.View creates its initial element outside of the DOM,
  // if an existing element is not provided...
  var View = Backbone.View = function(options) {
    this.cid = _.uniqueId('view');
    this._configure(options || {});
    this._ensureElement();
    this.initialize.apply(this, arguments);
    this.delegateEvents();
  };

  // Cached regex to split keys for `delegate`.
  var delegateEventSplitter = /^(\S+)\s*(.*)$/;

  // List of view options to be merged as properties.
  var viewOptions = ['model', 'collection', 'el', 'id', 'attributes', 'className', 'tagName', 'events'];

  // Set up all inheritable **Backbone.View** properties and methods.
  _.extend(View.prototype, Events, {

    // The default `tagName` of a View's element is `"div"`.
    tagName: 'div',

    // jQuery delegate for element lookup, scoped to DOM elements within the
    // current view. This should be prefered to global lookups where possible.
    $: function(selector) {
      return this.$el.find(selector);
    },

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // **render** is the core function that your view should override, in order
    // to populate its element (`this.el`), with the appropriate HTML. The
    // convention is for **render** to always return `this`.
    render: function() {
      return this;
    },

    // Remove this view by taking the element out of the DOM, and removing any
    // applicable Backbone.Events listeners.
    remove: function() {
      this.$el.remove();
      this.stopListening();
      return this;
    },

    // Change the view's element (`this.el` property), including event
    // re-delegation.
    setElement: function(element, delegate) {
      if (this.$el) this.undelegateEvents();
      this.$el = element instanceof Backbone.$ ? element : Backbone.$(element);
      this.el = this.$el[0];
      if (delegate !== false) this.delegateEvents();
      return this;
    },

    // Set callbacks, where `this.events` is a hash of
    //
    // *{"event selector": "callback"}*
    //
    //     {
    //       'mousedown .title':  'edit',
    //       'click .button':     'save'
    //       'click .open':       function(e) { ... }
    //     }
    //
    // pairs. Callbacks will be bound to the view, with `this` set properly.
    // Uses event delegation for efficiency.
    // Omitting the selector binds the event to `this.el`.
    // This only works for delegate-able events: not `focus`, `blur`, and
    // not `change`, `submit`, and `reset` in Internet Explorer.
    delegateEvents: function(events) {
      if (!(events || (events = _.result(this, 'events')))) return;
      this.undelegateEvents();
      for (var key in events) {
        var method = events[key];
        if (!_.isFunction(method)) method = this[events[key]];
        if (!method) throw new Error('Method "' + events[key] + '" does not exist');
        var match = key.match(delegateEventSplitter);
        var eventName = match[1], selector = match[2];
        method = _.bind(method, this);
        eventName += '.delegateEvents' + this.cid;
        if (selector === '') {
          this.$el.on(eventName, method);
        } else {
          this.$el.on(eventName, selector, method);
        }
      }
    },

    // Clears all callbacks previously bound to the view with `delegateEvents`.
    // You usually don't need to use this, but may wish to if you have multiple
    // Backbone views attached to the same DOM element.
    undelegateEvents: function() {
      this.$el.off('.delegateEvents' + this.cid);
    },

    // Performs the initial configuration of a View with a set of options.
    // Keys with special meaning *(model, collection, id, className)*, are
    // attached directly to the view.
    _configure: function(options) {
      if (this.options) options = _.extend({}, _.result(this, 'options'), options);
      _.extend(this, _.pick(options, viewOptions));
      this.options = options;
    },

    // Ensure that the View has a DOM element to render into.
    // If `this.el` is a string, pass it through `$()`, take the first
    // matching element, and re-assign it to `el`. Otherwise, create
    // an element from the `id`, `className` and `tagName` properties.
    _ensureElement: function() {
      if (!this.el) {
        var attrs = _.extend({}, _.result(this, 'attributes'));
        if (this.id) attrs.id = _.result(this, 'id');
        if (this.className) attrs['class'] = _.result(this, 'className');
        var $el = Backbone.$('<' + _.result(this, 'tagName') + '>').attr(attrs);
        this.setElement($el, false);
      } else {
        this.setElement(_.result(this, 'el'), false);
      }
    }

  });

  // Backbone.sync
  // -------------

  // Map from CRUD to HTTP for our default `Backbone.sync` implementation.
  var methodMap = {
    'create': 'POST',
    'update': 'PUT',
    'patch':  'PATCH',
    'delete': 'DELETE',
    'read':   'GET'
  };

  // Override this function to change the manner in which Backbone persists
  // models to the server. You will be passed the type of request, and the
  // model in question. By default, makes a RESTful Ajax request
  // to the model's `url()`. Some possible customizations could be:
  //
  // * Use `setTimeout` to batch rapid-fire updates into a single request.
  // * Send up the models as XML instead of JSON.
  // * Persist models via WebSockets instead of Ajax.
  //
  // Turn on `Backbone.emulateHTTP` in order to send `PUT` and `DELETE` requests
  // as `POST`, with a `_method` parameter containing the true HTTP method,
  // as well as all requests with the body as `application/x-www-form-urlencoded`
  // instead of `application/json` with the model in a param named `model`.
  // Useful when interfacing with server-side languages like **PHP** that make
  // it difficult to read the body of `PUT` requests.
  Backbone.sync = function(method, model, options) {
    var type = methodMap[method];

    // Default options, unless specified.
    _.defaults(options || (options = {}), {
      emulateHTTP: Backbone.emulateHTTP,
      emulateJSON: Backbone.emulateJSON
    });

    // Default JSON-request options.
    var params = {type: type, dataType: 'json'};

    // Ensure that we have a URL.
    if (!options.url) {
      params.url = _.result(model, 'url') || urlError();
    }

    // Ensure that we have the appropriate request data.
    if (options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')) {
      params.contentType = 'application/json';
      params.data = JSON.stringify(options.attrs || model.toJSON(options));
    }

    // For older servers, emulate JSON by encoding the request into an HTML-form.
    if (options.emulateJSON) {
      params.contentType = 'application/x-www-form-urlencoded';
      params.data = params.data ? {model: params.data} : {};
    }

    // For older servers, emulate HTTP by mimicking the HTTP method with `_method`
    // And an `X-HTTP-Method-Override` header.
    if (options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')) {
      params.type = 'POST';
      if (options.emulateJSON) params.data._method = type;
      var beforeSend = options.beforeSend;
      options.beforeSend = function(xhr) {
        xhr.setRequestHeader('X-HTTP-Method-Override', type);
        if (beforeSend) return beforeSend.apply(this, arguments);
      };
    }

    // Don't process data on a non-GET request.
    if (params.type !== 'GET' && !options.emulateJSON) {
      params.processData = false;
    }

    var success = options.success;
    options.success = function(resp) {
      if (success) success(model, resp, options);
      model.trigger('sync', model, resp, options);
    };

    var error = options.error;
    options.error = function(xhr) {
      if (error) error(model, xhr, options);
      model.trigger('error', model, xhr, options);
    };

    // Make the request, allowing the user to override any Ajax options.
    var xhr = options.xhr = Backbone.ajax(_.extend(params, options));
    model.trigger('request', model, xhr, options);
    return xhr;
  };

  // Set the default implementation of `Backbone.ajax` to proxy through to `$`.
  Backbone.ajax = function() {
    return Backbone.$.ajax.apply(Backbone.$, arguments);
  };

  // Helpers
  // -------

  // Helper function to correctly set up the prototype chain, for subclasses.
  // Similar to `goog.inherits`, but uses a hash of prototype properties and
  // class properties to be extended.
  var extend = function(protoProps, staticProps) {
    var parent = this;
    var child;

    // The constructor function for the new subclass is either defined by you
    // (the "constructor" property in your `extend` definition), or defaulted
    // by us to simply call the parent's constructor.
    if (protoProps && _.has(protoProps, 'constructor')) {
      child = protoProps.constructor;
    } else {
      child = function(){ return parent.apply(this, arguments); };
    }

    // Add static properties to the constructor function, if supplied.
    _.extend(child, parent, staticProps);

    // Set the prototype chain to inherit from `parent`, without calling
    // `parent`'s constructor function.
    var Surrogate = function(){ this.constructor = child; };
    Surrogate.prototype = parent.prototype;
    child.prototype = new Surrogate;

    // Add prototype properties (instance properties) to the subclass,
    // if supplied.
    if (protoProps) _.extend(child.prototype, protoProps);

    // Set a convenience property in case the parent's prototype is needed
    // later.
    child.__super__ = parent.prototype;

    return child;
  };

  // Set up inheritance for the model, collection, router, view and history.
  Model.extend = Collection.extend = Router.extend = View.extend = History.extend = extend;

  // Throw an error when a URL is needed, and none is supplied.
  var urlError = function() {
    throw new Error('A "url" property or function must be specified');
  };

}).call(this);

define("backbone", ["underscore","jquery"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Backbone;
    };
}(this)));

// lib/handlebars/base.js

/*jshint eqnull:true*/
this.Handlebars = {};

(function(Handlebars) {

Handlebars.VERSION = "1.0.rc.2";

Handlebars.helpers  = {};
Handlebars.partials = {};

Handlebars.registerHelper = function(name, fn, inverse) {
  if(inverse) { fn.not = inverse; }
  this.helpers[name] = fn;
};

Handlebars.registerPartial = function(name, str) {
  this.partials[name] = str;
};

Handlebars.registerHelper('helperMissing', function(arg) {
  if(arguments.length === 2) {
    return undefined;
  } else {
    throw new Error("Could not find property '" + arg + "'");
  }
});

var toString = Object.prototype.toString, functionType = "[object Function]";

Handlebars.registerHelper('blockHelperMissing', function(context, options) {
  var inverse = options.inverse || function() {}, fn = options.fn;


  var ret = "";
  var type = toString.call(context);

  if(type === functionType) { context = context.call(this); }

  if(context === true) {
    return fn(this);
  } else if(context === false || context == null) {
    return inverse(this);
  } else if(type === "[object Array]") {
    if(context.length > 0) {
      return Handlebars.helpers.each(context, options);
    } else {
      return inverse(this);
    }
  } else {
    return fn(context);
  }
});

Handlebars.K = function() {};

Handlebars.createFrame = Object.create || function(object) {
  Handlebars.K.prototype = object;
  var obj = new Handlebars.K();
  Handlebars.K.prototype = null;
  return obj;
};

Handlebars.logger = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, level: 3,

  methodMap: {0: 'debug', 1: 'info', 2: 'warn', 3: 'error'},

  // can be overridden in the host environment
  log: function(level, obj) {
    if (Handlebars.logger.level <= level) {
      var method = Handlebars.logger.methodMap[level];
      if (typeof console !== 'undefined' && console[method]) {
        console[method].call(console, obj);
      }
    }
  }
};

Handlebars.log = function(level, obj) { Handlebars.logger.log(level, obj); };

Handlebars.registerHelper('each', function(context, options) {
  var fn = options.fn, inverse = options.inverse;
  var i = 0, ret = "", data;

  if (options.data) {
    data = Handlebars.createFrame(options.data);
  }

  if(context && typeof context === 'object') {
    if(context instanceof Array){
      for(var j = context.length; i<j; i++) {
        if (data) { data.index = i; }
        ret = ret + fn(context[i], { data: data });
      }
    } else {
      for(var key in context) {
        if(context.hasOwnProperty(key)) {
          if(data) { data.key = key; }
          ret = ret + fn(context[key], {data: data});
          i++;
        }
      }
    }
  }

  if(i === 0){
    ret = inverse(this);
  }

  return ret;
});

Handlebars.registerHelper('if', function(context, options) {
  var type = toString.call(context);
  if(type === functionType) { context = context.call(this); }

  if(!context || Handlebars.Utils.isEmpty(context)) {
    return options.inverse(this);
  } else {
    return options.fn(this);
  }
});

Handlebars.registerHelper('unless', function(context, options) {
  var fn = options.fn, inverse = options.inverse;
  options.fn = inverse;
  options.inverse = fn;

  return Handlebars.helpers['if'].call(this, context, options);
});

Handlebars.registerHelper('with', function(context, options) {
  return options.fn(context);
});

Handlebars.registerHelper('log', function(context, options) {
  var level = options.data && options.data.level != null ? parseInt(options.data.level, 10) : 1;
  Handlebars.log(level, context);
});

}(this.Handlebars));
;
// lib/handlebars/utils.js

var errorProps = ['description', 'fileName', 'lineNumber', 'message', 'name', 'number', 'stack'];

Handlebars.Exception = function(message) {
  var tmp = Error.prototype.constructor.apply(this, arguments);

  // Unfortunately errors are not enumerable in Chrome (at least), so `for prop in tmp` doesn't work.
  for (var idx = 0; idx < errorProps.length; idx++) {
    this[errorProps[idx]] = tmp[errorProps[idx]];
  }
};
Handlebars.Exception.prototype = new Error();

// Build out our basic SafeString type
Handlebars.SafeString = function(string) {
  this.string = string;
};
Handlebars.SafeString.prototype.toString = function() {
  return this.string.toString();
};

(function() {
  var escape = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "`": "&#x60;"
  };

  var badChars = /[&<>"'`]/g;
  var possible = /[&<>"'`]/;

  var escapeChar = function(chr) {
    return escape[chr] || "&amp;";
  };

  Handlebars.Utils = {
    escapeExpression: function(string) {
      // don't escape SafeStrings, since they're already safe
      if (string instanceof Handlebars.SafeString) {
        return string.toString();
      } else if (string == null || string === false) {
        return "";
      }

      if(!possible.test(string)) { return string; }
      return string.replace(badChars, escapeChar);
    },

    isEmpty: function(value) {
      if (!value && value !== 0) {
        return true;
      } else if(Object.prototype.toString.call(value) === "[object Array]" && value.length === 0) {
        return true;
      } else {
        return false;
      }
    }
  };
})();;
// lib/handlebars/runtime.js
Handlebars.VM = {
  template: function(templateSpec) {
    // Just add water
    var container = {
      escapeExpression: Handlebars.Utils.escapeExpression,
      invokePartial: Handlebars.VM.invokePartial,
      programs: [],
      program: function(i, fn, data) {
        var programWrapper = this.programs[i];
        if(data) {
          return Handlebars.VM.program(fn, data);
        } else if(programWrapper) {
          return programWrapper;
        } else {
          programWrapper = this.programs[i] = Handlebars.VM.program(fn);
          return programWrapper;
        }
      },
      programWithDepth: Handlebars.VM.programWithDepth,
      noop: Handlebars.VM.noop
    };

    return function(context, options) {
      options = options || {};
      return templateSpec.call(container, Handlebars, context, options.helpers, options.partials, options.data);
    };
  },

  programWithDepth: function(fn, data, $depth) {
    var args = Array.prototype.slice.call(arguments, 2);

    return function(context, options) {
      options = options || {};

      return fn.apply(this, [context, options.data || data].concat(args));
    };
  },
  program: function(fn, data) {
    return function(context, options) {
      options = options || {};

      return fn(context, options.data || data);
    };
  },
  noop: function() { return ""; },
  invokePartial: function(partial, name, context, helpers, partials, data) {
    var options = { helpers: helpers, partials: partials, data: data };

    if(partial === undefined) {
      throw new Handlebars.Exception("The partial " + name + " could not be found");
    } else if(partial instanceof Function) {
      return partial(context, options);
    } else if (!Handlebars.compile) {
      throw new Handlebars.Exception("The partial " + name + " could not be compiled when running in runtime-only mode");
    } else {
      partials[name] = Handlebars.compile(partial, {data: data !== undefined});
      return partials[name](context, options);
    }
  }
};

Handlebars.template = Handlebars.VM.template;
;

define("handlebars", (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Handlebars;
    };
}(this)));

/*!
 * backbone.layoutmanager.js v0.8.4
 * Copyright 2013, Tim Branyen (@tbranyen)
 * backbone.layoutmanager.js may be freely distributed under the MIT license.
 */
(function(window) {



// Hoisted, referenced at the bottom of the source.  This caches a list of all
// LayoutManager options at definition time.
var keys;

// Localize global dependency references.
var Backbone = window.Backbone;
var _ = window._;
var $ = window.$;

// Maintain references to the two `Backbone.View` functions that are
// overwritten so that they can be proxied.
var _configure = Backbone.View.prototype._configure;
var render = Backbone.View.prototype.render;

// Cache these methods for performance.
var aPush = Array.prototype.push;
var aConcat = Array.prototype.concat;
var aSplice = Array.prototype.splice;

// LayoutManager is a wrapper around a `Backbone.View`.
var LayoutManager = Backbone.View.extend({
  // This named function allows for significantly easier debugging.
  constructor: function Layout(options) {
    // Options may not always be passed to the constructor, this ensures it is
    // always an object.
    options = options || {};

    // Grant this View superpowers.
    LayoutManager.setupView(this, options);

    // Have Backbone set up the rest of this View.
    Backbone.View.call(this, options);
  },

  // Shorthand to `setView` function with the `insert` flag set.
  insertView: function(selector, view) {
    // If the `view` argument exists, then a selector was passed in.  This code
    // path will forward the selector on to `setView`.
    if (view) {
      return this.setView(selector, view, true);
    }

    // If no `view` argument is defined, then assume the first argument is the
    // View, somewhat now confusingly named `selector`.
    return this.setView(selector, true);
  },

  // Iterate over an object and ensure every value is wrapped in an array to
  // ensure they will be inserted, then pass that object to `setViews`.
  insertViews: function(views) {
    // If an array of views was passed it should be inserted into the
    // root view. Much like calling insertView without a selector.
    if (_.isArray(views)) {
      return this.setViews({ "": views });
    }

    _.each(views, function(view, selector) {
      views[selector] = _.isArray(view) ? view : [view];
    });

    return this.setViews(views);
  },

  // Returns the View that matches the `getViews` filter function.
  getView: function(fn) {
    // If `getView` is invoked with undefined as the first argument, then the
    // second argument will be used instead.  This is to allow
    // `getViews(undefined, fn)` to work as `getViews(fn)`.  Useful for when
    // you are allowing an optional selector.
    if (typeof fn !== "function" && typeof fn !== "string") {
      fn = arguments[1];
    }

    return this.getViews(fn).first().value();
  },

  // Provide a filter function to get a flattened array of all the subviews.
  // If the filter function is omitted it will return all subviews.  If a
  // String is passed instead, it will return the Views for that selector.
  getViews: function(fn) {
    // Generate an array of all top level (no deeply nested) Views flattened.
    var views = _.chain(this.views).map(function(view) {
      return _.isArray(view) ? view : [view];
    }, this).flatten().value();

    // If the filter argument is a String, then return a chained Version of the
    // elements.
    if (typeof fn === "string") {
      return _.chain([this.views[fn]]).flatten();
    }

    // If the argument passed is an Object, then pass it to `_.where`.
    if (typeof fn === "object") {
      return _.chain([_.where(views, fn)]).flatten();
    }

    // If a filter function is provided, run it on all Views and return a
    // wrapped chain. Otherwise, simply return a wrapped chain of all Views.
    return _.chain(typeof fn === "function" ? _.filter(views, fn) : views);
  },

  // Use this to remove Views, internally uses `getViews` so you can pass the
  // same argument here as you would to that method.
  removeView: function(fn) {
    // Allow an optional selector or function to find the right model and
    // remove nested Views based off the results of the selector or filter.
    return this.getViews(fn).each(function(nestedView) {
      nestedView.remove();
    });
  },

  // This takes in a partial name and view instance and assigns them to
  // the internal collection of views.  If a view is not a LayoutManager
  // instance, then mix in the LayoutManager prototype.  This ensures
  // all Views can be used successfully.
  //
  // Must definitely wrap any render method passed in or defaults to a
  // typical render function `return layout(this).render()`.
  setView: function(name, view, insert) {
    var manager, existing, options;
    // Parent view, the one you are setting a View on.
    var root = this;

    // If no name was passed, use an empty string and shift all arguments.
    if (typeof name !== "string") {
      insert = view;
      view = name;
      name = "";
    }

    // If the parent views object doesn't exist... create it.
    this.views = this.views || {};

    // Shorthand the `__manager__` property.
    manager = view.__manager__;

    // Shorthand the View that potentially already exists.
    existing = this.views[name];

    // If the View has not been properly set up, throw an Error message
    // indicating that the View needs `manage: true` set.
    if (!manager) {
      throw new Error("Please set `View#manage` property with selector '" +
        name + "' to `true`.");
    }

    // Assign options.
    options = view.getAllOptions();

    // Add reference to the parentView.
    manager.parent = root;

    // Add reference to the placement selector used.
    manager.selector = name;

    // Set up event bubbling, inspired by Backbone.ViewMaster.  Do not bubble
    // internal events that are triggered.
    view.on("all", function(name) {
      if (name !== "beforeRender" && name !== "afterRender") {
        root.trigger.apply(root, arguments);
      }
    }, view);

    // Code path is less complex for Views that are not being inserted.  Simply
    // remove existing Views and bail out with the assignment.
    if (!insert) {
      // If the View we are adding has already been rendered, simply inject it
      // into the parent.
      if (manager.hasRendered) {
        // Apply the partial.
        options.partial(root.$el, view.$el, root.__manager__, manager);
      }

      // Ensure remove is called when swapping View's.
      if (existing) {
        // If the views are an array, iterate and remove each individually.
        _.each(aConcat.call([], existing), function(nestedView) {
          nestedView.remove();
        });
      }

      // Assign to main views object and return for chainability.
      return this.views[name] = view;
    }

    // Ensure this.views[name] is an array and push this View to the end.
    this.views[name] = aConcat.call([], existing || [], view);

    // Put the view into `insert` mode.
    manager.insert = true;

    return view;
  },

  // Allows the setting of multiple views instead of a single view.
  setViews: function(views) {
    // Iterate over all the views and use the View's view method to assign.
    _.each(views, function(view, name) {
      // If the view is an array put all views into insert mode.
      if (_.isArray(view)) {
        return _.each(view, function(view) {
          this.insertView(name, view);
        }, this);
      }

      // Assign each view using the view function.
      this.setView(name, view);
    }, this);

    // Allow for chaining
    return this;
  },

  // By default this should find all nested views and render them into
  // the this.el and call done once all of them have successfully been
  // resolved.
  //
  // This function returns a promise that can be chained to determine
  // once all subviews and main view have been rendered into the view.el.
  render: function() {
    var root = this;
    var options = root.getAllOptions();
    var manager = root.__manager__;
    var parent = manager.parent;
    var rentManager = parent && parent.__manager__;
    var def = options.deferred();

    // Triggered once the render has succeeded.
    function resolve() {
      var next, afterRender;

      // If there is a parent, attach.
      if (parent) {
        if (!options.contains(parent.el, root.el)) {
          // Apply the partial.
          options.partial(parent.$el, root.$el, rentManager, manager);
        }
      }

      // Ensure events are always correctly bound after rendering.
      root.delegateEvents();

      // Set this View as successfully rendered.
      manager.hasRendered = true;

      // Only process the queue if it exists.
      if (next = manager.queue.shift()) {
        // Ensure that the next render is only called after all other
        // `done` handlers have completed.  This will prevent `render`
        // callbacks from firing out of order.
        next();
      } else {
        // Once the queue is depleted, remove it, the render process has
        // completed.
        delete manager.queue;
      }

      // Reusable function for triggering the afterRender callback and event
      // and setting the hasRendered flag.
      function completeRender() {
        var afterRender = options.afterRender;

        if (afterRender) {
          afterRender.call(root, root);
        }

        // Always emit an afterRender event.
        root.trigger("afterRender", root);
      }

      // If the parent is currently rendering, wait until it has completed
      // until calling the nested View's `afterRender`.
      if (rentManager && rentManager.queue) {
        // Wait until the parent View has finished rendering, which could be
        // asynchronous, and trigger afterRender on this View once it has
        // compeleted.
        parent.once("afterRender", completeRender);
      } else {
        // This View and its parent have both rendered.
        completeRender();
      }

      return def.resolveWith(root, [root]);
    }

    // Actually facilitate a render.
    function actuallyRender() {
      var options = root.getAllOptions();
      var manager = root.__manager__;
      var parent = manager.parent;
      var rentManager = parent && parent.__manager__;

      // The `_viewRender` method is broken out to abstract away from having
      // too much code in `actuallyRender`.
      root._render(LayoutManager._viewRender, options).done(function() {
        // If there are no children to worry about, complete the render
        // instantly.
        if (!_.keys(root.views).length) {
          return resolve();
        }

        // Create a list of promises to wait on until rendering is done.
        // Since this method will run on all children as well, its sufficient
        // for a full hierarchical.
        var promises = _.map(root.views, function(view) {
          var insert = _.isArray(view);

          // If items are being inserted, they will be in a non-zero length
          // Array.
          if (insert && view.length) {
            // Schedule each view to be rendered in order and return a promise
            // representing the result of the final rendering.
            return _.reduce(view.slice(1), function(prevRender, view) {
              return prevRender.then(function() {
                return view.render();
              });
            // The first view should be rendered immediately, and the resulting
            // promise used to initialize the reduction.
            }, view[0].render());
          }

          // Only return the fetch deferred, resolve the main deferred after
          // the element has been attached to it's parent.
          return !insert ? view.render() : view;
        });

        // Once all nested Views have been rendered, resolve this View's
        // deferred.
        options.when(promises).done(resolve);
      });
    }

    // Another render is currently happening if there is an existing queue, so
    // push a closure to render later into the queue.
    if (manager.queue) {
      aPush.call(manager.queue, actuallyRender);
    } else {
      manager.queue = [];

      // This the first `render`, preceeding the `queue` so render
      // immediately.
      actuallyRender(root, def);
    }

    // Add the View to the deferred so that `view.render().view.el` is
    // possible.
    def.view = root;

    // This is the promise that determines if the `render` function has
    // completed or not.
    return def;
  },

  // Ensure the cleanup function is called whenever remove is called.
  remove: function() {
    // Force remove itself from its parent.
    LayoutManager._removeView(this, true);

    // Call the original remove function.
    return this._remove.apply(this, arguments);
  },

  // Merge instance and global options.
  getAllOptions: function() {
    // Instance overrides take precedence, fallback to prototype options.
    return _.extend({}, this, LayoutManager.prototype.options, this.options);
  }
},
{
  // Clearable cache.
  _cache: {},

  // Creates a deferred and returns a function to call when finished.
  _makeAsync: function(options, done) {
    var handler = options.deferred();

    // Used to handle asynchronous renders.
    handler.async = function() {
      handler._isAsync = true;

      return done;
    };

    return handler;
  },

  // This gets passed to all _render methods.  The `root` value here is passed
  // from the `manage(this).render()` line in the `_render` function
  _viewRender: function(root, options) {
    var url, contents, fetchAsync, renderedEl;
    var manager = root.__manager__;

    // This function is responsible for pairing the rendered template into
    // the DOM element.
    function applyTemplate(rendered) {
      // Actually put the rendered contents into the element.
      if (rendered) {
        // If no container is specified, we must replace the content.
        if (manager.noel) {
          // Hold a reference to created element as replaceWith doesn't return new el.
          renderedEl = root.$el.html(rendered).children();
          root.$el.replaceWith(renderedEl);
          // Don't delegate events here - we'll do that in resolve()
          root.setElement(renderedEl, false);
        } else {
          options.html(root.$el, rendered);
        }
      }

      // Resolve only after fetch and render have succeeded.
      fetchAsync.resolveWith(root, [root]);
    }

    // Once the template is successfully fetched, use its contents to proceed.
    // Context argument is first, since it is bound for partial application
    // reasons.
    function done(context, contents) {
      // Store the rendered template someplace so it can be re-assignable.
      var rendered;
      // This allows the `render` method to be asynchronous as well as `fetch`.
      var renderAsync = LayoutManager._makeAsync(options, function(rendered) {
        applyTemplate(rendered);
      });

      // Ensure the cache is up-to-date.
      LayoutManager.cache(url, contents);

      // Render the View into the el property.
      if (contents) {
        rendered = options.render.call(renderAsync, contents, context);
      }

      // If the function was synchronous, continue execution.
      if (!renderAsync._isAsync) {
        applyTemplate(rendered);
      }
    }

    return {
      // This `render` function is what gets called inside of the View render,
      // when `manage(this).render` is called.  Returns a promise that can be
      // used to know when the element has been rendered into its parent.
      render: function() {
        var context = root.serialize || options.serialize;
        var template = root.template || options.template;

        // If data is a function, immediately call it.
        if (_.isFunction(context)) {
          context = context.call(root);
        }

        // This allows for `var done = this.async()` and then `done(contents)`.
        fetchAsync = LayoutManager._makeAsync(options, function(contents) {
          done(context, contents);
        });

        // Set the url to the prefix + the view's template property.
        if (typeof template === "string") {
          url = options.prefix + template;
        }

        // Check if contents are already cached and if they are, simply process
        // the template with the correct data.
        if (contents = LayoutManager.cache(url)) {
          done(context, contents, url);

          return fetchAsync;
        }

        // Fetch layout and template contents.
        if (typeof template === "string") {
          contents = options.fetch.call(fetchAsync, options.prefix + template);
        // If the template is already a function, simply call it.
        } else if (typeof template === "function") {
          contents = template;
        // If its not a string and not undefined, pass the value to `fetch`.
        } else if (template != null) {
          contents = options.fetch.call(fetchAsync, template);
        }

        // If the function was synchronous, continue execution.
        if (!fetchAsync._isAsync) {
          done(context, contents);
        }

        return fetchAsync;
      }
    };
  },

  // Remove all nested Views.
  _removeViews: function(root, force) {
    var views;

    // Shift arguments around.
    if (typeof root === "boolean") {
      force = root;
      root = this;
    }

    // Allow removeView to be called on instances.
    root = root || this;

    // Iterate over all of the nested View's and remove.
    root.getViews().each(function(view) {
      // Force doesn't care about if a View has rendered or not.
      if (view.__manager__.hasRendered || force) {
        LayoutManager._removeView(view, force);
      }
    });
  },

  // Remove a single nested View.
  _removeView: function(view, force) {
    var parentViews;
    // Shorthand the manager for easier access.
    var manager = view.__manager__;
    // Test for keep.
    var keep = typeof view.keep === "boolean" ? view.keep : view.options.keep;

    // Only remove views that do not have `keep` attribute set, unless the
    // View is in `insert` mode and the force flag is set.
    if (!keep && (manager.insert === true || force)) {
      // Clean out the events.
      LayoutManager.cleanViews(view);

      // Since we are removing this view, force subviews to remove
      view._removeViews(true);

      // Remove the View completely.
      view.$el.remove();

      // Bail out early if no parent exists.
      if (!manager.parent) { return; }

      // Assign (if they exist) the sibling Views to a property.
      parentViews = manager.parent.views[manager.selector];

      // If this is an array of items remove items that are not marked to
      // keep.
      if (_.isArray(parentViews)) {
        // Remove duplicate Views.
        return _.each(_.clone(parentViews), function(view, i) {
          // If the managers match, splice off this View.
          if (view && view.__manager__ === manager) {
            aSplice.call(parentViews, i, 1);
          }
        });
      }

      // Otherwise delete the parent selector.
      delete manager.parent.views[manager.selector];
    }
  },

  // Cache templates into LayoutManager._cache.
  cache: function(path, contents) {
    // If template path is found in the cache, return the contents.
    if (path in this._cache && contents == null) {
      return this._cache[path];
    // Ensure path and contents aren't undefined.
    } else if (path != null && contents != null) {
      return this._cache[path] = contents;
    }

    // If the template is not in the cache, return undefined.
  },

  // Accept either a single view or an array of views to clean of all DOM
  // events internal model and collection references and all Backbone.Events.
  cleanViews: function(views) {
    // Clear out all existing views.
    _.each(aConcat.call([], views), function(view) {
      // Remove all custom events attached to this View.
      view.unbind();

      // Automatically unbind `model`.
      if (view.model instanceof Backbone.Model) {
        view.model.off(null, null, view);
      }

      // Automatically unbind `collection`.
      if (view.collection instanceof Backbone.Collection) {
        view.collection.off(null, null, view);
      }

      // Automatically unbind events bound to this View.
      view.stopListening();

      // If a custom cleanup method was provided on the view, call it after
      // the initial cleanup is done
      _.result(view, "cleanup");
    });
  },

  // This static method allows for global configuration of LayoutManager.
  configure: function(options) {
    _.extend(LayoutManager.prototype.options, options);

    // Allow LayoutManager to manage Backbone.View.prototype.
    if (options.manage) {
      Backbone.View.prototype.manage = true;
    }

    // Disable the element globally.
    if (options.el === false) {
      Backbone.View.prototype.el = false;
    }
  },

  // Configure a View to work with the LayoutManager plugin.
  setupView: function(views, options) {
    // Set up all Views passed.
    _.each(aConcat.call([], views), function(view) {
      // If the View has already been setup, no need to do it again.
      if (view.__manager__) {
        return;
      }

      var views, declaredViews, viewOptions;
      var proto = LayoutManager.prototype;
      var viewOverrides = _.pick(view, keys);

      // Ensure necessary properties are set.
      _.defaults(view, {
        // Ensure a view always has a views object.
        views: {},

        // Internal state object used to store whether or not a View has been
        // taken over by layout manager and if it has been rendered into the DOM.
        __manager__: {},

        // Add the ability to remove all Views.
        _removeViews: LayoutManager._removeViews,

        // Add the ability to remove itself.
        _removeView: LayoutManager._removeView

      // Mix in all LayoutManager prototype properties as well.
      }, LayoutManager.prototype);

      // Extend the options with the prototype and passed options.
      options = view.options = _.defaults(options || {}, view.options,
        proto.options);

      // Ensure view events are properly copied over.
      viewOptions = _.pick(options, aConcat.call(["events"],
        _.values(options.events)));

      // Merge the View options into the View.
      _.extend(view, viewOptions);

      // If the View still has the Backbone.View#render method, remove it.  Don't
      // want it accidentally overriding the LM render.
      if (viewOverrides.render === LayoutManager.prototype.render ||
        viewOverrides.render === Backbone.View.prototype.render) {
        delete viewOverrides.render;
      }

      // Pick out the specific properties that can be dynamically added at
      // runtime and ensure they are available on the view object.
      _.extend(options, viewOverrides);

      // By default the original Remove function is the Backbone.View one.
      view._remove = Backbone.View.prototype.remove;

      // Always use this render function when using LayoutManager.
      view._render = function(manage, options) {
        // Keep the view consistent between callbacks and deferreds.
        var view = this;
        // Shorthand the manager.
        var manager = view.__manager__;
        // Cache these properties.
        var beforeRender = options.beforeRender;

        // Ensure all nested Views are properly scrubbed if re-rendering.
        if (manager.hasRendered) {
          this._removeViews();
        }

        // If a beforeRender function is defined, call it.
        if (beforeRender) {
          beforeRender.call(this, this);
        }

        // Always emit a beforeRender event.
        this.trigger("beforeRender", this);

        // Render!
        return manage(this, options).render();
      };

      // Ensure the render is always set correctly.
      view.render = LayoutManager.prototype.render;

      // If the user provided their own remove override, use that instead of the
      // default.
      if (view.remove !== proto.remove) {
        view._remove = view.remove;
        view.remove = proto.remove;
      }

      // Normalize views to exist on either instance or options, default to
      // options.
      views = options.views || view.views;

      // Set the internal views, only if selectors have been provided.
      if (_.keys(views).length) {
        // Keep original object declared containing Views.
        declaredViews = views;

        // Reset the property to avoid duplication or overwritting.
        view.views = {};

        // Set the declared Views.
        view.setViews(declaredViews);
      }

      // If a template is passed use that instead.
      if (view.options.template) {
        view.options.template = options.template;
      // Ensure the template is mapped over.
      } else if (view.template) {
        options.template = view.template;

        // Remove it from the instance.
        delete view.template;
      }
    });
  }
});

// Convenience assignment to make creating Layout's slightly shorter.
Backbone.Layout = LayoutManager;
// Tack on the version.
LayoutManager.VERSION = "0.8.4";

// Override _configure to provide extra functionality that is necessary in
// order for the render function reference to be bound during initialize.
Backbone.View.prototype._configure = function(options) {
  var noel, retVal;

  // Remove the container element provided by Backbone.
  if ("el" in options ? options.el === false : this.el === false) {
    noel = true;
  }

  // Run the original _configure.
  retVal = _configure.apply(this, arguments);

  // If manage is set, do it!
  if (options.manage || this.manage) {
    // Set up this View.
    LayoutManager.setupView(this);
  }

  // Assign the `noel` property once we're sure the View we're working with is
  // mangaed by LayoutManager.
  if (this.__manager__) {
    this.__manager__.noel = noel;
  }

  // Act like nothing happened.
  return retVal;
};

// Default configuration options; designed to be overriden.
LayoutManager.prototype.options = {
  // Prefix template/layout paths.
  prefix: "",

  // Can be used to supply a different deferred implementation.
  deferred: function() {
    return $.Deferred();
  },

  // Fetch is passed a path and is expected to return template contents as a
  // function or string.
  fetch: function(path) {
    return _.template($(path).html());
  },

  // This is the most common way you will want to partially apply a view into
  // a layout.
  partial: function($root, $el, rentManager, manager) {
    // If selector is specified, attempt to find it.
    if (manager.selector) {
      if (rentManager.noel) {
        var $filtered = $root.filter(manager.selector);
        $root = $filtered.length ? $filtered : $root.find(manager.selector);
      } else {
        $root = $root.find(manager.selector);
      }
    }

    // Use the insert method if insert argument is true.
    if (manager.insert) {
      this.insert($root, $el);
    } else {
      this.html($root, $el);
    }
  },

  // Override this with a custom HTML method, passed a root element and content
  // (a jQuery collection or a string) to replace the innerHTML with.
  html: function($root, content) {
    $root.html(content);
  },

  // Very similar to HTML except this one will appendChild by default.
  insert: function($root, $el) {
    $root.append($el);
  },

  // Return a deferred for when all promises resolve/reject.
  when: function(promises) {
    return $.when.apply(null, promises);
  },

  // By default, render using underscore's templating.
  render: function(template, context) {
    return template(context);
  },

  // A method to determine if a View contains another.
  contains: function(parent, child) {
    return $.contains(parent, child);
  }
};

// Maintain a list of the keys at define time.
keys = _.keys(LayoutManager.prototype.options);

})(typeof global === "object" ? global : this);

define("layoutmanager", function(){});

eval("/**\r\n * App helpers functions\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'app\',[\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"handlebars\",\r\n\t\"layoutmanager\"\r\n],\r\nfunction( $, _, Backbone, Handlebars ) {\r\n\t\"use strict\";\r\n\r\n\t// Provide a global location to place configuration settings and module\r\n\t// creation.\r\n\tvar app = {\r\n\t\t// The root path to run the application.\r\n\t\troot: \"/\",\r\n\t\tViews: {},\r\n\t\tModels: {}\r\n\t};\r\n\t\r\n\t// Localize or create a new JavaScript Template object.\r\n\tvar JST = window.JST = window.JST || {};\r\n\t\r\n\t// Configure LayoutManager with Backbone Boilerplate defaults.\r\n\tBackbone.Layout.configure({\r\n\t\t// Allow LayoutManager to augment Backbone.View.prototype.\r\n\t\tmanage: true,\r\n\t\t\r\n\t\tprefix: \"app/templates/\",\r\n\t\t\r\n\t\tfetch: function( path ) {\r\n\t\t\tvar done;\r\n\t\t\t\r\n\t\t\t// Add the html extension.\r\n\t\t\tpath = path + \".hbs\";\r\n\t\t\t\r\n\t\t\t// If the template has not been loaded yet, then load.\r\n\t\t\tif (!JST[path]) {\r\n\t\t\t\tdone = this.async();\r\n\t\t\t\treturn $.get( app.root + path, function( contents ) {\r\n\t\t\t\t\tJST[path] = Handlebars.compile( contents );\r\n\t\t\t\t\tJST[path].__compiled__ = true;\r\n\t\t\t\t\t\r\n\t\t\t\t\tdone(JST[path]);\r\n\t\t\t\t}, \'text\');\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\t// If the template hasn\'t been compiled yet, then compile.\r\n\t\t\tif (!JST[path].__compiled__) {\r\n\t\t\t\tJST[path] = Handlebars.template(JST[path]);\r\n\t\t\t\tJST[path].__compiled__ = true;\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\treturn JST[path];\r\n\t\t}\r\n\t});\r\n\t\r\n\t// Mix Backbone.Events, modules, and layout management into the app object.\r\n\treturn _.extend( app, {\r\n\t\t// Create a custom object with a nested Views object.\r\n\t\tmodule: function( additionalProps ) {\r\n\t\t\treturn _.extend({\r\n\t\t\t\tViews: {}\r\n\t\t\t}, additionalProps );\r\n\t\t},\r\n\t\t\r\n\t\t// Helper for using layouts.\r\n\t\tuseLayout: function( name, options ) {\r\n\t\t\t// If already using this Layout, then don\'t re-inject into the DOM.\r\n\t\t\tif ( this.layout && this.layout.options.template === name ) {\r\n\t\t\t\treturn this.layout;\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\t// If a layout already exists, remove it from the DOM.\r\n\t\t\tif ( this.layout ) {\r\n\t\t\t\tthis.layout.remove();\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\t// Create a new Layout with options.\r\n\t\t\tvar layout = new Backbone.Layout(_.extend({\r\n\t\t\t\ttemplate: name,\r\n\t\t\t\tclassName: \"layout \" + name,\r\n\t\t\t\tid: \"layout\"\r\n\t\t\t}, options));\r\n\t\t\t\r\n\t\t\t// Insert into the DOM.\r\n\t\t\t$(\"#main\").empty().append(layout.el);\r\n\t\t\t\r\n\t\t\t// Render the layout.\r\n\t\t\tlayout.render();\r\n\t\t\t\r\n\t\t\t// Cache the refererence.\r\n\t\t\tthis.layout = layout;\r\n\t\t\t\r\n\t\t\t// Return the reference, for chainability.\r\n\t\t\treturn layout;\r\n\t\t}\r\n\t}, Backbone.Events);\r\n\r\n});\r\n\n//@ sourceURL=/app.js");

eval("/**\r\n * Backbone localStorage Adapter\r\n * Version 1.1.0\r\n *\r\n * https://github.com/jeromegn/Backbone.localStorage\r\n */\r\n(function (root, factory) {\r\n   if (typeof define === \"function\" && define.amd) {\r\n      // AMD. Register as an anonymous module.\r\n      define(\'localStorage\',[\"underscore\",\"backbone\"], function(_, Backbone) {\r\n        // Use global variables if the locals is undefined.\r\n        return factory(_ || root._, Backbone || root.Backbone);\r\n      });\r\n   } else {\r\n      // RequireJS isn\'t being used. Assume underscore and backbone is loaded in <script> tags\r\n      factory(_, Backbone);\r\n   }\r\n}(this, function(_, Backbone) {\r\n// A simple module to replace `Backbone.sync` with *localStorage*-based\r\n// persistence. Models are given GUIDS, and saved into a JSON object. Simple\r\n// as that.\r\n\r\n// Hold reference to Underscore.js and Backbone.js in the closure in order\r\n// to make things work even if they are removed from the global namespace\r\n\r\n// Generate four random hex digits.\r\nfunction S4() {\r\n   return (((1+Math.random())*0x10000)|0).toString(16).substring(1);\r\n};\r\n\r\n// Generate a pseudo-GUID by concatenating random hexadecimal.\r\nfunction guid() {\r\n   return (S4()+S4()+\"-\"+S4()+\"-\"+S4()+\"-\"+S4()+\"-\"+S4()+S4()+S4());\r\n};\r\n\r\n// Our Store is represented by a single JS object in *localStorage*. Create it\r\n// with a meaningful name, like the name you\'d give a table.\r\n// window.Store is deprectated, use Backbone.LocalStorage instead\r\nBackbone.LocalStorage = window.Store = function(name) {\r\n  this.name = name;\r\n  var store = this.localStorage().getItem(this.name);\r\n  this.records = (store && store.split(\",\")) || [];\r\n};\r\n\r\n_.extend(Backbone.LocalStorage.prototype, {\r\n\r\n  // Save the current state of the **Store** to *localStorage*.\r\n  save: function() {\r\n    this.localStorage().setItem(this.name, this.records.join(\",\"));\r\n  },\r\n\r\n  // Add a model, giving it a (hopefully)-unique GUID, if it doesn\'t already\r\n  // have an id of it\'s own.\r\n  create: function(model) {\r\n    if (!model.id) {\r\n      model.id = guid();\r\n      model.set(model.idAttribute, model.id);\r\n    }\r\n    this.localStorage().setItem(this.name+\"-\"+model.id, JSON.stringify(model));\r\n    this.records.push(model.id.toString());\r\n    this.save();\r\n    return this.find(model);\r\n  },\r\n\r\n  // Update a model by replacing its copy in `this.data`.\r\n  update: function(model) {\r\n    this.localStorage().setItem(this.name+\"-\"+model.id, JSON.stringify(model));\r\n    if (!_.include(this.records, model.id.toString()))\r\n      this.records.push(model.id.toString()); this.save();\r\n    return this.find(model);\r\n  },\r\n\r\n  // Retrieve a model from `this.data` by id.\r\n  find: function(model) {\r\n    return this.jsonData(this.localStorage().getItem(this.name+\"-\"+model.id));\r\n  },\r\n\r\n  // Return the array of all models currently in storage.\r\n  findAll: function() {\r\n    return _(this.records).chain()\r\n      .map(function(id){\r\n        return this.jsonData(this.localStorage().getItem(this.name+\"-\"+id));\r\n      }, this)\r\n      .compact()\r\n      .value();\r\n  },\r\n\r\n  // Delete a model from `this.data`, returning it.\r\n  destroy: function(model) {\r\n    if (model.isNew())\r\n      return false\r\n    this.localStorage().removeItem(this.name+\"-\"+model.id);\r\n    this.records = _.reject(this.records, function(id){\r\n      return id === model.id.toString();\r\n    });\r\n    this.save();\r\n    return model;\r\n  },\r\n\r\n  localStorage: function() {\r\n    return localStorage;\r\n  },\r\n  \r\n  // fix for \"illegal access\" error on Android when JSON.parse is passed null\r\n  jsonData: function (data) {\r\n      return data && JSON.parse(data);\r\n  }\r\n\r\n});\r\n\r\n// localSync delegate to the model or collection\'s\r\n// *localStorage* property, which should be an instance of `Store`.\r\n// window.Store.sync and Backbone.localSync is deprectated, use Backbone.LocalStorage.sync instead\r\nBackbone.LocalStorage.sync = window.Store.sync = Backbone.localSync = function(method, model, options) {\r\n  var store = model.localStorage || model.collection.localStorage;\r\n\r\n  var resp, errorMessage, syncDfd = $.Deferred && $.Deferred(); //If $ is having Deferred - use it. \r\n\r\n  try {\r\n\r\n    switch (method) {\r\n      case \"read\":\r\n        resp = model.id != undefined ? store.find(model) : store.findAll();\r\n        break;\r\n      case \"create\":\r\n        resp = store.create(model);\r\n        break;\r\n      case \"update\":\r\n        resp = store.update(model);\r\n        break;\r\n      case \"delete\":\r\n        resp = store.destroy(model);\r\n        break;\r\n    }\r\n\r\n  } catch(error) {\r\n    if (error.code === DOMException.QUOTA_EXCEEDED_ERR && window.localStorage.length === 0)\r\n      errorMessage = \"Private browsing is unsupported\";\r\n    else\r\n      errorMessage = error.message;\r\n  }\r\n\r\n  if (resp) {\r\n    if (options && options.success)\r\n      if (Backbone.VERSION === \"0.9.10\") {\r\n        options.success(model, resp, options);\r\n      } else {\r\n        options.success(resp);\r\n      }\r\n    if (syncDfd)\r\n      syncDfd.resolve(resp);\r\n\r\n  } else {\r\n    errorMessage = errorMessage ? errorMessage\r\n                                : \"Record Not Found\";\r\n    \r\n    if (options && options.error)\r\n      if (Backbone.VERSION === \"0.9.10\") {\r\n        options.error(model, errorMessage, options);\r\n      } else {\r\n        options.error(errorMessage);\r\n      }\r\n      \r\n    if (syncDfd)\r\n      syncDfd.reject(errorMessage);\r\n  }\r\n  \r\n  // add compatibility with $.ajax\r\n  // always execute callback for success and error\r\n  if (options && options.complete) options.complete(resp);\r\n\r\n  return syncDfd && syncDfd.promise();\r\n};\r\n\r\nBackbone.ajaxSync = Backbone.sync;\r\n\r\nBackbone.getSyncMethod = function(model) {\r\n  if(model.localStorage || (model.collection && model.collection.localStorage)) {\r\n    return Backbone.localSync;\r\n  }\r\n\r\n  return Backbone.ajaxSync;\r\n};\r\n\r\n// Override \'Backbone.sync\' to default to localSync,\r\n// the original \'Backbone.sync\' is still available in \'Backbone.ajaxSync\'\r\nBackbone.sync = function(method, model, options) {\r\n  return Backbone.getSyncMethod(model).apply(this, [method, model, options]);\r\n};\r\n\r\nreturn Backbone.LocalStorage;\r\n}));\n//@ sourceURL=/S:/www/github/newtab-bookmarks/extension/assets/js/backbone.localStorage/backbone.localStorage.js");

eval("/**\r\n * Settings\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'models/settings\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"localStorage\"\r\n],\r\nfunction( app, $, _, Backbone ) {\r\n\t\"use strict\";\r\n\t\r\n\tvar Settings = Backbone.Model.extend({\r\n\t\t\r\n\t\tlocalStorage: new Backbone.LocalStorage(\'settings\'),\r\n\r\n\t\tid: 1, // Make sure to only keep one canonical settings object\r\n\t\t\r\n\t\tdefaults: {\r\n\t\t\tviewmode : \'grid\',\r\n\t\t\tzoomVal  : 5\r\n\t\t},\r\n\t\t\r\n\t\tinitialize: function() {\r\n\t\t\tthis.on( \'change\', function() {\r\n\t\t\t\tthis.save();\r\n\t\t\t}, this );\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\treturn Settings;\r\n\t\r\n});\r\n\n//@ sourceURL=/models/settings.js");

eval("/**\r\n * Settings\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'instances/settings\',[\r\n\t\"app\",\r\n\t\"models/settings\"\r\n],\r\nfunction( app, Settings ) {\r\n\t\"use strict\";\r\n\t\r\n\tapp.Models.settings = new Settings();\r\n\t\r\n\treturn app.Models.settings;\r\n\t\r\n});\r\n\n//@ sourceURL=/instances/settings.js");

eval("/**\r\n * Utils\r\n *\r\n * @info: Collection of helper functions\r\n * \r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'modules/utils\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\"\r\n],\r\nfunction( app, $, _, Backbone ) {\r\n\t\"use strict\";\r\n\t\r\n\tvar utils = {};\r\n\t\r\n\t\r\n\tutils.sortObject = function( obj ) {\r\n\t\tvar arr = [];\r\n\t\tfor ( var prop in obj ) {\r\n\t\t\tif ( obj.hasOwnProperty(prop) ) {\r\n\t\t\t\tarr.push({\r\n\t\t\t\t\t\'key\': prop,\r\n\t\t\t\t\t\'value\': obj[prop]\r\n\t\t\t\t});\r\n\t\t\t}\r\n\t\t}\r\n\t\tarr.sort(function( a, b ) { return a.value - b.value; });\r\n\t\treturn arr; // returns array\r\n\t};\r\n\t\r\n\tutils.cleanDomain = function( u ) {\r\n\t\tvar s = u;\r\n\t\ts = s.replace(\'https://www.\', \'\');\r\n\t\ts = s.replace(\'http://www.\', \'\');\r\n\t\ts = s.replace(\'https://\', \'\');\r\n\t\ts = s.replace(\'http://\', \'\');\r\n\t\ts = s.substr( 0, s.indexOf(\'/\') );\r\n\t\treturn s;\r\n\t};\r\n\t\r\n\tutils.isURL = function( s ) {\r\n\t\t//This function has to be more liberal,\r\n\t\t// we want to let simple url entry work as well\r\n\t\t// ie. facebook.com, bit.ly, www.google.com, etc)\r\n\t\tvar domain =/^([a-z0-9]([-a-z0-9]*[a-z0-9])?\\\\.)+((a[cdefgilmnoqrstuwxz]|aero|arpa)|(b[abdefghijmnorstvwyz]|biz)|(c[acdfghiklmnorsuvxyz]|cat|com|coop)|d[ejkmoz]|(e[ceghrstu]|edu)|f[ijkmor]|(g[abdefghilmnpqrstuwy]|gov)|h[kmnrtu]|(i[delmnoqrst]|info|int)|(j[emop]|jobs)|k[eghimnprwyz]|l[abcikrstuvy]|(m[acdghklmnopqrstuvwxyz]|mil|mobi|museum)|(n[acefgilopruz]|name|net)|(om|org)|(p[aefghklmnrstwy]|pro)|qa|r[eouw]|s[abcdeghijklmnortvyz]|(t[cdfghjklmnoprtvwz]|travel)|u[agkmsyz]|v[aceginu]|w[fs]|y[etu]|z[amw])$/i;\r\n\t\tvar fullUrl = /(ftp|http|https):\\/\\/(\\w+:{0,1}\\w*@)?(\\S+)(:[0-9]+)?(\\/|\\/([\\w#!:.?+=&%@!\\-\\/]))?/;\r\n\t\tif ( fullUrl.test(s) || domain.test(s) ) {\r\n\t\t\treturn true;\r\n\t\t} else {\r\n\t\t\treturn false;\r\n\t\t}\r\n\t};\r\n\t\r\n\tutils.urlize = function ( s ) { //append http block is doesnt look like a valid url (for facebook use websites..)\r\n\t\tif ( !utils.isUrl(s) ) {\r\n\t\t\treturn \'http://\'+s;\r\n\t\t} else {\r\n\t\t\treturn s;\r\n\t\t}\r\n\t};\r\n\t\r\n\tutils.getDomain = function( url ) {\r\n\t\treturn url.match(/:\\/\\/(www[0-9]?\\.)?(.[^\\/:]+)/)[2];\r\n\t};\r\n\t\r\n\tutils.getTextNodesIn = function( node, includeWhitespaceNodes ) {\r\n\t\tvar textNodes = [],\r\n\t\t\twhitespace = /^\\s*$/,\r\n\t\t\ti, len;\r\n\t\t\r\n\t\tfunction getTextNodes( node ) {\r\n\t\t // console.log(node.nodeName);\r\n\t\t\tif ( node.nodeType === 3 ) {\r\n\t\t\t\tif (includeWhitespaceNodes || !whitespace.test(node.nodeValue)) {\r\n\t\t\t\t\t  textNodes.push(node);\r\n\t\t\t\t}\r\n\t\t\t} else {\r\n\t\t\t\t//don\'t parse special node\'s \r\n\t\t\t\tif ( (node.nodeName !== \'#comment\') && (node.nodeName !== \'SCRIPT\') && (node.nodeName !== \'STYLE\') ) {\r\n\t\t\t\t  for ( i = 0, len = node.childNodes.length; i < len; i += 1 ) {\r\n\t\t\t\t\tgetTextNodes(node.childNodes[i]);\r\n\t\t\t\t  }\r\n\t\t\t\t} else {\r\n\t\t\t\t  //console.log(\'bad node: \'+node.nodeName)\r\n\t\t\t\t}\r\n\t\t\t}\r\n\t\t}\r\n\t\t\r\n\t\tgetTextNodes(node);\r\n\t\treturn textNodes;\r\n\t};\r\n\t\r\n\tutils.matchKeywords = function( s, content ) {\r\n\t\tcontent = \',\'+content;\r\n\t\t\r\n\t\t//All terms have to be there\r\n\t\ts = s.replace(\',\', \' \');\r\n\t\ts = s.replace(\'+\', \' \');\r\n\t\ts = s.replace(\'   \', \' \');\r\n\t\ts = s.replace(\'  \', \' \');\r\n\t\tvar terms = s.split(\' \');\r\n\t\t\r\n\t\tvar results = true;\r\n\t\t_.each(terms, function(t){\r\n\t\t\tif( content.indexOf(\',\' + t) < 0 ) { //keyword is not there\r\n\t\t\t\tresults = false;\r\n\t\t\t}\r\n\t\t});\r\n\t\t\r\n\t\treturn results;\r\n\t};\r\n\t\r\n\t// Required, return the module for AMD compliance\r\n\treturn utils;\r\n\r\n});\r\n\n//@ sourceURL=/modules/utils.js");

eval("/**\r\n * Single Bookmark view\r\n *\r\n * @todo: Remove reference to container. View shouldn\'t know anything out of his scope\r\n * \r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'views/single-bookmark\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\"\r\n],\r\nfunction( app, $, _, Backbone ) {\r\n\t\"use strict\";\r\n\t\r\n\tvar BookmarkView = Backbone.View.extend({\r\n\t\t\r\n\t\ttagName: \'li\',\r\n\t\t\r\n\t\ttemplate: \"single-bookmark\",\r\n\t\t\r\n\t\tserialize: function() {\r\n\t\t\treturn this.model.toJSON();\r\n\t\t},\r\n\r\n\t\tafterRender: function() {\r\n\t\t\tthis.listenTo( this.model, \"change\", function( model ) {\r\n\t\t\t\t// Ignore `keep` value changes and `folder` (as array are referenced by instances,\r\n\t\t\t\t// not value)\r\n\t\t\t\tvar realChanged = _.omit( model.changed, [ \"keep\", \"folder\" ]);\r\n\r\n\t\t\t\tif ( _.keys(realChanged).length ) {\r\n\t\t\t\t\tthis.render();\r\n\t\t\t\t}\r\n\t\t\t});\r\n\t\t\tthis.listenTo( this.model, \"destroy\", function() {\r\n\t\t\t\tthis.$el.animate({ \"opacity\" : 0.4 });\r\n\t\t\t});\r\n\t\t}\r\n\t});\r\n\t\r\n\treturn BookmarkView;\r\n\r\n});\r\n\n//@ sourceURL=/views/single-bookmark.js");

eval("/**\r\n * Single Bookmark model\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'models/single-bookmark\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"modules/utils\",\r\n\t\"views/single-bookmark\",\r\n\t\"localStorage\"\r\n],\r\nfunction( app, $, _, Backbone, utils, BookmarkView ) {\r\n\t\"use strict\";\r\n\t\r\n\tvar Bookmark = Backbone.Model.extend({\r\n\t\t\r\n\t\t// Identify model via their URL as this is their canonical/unique reference\r\n\t\tidAttribute: \"url\",\r\n\r\n\t\tdefaults: {\r\n\t\t\turl           : \"\",\r\n\t\t\ttitle         : \"\",\r\n\t\t\ttype          : \"\",\r\n\t\t\tdateAdded     : \"\",\r\n\t\t\tfolder        : [],\r\n\t\t\tdomain        : false,\r\n\t\t\tcontent_type  : \"web\",\r\n\t\t\tthumbnail_url : \"\",\r\n\t\t\tscore         : 0,\r\n\t\t\tkeep          : false\r\n\t\t},\r\n\t\t\r\n\t\tlocalStorage: new Backbone.LocalStorage(\'whatever2\'),\r\n\t\t\r\n\t\tinitialize: function() {\r\n\t\t\t\r\n\t\t\tvar url = this.get(\'url\');\r\n\t\t\tif ( utils.isURL(url) ) {\r\n\t\t\t\tthis.set( \'domain\', utils.getDomain(url) );\r\n\t\t\t} else {\r\n\t\t\t\t//this can be a bookmarklet, a FTP, or special page bookmark...\r\n\t\t\t\tthis.set( \'domain\', false );\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\t//set the main set_content_type\r\n\t\t\tthis.set_content_type();\r\n\r\n\t\t\t//if there\'s no title, use domain name\r\n\t\t\tif ( !this.get(\'title\').length ) {\r\n\t\t\t\tthis.set( \'title\', this.get(\'domain\') );\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\tthis.set( \'thumbnail_url\', this.get_thumb_url() );\r\n\t\t\tthis.save();\r\n\t\t\t\r\n\t\t},\r\n\r\n\t\tsave: function(attrs, options) {\r\n\t\t\toptions || (options = {});\r\n\t\t\t\r\n\t\t\tattrs = attrs || this.toJSON();\r\n\r\n\t\t\t// Filter the data to send to the server\r\n\t\t\tdelete attrs.keep;\r\n\t\t\tdelete attrs.score;\r\n\t\t\tdelete attrs.thumbnail_url;\r\n\t\t\tdelete attrs.content_type;\r\n\r\n\t\t\t// Set data to be saved\r\n\t\t\toptions.data = JSON.stringify(attrs);\r\n\r\n\t\t\t// Proxy the call to the original save function\r\n\t\t\tBackbone.Model.prototype.save.call(this, attrs, options);\r\n\t\t},\r\n\t\t\r\n\t\tset_content_type: function() {\r\n\t\t\t// @TODO add all types, find less awfull algorithm to sort websites...\r\n\t\t\tvar url = this.get(\'url\');\r\n\t\t\tvar type = this.get(\'type\');\r\n\t\t\tvar t;\r\n\t\t\tif ( url.indexOf(\'.pdf\') !== -1 || url.indexOf(\'books.google.\') !== -1 ) {\r\n\t\t\t\tt = \'doc\';\r\n\t\t\t} else if ( (url.indexOf(\'.jpg\') !== -1) || (url.indexOf(\'.jpeg\') !== -1) || (url.indexOf(\'.png\') !== -1) || (url.indexOf(\'.gif\') !== -1) || (url.indexOf(\'flickr.com\') !== -1) ) {\r\n\t\t\t\tt = \'photo\';\r\n\t\t\t} else if ( (url.indexOf(\'wordpress.\') !== -1) || (url.indexOf(\'blogger.\') !== -1) ) {\r\n\t\t\t\tt = \'blog\';\r\n\t\t\t} else if ( (url.indexOf(\'youtube.\') !== -1) || (url.indexOf(\'dailymotion.\') !== -1)|| (url.indexOf(\'vimeo.\') !== -1) ) {\r\n\t\t\t\tt = \'video\';\r\n\t\t\t} else if ( type === \'facebook_friend\' ) {\r\n\t\t\t\tt = \'person\';\r\n\t\t\t} else if ( type === \'facebook_like\' ) {\r\n\t\t\t\tt = \'facebook_like\';\r\n\t\t\t} else {\r\n\t\t\t\tt = \'web\';\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\tthis.set(\'content_type\', t);\r\n\t\t},\r\n\t\t\r\n\t\tget_thumb_url: function() {\r\n\t\t\tif ( _.indexOf([\'facebook_like\', \'facebook_friend\'], this.get(\'type\')) >= 0 ) {\r\n\t\t\t\treturn \'http://graph.facebook.com/\' + this.get(\'uid\') + \'/picture?height=360&width=480\';\r\n\t\t\t} else {\r\n\t\t\t\tif ( this.get(\'url\').indexOf(\"https://\") === 0 ) {\r\n\t\t\t\t\treturn \'http://pagepeeker.com/thumbs.php?size=x&url=\' + this.get(\'url\');\r\n\t\t\t\t} else {\r\n\t\t\t\t\treturn \'http://immediatenet.com/t/l?Size=1024x768&URL=\' + this.get(\'url\');\r\n\t\t\t\t}\r\n\t\t\t}\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t\r\n\treturn Bookmark;\r\n\r\n});\r\n\n//@ sourceURL=/models/single-bookmark.js");

/*
 * Fuzzy
 * https://github.com/myork/fuzzy
 *
 * Copyright (c) 2012 Matt York
 * Licensed under the MIT license.
 */

(function() {

var root = this;

var fuzzy = {};

// Use in node or in browser
if (typeof exports !== 'undefined') {
  module.exports = fuzzy;
} else {
  root.fuzzy = fuzzy;
}

// Return all elements of `array` that have a fuzzy
// match against `pattern`.
fuzzy.simpleFilter = function(pattern, array) {
  return array.filter(function(string) {
    return fuzzy.test(pattern, string);
  });
};

// Does `pattern` fuzzy match `string`?
fuzzy.test = function(pattern, string) {
  return fuzzy.match(pattern, string) !== null;
};

// If `pattern` matches `string`, wrap each matching character
// in `opts.pre` and `opts.post`. If no match, return null
fuzzy.match = function(pattern, string, opts) {
  opts = opts || {};
  var patternIdx = 0
    , result = []
    , len = string.length
    , totalScore = 0
    , currScore = 0
    // prefix
    , pre = opts.pre || ''
    // suffix
    , post = opts.post || ''
    // String to compare against. This might be a lowercase version of the
    // raw string
    , compareString =  opts.caseSensitive && string || string.toLowerCase()
    , ch, compareChar;

  pattern = opts.caseSensitive && pattern || pattern.toLowerCase();

  // For each character in the string, either add it to the result
  // or wrap in template if its the next string in the pattern
  for(var idx = 0; idx < len; idx++) {
    ch = string[idx];
    if(compareString[idx] === pattern[patternIdx]) {
      ch = pre + ch + post;
      patternIdx += 1;

      // consecutive characters should increase the score more than linearly
      currScore += 1 + currScore;
    } else {
      currScore = 0;
    }
    totalScore += currScore;
    result[result.length] = ch;
  }

  // return rendered string if we have a match for every char
  if(patternIdx === pattern.length) {
    return {rendered: result.join(''), score: totalScore};
  }

  return null;
};

// The normal entry point. Filters `arr` for matches against `pattern`.
// It returns an array with matching values of the type:
//
//     [{
//         string:   '<b>lah' // The rendered string
//       , index:    2        // The index of the element in `arr`
//       , original: 'blah'   // The original element in `arr`
//     }]
//
// `opts` is an optional argument bag. Details:
//
//    opts = {
//        // string to put before a matching character
//        pre:     '<b>'
//
//        // string to put after matching character
//      , post:    '</b>'
//
//        // Optional function. Input is an element from the passed in
//        // `arr`, output should be the string to test `pattern` against.
//        // In this example, if `arr = [{crying: 'koala'}]` we would return
//        // 'koala'.
//      , extract: function(arg) { return arg.crying; }
//    }
fuzzy.filter = function(pattern, arr, opts) {
  opts = opts || {};
  return arr
          .reduce(function(prev, element, idx, arr) {
            var str = element;
            if(opts.extract) {
              str = opts.extract(element);
            }
            var rendered = fuzzy.match(pattern, str, opts);
            if(rendered != null) {
              prev[prev.length] = {
                  string: rendered.rendered
                , score: rendered.score
                , index: idx
                , original: element
              };
            }
            return prev;
          }, [])

          // Sort by score. Browsers are inconsistent wrt stable/unstable
          // sorting, so force stable by using the index in the case of tie.
          // See http://ofb.net/~sethml/is-sort-stable.html
          .sort(function(a,b) {
            var compare = b.score - a.score;
            if(compare) return compare;
            return a.index - b.index;
          });
};


}());


define("fuzzy", (function (global) {
    return function () {
        var ret, fn;
        return ret || global.fuzzy;
    };
}(this)));

eval("/**\r\n * Bookmarks collection\r\n *\r\n * @todo: Remove all view reference and DOM manipulation\r\n * @todo: Functions retrieving bookmarks from third parties should all go in their own\r\n *        modules middleware/façace patterns\r\n * @todo: Duplication checks should be done on Backbone models filtering functions\r\n * \r\n */\r\n/*global require:true, define:true, chrome:true */\r\n\r\ndefine(\'models/collection-bookmarks\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"instances/settings\",\r\n\t\"models/single-bookmark\",\r\n\t\"fuzzy\",\r\n\t\"modules/utils\",\r\n\t\"localStorage\"\r\n],\r\nfunction( app, $, _, Backbone, settings, Bookmark, fuzzy, utils ) {\r\n\t\"use strict\";\r\n\t\r\n\tvar Bookmarks = Backbone.Collection.extend({\r\n\t\t\r\n\t\tmodel: Bookmark,\r\n\t\tsortOrder: \'score\',\r\n\t\t\r\n\t\tlocalStorage : new Backbone.LocalStorage(\'whatever2\'),\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// Filtering\r\n\r\n\t\tmatchSearch: function( searchCriterias ) {\r\n\r\n\t\t\tvar self     = this,\r\n\t\t\t\tkeyword  = searchCriterias.keywords.get(\'value\'),\r\n\t\t\t\tfilterBy = searchCriterias.category.get(\'filterBy\'),\r\n\t\t\t\tcategory = searchCriterias.category.get(\'value\'),\r\n\t\t\t\tcatFilter = {},\r\n\t\t\t\tfiltered;\r\n\r\n\t\t\tif ( _.isString(filterBy) && _.isString(category) && filterBy.length && category.length ) {\r\n\t\t\t\t// If there\'s category filtering info\r\n\t\t\t\tcatFilter[filterBy] = category;\r\n\t\t\t\tfiltered = self.where( catFilter );\r\n\t\t\t} else if( keyword.length ) {\r\n\t\t\t\t// If we have no category but a keyword, transform collection in array\r\n\t\t\t\tfiltered = self.toArray();\r\n\t\t\t} else {\r\n\t\t\t\t// Else, just return the collection as nothing is being searched\r\n\t\t\t\treturn self;\r\n\t\t\t}\r\n\r\n\t\t\t// If no keyword is provided, return category filtered collection\r\n\t\t\tif ( !keyword.length ) {\r\n\t\t\t\treturn new Bookmarks( filtered );\r\n\t\t\t}\r\n\r\n\t\t\tfiltered = fuzzy.filter( keyword, filtered, {\r\n\t\t\t\t// Setup the searchable string\r\n\t\t\t\textract: function( model ) {\r\n\t\t\t\t\treturn model.get(\'title\') + \" \" + model.get(\'url\');\r\n\t\t\t\t}\r\n\t\t\t});\r\n\r\n\t\t\tfiltered = _.map( filtered, function( result ) {\r\n\t\t\t\treturn result.original.set(\'score\', result.score);\r\n\t\t\t});\r\n\r\n\t\t\treturn new Bookmarks( filtered );\r\n\r\n\t\t},\r\n\r\n\r\n\t\t// ---\r\n\t\t// Tools\r\n\r\n\t\tsaveAll: function() {\r\n\t\t\tthis.invoke( \'save\' );\r\n\t\t},\r\n\t\t\r\n\t\tcomparator: function( m ) {\r\n\t\t\treturn m.get( this.sortOrder ) * -1;\r\n\t\t},\r\n\t\t\r\n\t\t// return all props\r\n\t\tall: function( prop ) {\r\n\t\t\tvar that = this;\r\n\t\t\treturn _.uniq(_.pluck(_.pluck(that.models, \'attributes\'), prop));\r\n\t\t},\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// Twitter import\r\n\t\t\r\n\t\taddTwitter: function( handle, cb ) {\r\n\t\t\t// @TODO: there\'s a maximum of 100 entries...\r\n\t\t\tvar that = this;\r\n\t\t\t\r\n\t\t\tsettings.set( \'twitter_user\', handle );\r\n\t\t\t\r\n\t\t\tvar delicious_url = \'https://api.twitter.com/1/statuses/user_timeline.json?include_entities=true&include_rts=true&screen_name=\';\r\n\t\t\tvar del_count = \'&count=200\';\r\n\t\t\tvar url = delicious_url + handle + del_count;\r\n\t\t\t\r\n\t\t\t$.getJSON( url, function( data ) {\r\n\t\t\t\r\n\t\t\t\t_.each( data, function( d ) {\r\n\t\t\t\t\t//check if tweet has url\r\n\t\t\t\t\tif ( d.entities.urls.length > 0 ) {\r\n\t\t\t\t\t\tvar dateAdded = new Date( d.created_at ).getTime();\r\n\t\t\t\t\t\tvar expanded_url = _.pluck( d.entities.urls, \'expanded_url\' );\r\n\t\t\t\t\t\t\r\n\t\t\t\t\t\t_.each( expanded_url, function( url ) {\r\n\t\t\t\t\t\t\t// Make sure the URL is NOT already indexed... to avoid duplicates...\r\n\t\t\t\t\t\t\tif ( that.where({ url: url }).length === 0 ) {\r\n\t\t\t\t\t\t\t\t// @TODO: parse and keywordize...\r\n\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\t//the tweet text..\r\n\t\t\t\t\t\t\t\tvar keywords = d.text;\r\n\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\tkeywords = keywords + \',twitter\';\r\n\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\t//add to collection\r\n\t\t\t\t\t\t\t\tthat.add({\r\n\t\t\t\t\t\t\t\t\ttitle     : d.d,\r\n\t\t\t\t\t\t\t\t\turl       :url,\r\n\t\t\t\t\t\t\t\t\ttype      :\'twitter\',\r\n\t\t\t\t\t\t\t\t\tdateAdded : dateAdded,\r\n\t\t\t\t\t\t\t\t\tkeywords  : keywords\r\n\t\t\t\t\t\t\t\t});\r\n\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\tconsole.log(\'imported from twitter: \'+url);\r\n\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t} else {\r\n\t\t\t\t\t\t\t\tconsole.log( \'not importing duplicate:\', d.u );\r\n\t\t\t\t\t\t\t}\r\n\t\t\t\t\t\t\r\n\t\t\t\t\t\t});\r\n\t\t\t\t\t}\r\n\t\t\t\t});\r\n\t\t\t\t\r\n\t\t\t\tcb();\r\n\t\t\t});\r\n\t\t},\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// Faceboook\r\n\t\t\r\n\t\tupdateFacebookLinks: function() {\r\n\t\t\tif ( !localStorage.accessToken ) {\r\n\t\t\t\treturn false;\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\t// We have a token, but no FB sites.\r\n\t\t\t\r\n\t\t\t// [\"facebook\", \"chrome\", \"facebook_like\", \"facebook_friend\"]\r\n\t\t\tvar types = this.all(\'type\');\r\n\t\t\t\r\n\t\t\tvar fbCount = this.where({ type: \'facebook\' }).length;\r\n\t\t\t\r\n\t\t\tif ( fbCount === 0 ) {\r\n\t\t\t\tthis.addFacebook( 5000, function() {\r\n\t\t\t\t\tconsole.log(\'FB fetching done!\');\r\n\t\t\t\t});\r\n\t\t\t} else {\r\n\t\t\t  this.updateFacebook();\r\n\t\t\t}\r\n\t\t\t\r\n\t\t\treturn true;   \r\n\t\t},\r\n\t\t\r\n\t\tupdateFacebook: function() {\r\n\t\t\t// @TODO: function that re-fetch the facebook, and all the newest content\r\n\t\t},\r\n\t\t\r\n\t\taddFacebook: function( feed_count, callback ) {\r\n\t\t  if(!callback)callback = function(){};\r\n\t\t  if(!localStorage.accessToken) return false;\r\n\t\t   var me = \"https://graph.facebook.com/me?\" + localStorage.accessToken;\r\n\t\t\tvar feed = \"https://graph.facebook.com/me/feed?limit=\"+(feed_count || 500)+\"&\" + localStorage.accessToken;\r\n\t\t\t var likes = \"https://graph.facebook.com/me/likes?fields=website,name,category,description,username&\" + localStorage.accessToken;\r\n\t\t\t var fql = \"select uid, name, website from user where uid IN (select uid2 from friend where uid1=me())\";\r\n\t\t\t var websites = \"https://graph.facebook.com/fql?q=\"+fql + \'&\'+localStorage.accessToken;\r\n\t\t\t //q=SELECT+uid2+FROM+friend+WHERE+uid1=me()&access_token=...\r\n\t\t\t //https://graph.facebook.com/fql?q=select%20uid,%20name,%20work_history,%20work,%20education_history,%20current_location%20from%20user%20where%20uid%20IN%20(select%20uid2%20from%20friend%20where%20uid1=me)access_token=AAAEfVi4krooBAOJfqvQQqkQSc8ZAHkpZCOAC6uvDXLYnZBHUEZCK7qx8H7bfuXRbh7SvTJVHOVD6F1r2HvMUdatbvcT0hIhy9Iy9PZAAZC9QZDZD     \r\n\t   //?q=select%20uid,%20name,%20work_history,%20work,%20education_history,%20current_location%20from%20user%20where%20uid%20IN%20(select%20uid2%20from%20friend%20where%20uid1=me)access_token=AAAEfVi4krooBAOJfqvQQqkQSc8ZAHkpZCOAC6uvDXLYnZBHUEZCK7qx8H7bfuXRbh7SvTJVHOVD6F1r2HvMUdatbvcT0hIhy9Iy9PZAAZC9QZDZD&expires_in=5983      \r\n\t\t\tvar that = this;\r\n\t\t\tconsole.log(feed);\r\n\t\t\t\r\n\t\t\t\r\n\t\t\t\r\n\t\t\t\r\n\t\t\t\r\n\t\t\t\r\n\t\t\tasync.parallel([\r\n\t\t\t\tfunction(cb){\r\n\t\t\t\t\t $.getJSON(feed, function(data) {\r\n\t\t\t\t\t\tconsole.log(\'feed\', data);\r\n\t\t\t\t\t\t// var data = data.data;\r\n\t\t\t\t\t\tvar links = [];\r\n\t\t\t\t\t\t_.each(data.data, function(i){\r\n\t\t\t\t\t\t  //TODO: find a better FQL query to only get the LINK status, no noise.\r\n\t\t\t\t\t\t  var isGarbage= false;//flag\r\n\t\t\t\t\t\t  if((i.link) && (i.type!=\'photo\') && (i.type==\'link\') ){ // the status has to be a link!!!\r\n\t\t\t\t\t\t\tif(i.application){\r\n\t\t\t\t\t\t\t  if(i.application.name == \'Pages\') isGarbage = true;\r\n\t\t\t\t\t\t\t}\r\n\t\t\t\t\t\t\tif(! isGarbage){\r\n\t\t\t\t\t\t\t  links.push( i.link);\r\n\t\t\t\t\t\t\t  var title = i.name || i.link;\r\n\t\t\t\t\t\t\t  var keywords = i.name + \',\'+i.link;\r\n\t\t\t\t\t\t\t  var dateAdded =  new Date(i.created_time).getTime() || 0;\r\n\t\t\t\t\t\t\t  var m = that.add({title: title, url: i.link, id:i.link, type:\'facebook\', dateAdded: dateAdded, keywords: keywords });\r\n\t\t\t\t\t\t\t}\r\n\t  \r\n\t\t\t\t\t\t  }\r\n\t\t\t\t\t\t});\r\n\t\t\t\t\t\tconsole.log(links.length + \' sites added from FEED\',links);\r\n\t\t\t\t\t\tcb();\r\n\t\t\t\t\t\t//return links\r\n\t\t\t\t\t  });\r\n\t\t\t\t\t\r\n\t\t\t\t},\r\n\t\t\t\tfunction(cb){\r\n\t\t\t\t\tconsole.log(likes);\r\n\t\t\t\t\t$.getJSON(likes, function(data) {\r\n\t\t\t\t\t  console.log(\'likes\', data);\r\n\t\t\t\t\t  _.each(data.data, function(i){\r\n\t\t\t\t\t\tvar date = new Date(i.created_time).getTime() || 0;\r\n\t\t\t\t\t\tvar url_fb =  \'http://www.facebook.com/\'+i.id;\r\n\t\t\t\t\t\t//var page_url = \'http://www.facebook.com/\'+i.id;\r\n\t\t\t\t\t\t//website,name,category,description,username\r\n\t\t\t\t\t\tif(i.website){\r\n\t\t\t\t\t\t   var page_url = urlize(_.first(i.website.split(\' \'))); //returns the first valid domain...\r\n\t\t\t\t\t\t}else{\r\n\t\t\t\t\t\t   var page_url = undefined;\r\n\t\t\t\t\t\t}\r\n\t\t\t\t\t\t\r\n\t\t\t\t\t\t if(isUrl(page_url)){\r\n\t\t\t\t\t\t   var u = page_url;\r\n\t\t\t\t\t\t }else{\r\n\t\t\t\t\t\t   var u = url_fb;//the facebook page...\r\n\t\t\t\t\t\t }\r\n\t\t\t\t\t\tvar m = that.add({title: i.name, uid:i.id,  id:i.id, url: u, url_fb:url_fb, type:\'facebook_like\', dateAdded: date, keywords: \'like,facebook,\'+i.category, description:i.description });\r\n\t\t\t\t\t  });\r\n\t\t\t\t\t  cb();\r\n\t\t\t\t\t  /*category: \"Non-profit organization\"\r\n\t\t\t\t\t  created_time: \"2012-10-09T21:47:02+0000\"\r\n\t\t\t\t\t  id: \"140669232641739\"\r\n\t\t\t\t\t  name: \"FNC Lab\"*/\r\n\t\t\t\t\t  //return data\r\n\t\t\t\t\t});\r\n\t\t\t\t\t\r\n\t\t\t\t},\r\n\t\t\t\tfunction(cb){\r\n\t\t\t\t\t console.log(websites);\r\n\t\t\t\t\t  $.getJSON(websites, function(data) {\r\n\t\t\t\t\t   // console.log(\'WEBSITE data.data:\',data.data);\r\n\t\t\t\t\t\t_.each(data.data, function(i){\r\n\t\t\t\t\t\t // dateAdded = \r\n\t\t\t\t\t\t var friend_url = \'http://www.facebook.com/\'+i.uid;\r\n\t\t\t\t\t\t// console.log(friend_url);\r\n\t\t\t\t\t\t var m2 = that.add({title: i.name, uid:i.uid, id:i.uid,  url: friend_url , type:\'facebook_friend\', dateAdded: 0, keywords: \'friend,facebook\'+i.name });\r\n\t  \r\n\t\t\t\t\t\t  if((i.website != \'\') && (i.website) && (i.website != null) && (i.website != \'null\')){ //if this friend has a webite...\r\n\t\t\t\t\t\t\tvar sites = i.website.split(/\\r\\n|\\r|\\n/);\r\n\t\t\t\t\t\t\t_.each(sites, function(s){\r\n\t\t\t\t\t\t\t  var u = urlize(s);\r\n\t\t\t\t\t\t\t  if(isUrl(u)){\r\n\t\t\t\t\t\t\t   // console.log(i.name+\' : \'+u)\r\n\t\t\t\t\t\t\t\tvar keywords =\'facebook, friend, friends,\'+i.name;\r\n\t\t\t\t\t\t\t\tvar m = that.add({title: i.name+\"\'s website\", id:u, url: u , type:\'facebook\', dateAdded: 0, keywords: keywords });\r\n\t\t\t\t\t\t\t  }\r\n\t\t\t\t\t\t\t});\r\n\t\t\t\t\t\t\t//links.push( i.link);\r\n\t\t\t\t\t\t  }\r\n\t  \r\n\t\t\t\t\t\t});\r\n\t\t\t\t\t\tcb();\r\n\t\t\t\t\t\t//console.log(\'websites\', data);\r\n\t\t\t\t\t\t//return data\r\n\t\t\t\t\t  });\r\n\t\t\t\t\t\r\n\t\t\t\t},\r\n\t\t\t\tfunction(cb){\r\n\t\t\t\t\t  $.getJSON(me, function(data) {\r\n\t\t\t\t\t\tconsole.log(\'me\', data);\r\n\t\t\t\t\t\tsettings.set(\'fb_user\', data);\r\n\t\t\t\t\t\tcb();\r\n\t\t\t\t\t  });\r\n\t\t\t\t},\r\n\t\t\t],\r\n\t\t\t// optional callback\r\n\t\t\tfunction(err, results){ //DONE!\r\n\t\t\t  console.log(\'DONE FETCHING FB DATA\');\r\n\t\t\t\tsettings.set(\'hasFb\', true);\r\n\t\t\t\tcallback();//call the big Callback!\r\n\t\t\t});\r\n\t\t\t\r\n\t\t\t\r\n\t\t}\r\n\r\n\t});\r\n\t\r\n\t\r\n\treturn Bookmarks;\r\n\t\r\n});\r\n\n//@ sourceURL=/models/collection-bookmarks.js");

eval("/**\r\n * Nom du module\r\n *\r\n * @info: bla bla\r\n * \r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'instances/all-bookmarks\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"models/collection-bookmarks\"\r\n],\r\nfunction( app, $, _, Backbone, Bookmarks ) {\r\n\t\"use strict\";\r\n\t\r\n\tapp.Models.allBookmarks = new Bookmarks();\r\n\t\r\n\treturn app.Models.allBookmarks;\r\n\r\n});\r\n\n//@ sourceURL=/instances/all-bookmarks.js");

eval("/**\r\n * Search Criteries collection\r\n *\r\n * @info: Collection to hold all search criterias added.\r\n * \r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'models/searchCriterias\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\"\r\n],\r\nfunction( app, $, _, Backbone ) {\r\n\t\"use strict\";\r\n\t\r\n\t\r\n\t// ---\r\n\t// Single Criteria\r\n\t\r\n\tvar Criteria = Backbone.Model.extend({\r\n\t\t\r\n\t\tdefaults: {\r\n\t\t\ttype     : \"\",\r\n\t\t\tfilterBy : \"\",\r\n\t\t\tvalue    : \"\"\r\n\t\t},\r\n\r\n\t\tclear: function() {\r\n\t\t\tthis.set({\r\n\t\t\t\tfilterBy : \'\',\r\n\t\t\t\tvalue    : \'\'\r\n\t\t\t});\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t// ---\r\n\t// Search Criterias\r\n\t\r\n\tapp.Models.searchCriterias = {\r\n\t\t\r\n\t\tkeywords : new Criteria({ type: \"keyword\" }),\r\n\t\tcategory : new Criteria({ type: \"category\" }),\r\n\r\n\t\tclear: function() {\r\n\t\t\tthis.keywords.clear();\r\n\t\t\tthis.category.clear();\r\n\t\t}\r\n\t};\r\n\t\r\n\t\r\n\treturn app.Models.searchCriterias;\r\n\r\n});\r\n\n//@ sourceURL=/models/searchCriterias.js");

/*
 * Lazy Load - jQuery plugin for lazy loading images
 *
 * Copyright (c) 2007-2013 Mika Tuupola
 *
 * Licensed under the MIT license:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Project home:
 *   http://www.appelsiini.net/projects/lazyload
 *
 * Version:  1.8.4
 *
 */
(function($, window, document, undefined) {
    var $window = $(window);

    $.fn.lazyload = function(options) {
        var elements = this;
        var $container;
        var settings = {
            threshold       : 0,
            failure_limit   : 0,
            event           : "scroll",
            effect          : "show",
            container       : window,
            data_attribute  : "original",
            skip_invisible  : true,
            appear          : null,
            load            : null
        };

        function update() {
            var counter = 0;
      
            elements.each(function() {
                var $this = $(this);
                if (settings.skip_invisible && !$this.is(":visible")) {
                    return;
                }
                if ($.abovethetop(this, settings) ||
                    $.leftofbegin(this, settings)) {
                        /* Nothing. */
                } else if (!$.belowthefold(this, settings) &&
                    !$.rightoffold(this, settings)) {
                        $this.trigger("appear");
                        /* if we found an image we'll load, reset the counter */
                        counter = 0;
                } else {
                    if (++counter > settings.failure_limit) {
                        return false;
                    }
                }
            });

        }

        if(options) {
            /* Maintain BC for a couple of versions. */
            if (undefined !== options.failurelimit) {
                options.failure_limit = options.failurelimit; 
                delete options.failurelimit;
            }
            if (undefined !== options.effectspeed) {
                options.effect_speed = options.effectspeed; 
                delete options.effectspeed;
            }

            $.extend(settings, options);
        }

        /* Cache container as jQuery as object. */
        $container = (settings.container === undefined ||
                      settings.container === window) ? $window : $(settings.container);

        /* Fire one scroll event per scroll. Not one scroll event per image. */
        if (0 === settings.event.indexOf("scroll")) {
            $container.bind(settings.event, function(event) {
                return update();
            });
        }

        this.each(function() {
            var self = this;
            var $self = $(self);

            self.loaded = false;

            /* When appear is triggered load original image. */
            $self.one("appear", function() {
                if (!this.loaded) {
                    if (settings.appear) {
                        var elements_left = elements.length;
                        settings.appear.call(self, elements_left, settings);
                    }
                    $("<img />")
                        .bind("load", function() {
                            $self
                                .hide()
                                .attr("src", $self.data(settings.data_attribute))
                                [settings.effect](settings.effect_speed);
                            self.loaded = true;

                            /* Remove image from array so it is not looped next time. */
                            var temp = $.grep(elements, function(element) {
                                return !element.loaded;
                            });
                            elements = $(temp);

                            if (settings.load) {
                                var elements_left = elements.length;
                                settings.load.call(self, elements_left, settings);
                            }
                        })
                        .attr("src", $self.data(settings.data_attribute));
                }
            });

            /* When wanted event is triggered load original image */
            /* by triggering appear.                              */
            if (0 !== settings.event.indexOf("scroll")) {
                $self.bind(settings.event, function(event) {
                    if (!self.loaded) {
                        $self.trigger("appear");
                    }
                });
            }
        });

        /* Check if something appears when window is resized. */
        $window.bind("resize", function(event) {
            update();
        });
              
        /* With IOS5 force loading images when navigating with back button. */
        /* Non optimal workaround. */
        if ((/iphone|ipod|ipad.*os 5/gi).test(navigator.appVersion)) {
            $window.bind("pageshow", function(event) {
                if (event.originalEvent.persisted) {
                    elements.each(function() {
                        $(this).trigger("appear");
                    });
                }
            });
        }

        /* Force initial check if images should appear. */
        $(window).load(function() {
            update();
        });
        
        return this;
    };

    /* Convenience methods in jQuery namespace.           */
    /* Use as  $.belowthefold(element, {threshold : 100, container : window}) */

    $.belowthefold = function(element, settings) {
        var fold;
        
        if (settings.container === undefined || settings.container === window) {
            fold = $window.height() + $window.scrollTop();
        } else {
            fold = $(settings.container).offset().top + $(settings.container).height();
        }

        return fold <= $(element).offset().top - settings.threshold;
    };
    
    $.rightoffold = function(element, settings) {
        var fold;

        if (settings.container === undefined || settings.container === window) {
            fold = $window.width() + $window.scrollLeft();
        } else {
            fold = $(settings.container).offset().left + $(settings.container).width();
        }

        return fold <= $(element).offset().left - settings.threshold;
    };
        
    $.abovethetop = function(element, settings) {
        var fold;
        
        if (settings.container === undefined || settings.container === window) {
            fold = $window.scrollTop();
        } else {
            fold = $(settings.container).offset().top;
        }

        return fold >= $(element).offset().top + settings.threshold  + $(element).height();
    };
    
    $.leftofbegin = function(element, settings) {
        var fold;
        
        if (settings.container === undefined || settings.container === window) {
            fold = $window.scrollLeft();
        } else {
            fold = $(settings.container).offset().left;
        }

        return fold >= $(element).offset().left + settings.threshold + $(element).width();
    };

    $.inviewport = function(element, settings) {
         return !$.rightoffold(element, settings) && !$.leftofbegin(element, settings) &&
                !$.belowthefold(element, settings) && !$.abovethetop(element, settings);
     };

    /* Custom selectors for your convenience.   */
    /* Use as $("img:below-the-fold").something() or */
    /* $("img").filter(":below-the-fold").something() which is faster */

    $.extend($.expr[':'], {
        "below-the-fold" : function(a) { return $.belowthefold(a, {threshold : 0}); },
        "above-the-top"  : function(a) { return !$.belowthefold(a, {threshold : 0}); },
        "right-of-screen": function(a) { return $.rightoffold(a, {threshold : 0}); },
        "left-of-screen" : function(a) { return !$.rightoffold(a, {threshold : 0}); },
        "in-viewport"    : function(a) { return $.inviewport(a, {threshold : 0}); },
        /* Maintain BC for couple of versions. */
        "above-the-fold" : function(a) { return !$.belowthefold(a, {threshold : 0}); },
        "right-of-fold"  : function(a) { return $.rightoffold(a, {threshold : 0}); },
        "left-of-fold"   : function(a) { return !$.rightoffold(a, {threshold : 0}); }
    });

})(jQuery, window, document);

define("lazyload", function(){});

eval("/**\r\n * All Bookmarks view\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'views/all-bookmarks\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"instances/all-bookmarks\",\r\n\t\"instances/settings\",\r\n\t\"views/single-bookmark\",\r\n\t\"models/searchCriterias\",\r\n\t\"lazyload\"\r\n],\r\nfunction( app, $, _, Backbone, allBookmarks, settings, BookmarkView, searchCriterias ) {\r\n\t\"use strict\";\r\n\t\r\n\tvar BookmarksView = Backbone.Layout.extend({\r\n\t\t\r\n\t\tid : \"bookmarks\",\r\n\t\ttagName : \"ul\",\r\n\r\n\t\tinitialize: function() {\r\n\t\t\tthis.collection = allBookmarks;\r\n\r\n\t\t\t// Listen for change on visual settings\r\n\t\t\tsettings.on(\'change:zoomVal\', this.setSize, this);\r\n\t\t\tsettings.on(\'change:viewmode\', this.setViewmode, this);\r\n\t\t\t\r\n\t\t\t// Listen for search\r\n\t\t\tsearchCriterias.keywords.on(\'change:value\', _.debounce(this.filter, 300), this);\r\n\t\t\tsearchCriterias.category.on(\'change\', this.filter, this);\r\n\t\t},\r\n\t\t\r\n\t\tbeforeRender: function() {\r\n\t\t\tthis.collection.each(function( model ) {\r\n\t\t\t\tthis.insertView( new BookmarkView({ model: model }) );\r\n\t\t\t}, this);\r\n\t\t},\r\n\t\t\r\n\t\tafterRender: function() {\r\n\t\t\t\r\n\t\t\t// Execute plugins\r\n\t\t\t// @todo: would look better with fadeIn effect. But images first need to have a set size\r\n\t\t\tthis.$el.find(\'img\').lazyload({\r\n\t\t\t\tthreshold: 500\r\n\t\t\t});\r\n\t\t\t\r\n\t\t\tthis.setSize();\r\n\t\t\tthis.setViewmode();\r\n\t\t\t$(window).trigger(\'scroll\');\r\n\t\t},\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// Search function\r\n\t\t\r\n\t\tfilter: function() {\r\n\t\t\tthis.collection = allBookmarks.matchSearch( searchCriterias );\r\n\t\t\tthis.render();\r\n\t\t},\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// Display helper functions\r\n\t\t\r\n\t\tsetSize: function() {\r\n\t\t\t// @todo: delete reference to body and keep zoom level local to the module\r\n\t\t\tvar zoomVal = settings.get(\'zoomVal\');\r\n\t\t\tvar grid_w = Math.floor( this.$el.innerWidth() / zoomVal );\r\n\t\t\tvar css = \'\';\r\n\t\t\t\r\n\t\t\tcss += \'.grid #bookmarks >li{height:\' + grid_w + \'px;}\';\r\n\t\t\t$(\'#write_custom_css\').html( css );\r\n\t\t\t\r\n\t\t\tvar className = \'zoom\' + zoomVal;\r\n\t\t\t$(\'body\').removeClass(\'zoom1 zoom2 zoom3 zoom4 zoom5 zoom6 zoom7 zoom8 zoom9 zoom10 zoom11 zoom12\');\r\n\t\t\t$(\'body\').addClass( className );\r\n\t\t},\r\n\t\t\r\n\t\tsetViewmode: function() {\r\n\t\t\t// @todo: delete reference to body and keep zoom level local to the module\r\n\t\t\tif( settings.get(\'viewmode\') === \'list\' ) {\r\n\t\t\t\t$(\'body\').removeClass(\'grid\').addClass(\'list\');\r\n\t\t\t} else {\r\n\t\t\t\t$(\'body\').removeClass(\'list\').addClass(\'grid\');\r\n\t\t\t}\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\treturn BookmarksView;\r\n\r\n});\r\n\n//@ sourceURL=/views/all-bookmarks.js");

eval("/**\r\n * Options page view\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'views/options-page\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"instances/settings\",\r\n\t\"instances/all-bookmarks\"\r\n],\r\nfunction( app, $, _, Backbone, settings, bookmarksCollection ) {\r\n\t\"use strict\";\r\n\t\r\n\tvar OptionsPage = Backbone.View.extend({\r\n\t\t\r\n\t\tid : \"options\",\r\n\t\ttagName  : \"section\",\r\n\t\ttemplate : \"options-page\",\r\n\t\t\r\n\t\tevents: {\r\n\t\t\t\'click .delicious .js-add\'    : \'add_delicious\',\r\n\t\t\t\'click .delicious .js-remove\' : \'remove_delicious\',\r\n\t\t\t\'click .remove_all\' : \'remove_all\'\r\n\t\t},\r\n\t\t\r\n\t\tserialize: function() {\r\n\t\t\treturn {\r\n\t\t\t\ttotal           : bookmarksCollection.length,\r\n\t\t\t\tchromeCount     : bookmarksCollection.where({ type: \"chrome\" }).length,\r\n\t\t\t\tdelicious_user  : settings.get(\'delicious_user\'),\r\n\t\t\t\tdeliciousCount  : bookmarksCollection.where({ type: \"delicious\" }).length,\r\n\t\t\t\tfacebookAuthUrl : this.getFacebookLoginUrl()\r\n\t\t\t};\r\n\t\t},\r\n\r\n\t\tinitialize: function() {\r\n\t\t\tthis.listenTo( settings, \'change\', this.render );\r\n\t\t},\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// UI relation\r\n\t\t\r\n\t\tadd_delicious: function() {\r\n\t\t\tvar handle = $(\'#options .delicious .input\').val();\r\n\t\t\t\r\n\t\t\tif ( handle === \'\' ) {\r\n\t\t\t\treturn;\r\n\t\t\t}\r\n\r\n\t\t\tsettings.set( \'delicious_user\', handle );\r\n\t\t\t\r\n\t\t},\r\n\t\t\r\n\t\tremove_delicious: function() {\r\n\r\n\t\t\tsettings.set(\'delicious_user\', undefined);\r\n\r\n\t\t\t_.invoke( bookmarksCollection.where({ type: \"delicious\" }), \'destroy\' );\r\n\t\t\t\r\n\t\t\tthis.$(\'.delicious .input\').val(\'\');\r\n\t\t\t\r\n\t\t},\r\n\t\t\r\n\t\tremove_all: function() {\r\n\t\t\twindow.localStorage.clear();\r\n\t\t\tbookmarksCollection.reset();\r\n\t\t},\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// Helpers\r\n\t\t\r\n\t\tgetFacebookLoginUrl: function() {\r\n\t\t\tvar appId = 315929978515082,\r\n\t\t\t\t\r\n\t\t\t\t// Set anything return URL for now\r\n\t\t\t\t// @todo: get real URL or something\r\n\t\t\t\tretUrl = \'http://www.facebook.com/connect/login_success.html\',\r\n\t\t\t\turl = \"https://www.facebook.com/dialog/oauth\",\r\n\t\t\t\tpermissions = [\r\n\t\t\t\t\t\"read_stream\",\r\n\t\t\t\t\t\"user_likes\",\r\n\t\t\t\t\t\"friends_website\"\r\n\t\t\t\t],\r\n\t\t\t\tparams = {\r\n\t\t\t\t\tclient_id     : appId,\r\n\t\t\t\t\tresponse_type : \"token\",\r\n\t\t\t\t\tscope         : permissions.join(\",\"),\r\n\t\t\t\t\tredirect_uri  : retUrl\r\n\t\t\t\t};\r\n\t\t\t\r\n\t\t\treturn url + \"?\" + $.param( params );\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t// Required, return the module for AMD compliance\r\n\treturn OptionsPage;\r\n\r\n});\r\n\n//@ sourceURL=/views/options-page.js");

eval("/**\r\n * Footer view\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'views/footer\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"instances/settings\"\r\n],\r\nfunction( app, $, _, Backbone, settings ) {\r\n\t\"use strict\";\r\n\t\r\n\t// ---\r\n\t// Footer modules\r\n\t\r\n\tvar ZoomLevel = Backbone.View.extend({\r\n\t\t\r\n\t\ttagName: \"li\",\r\n\t\ttemplate: \"footer-zoomLevel\",\r\n\t\tmodel: settings,\r\n\t\t\r\n\t\tevents: {\r\n\t\t\t\'change #zoom_level\': \"changeZoom\"\r\n\t\t},\r\n\t\t\r\n\t\tafterRender: function() {\r\n\t\t\tthis.model.on(\'change:viewmode\', this.update, this);\r\n\t\t\tthis.update( this.model, this.model.get(\'viewmode\') );\r\n\t\t},\r\n\t\t\r\n\t\tupdate: function( model, val ) {\r\n\t\t\tvar method = (val === \'grid\') ? \'show\': \'hide\';\r\n\t\t\t\r\n\t\t\tthis.$el[method]();\r\n\t\t},\r\n\t\t\r\n\t\tchangeZoom: function() {\r\n\t\t\tvar val = this.$el.find(\'#zoom_level\').val(); //vary from 0-100\r\n\t\t\tvar min_cols = 2;\r\n\t\t\tvar max_cols = 10;\r\n\t\t\tvar slots =  (max_cols - min_cols); //100 / 8 cols =\r\n\t\t\tvar slotW = 100 / slots;\r\n\t\t\tvar zoom = (slots-Math.round(val / slotW)) +min_cols;\r\n\t\t\t\r\n\t\t\tif ( zoom !== this.model.get(\'zoomVal\') ) {\r\n\t\t\t\tthis.model.set( \'zoomVal\', zoom );\r\n\t\t\t}\r\n\t\t\t\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\tvar ViewMode = Backbone.View.extend({\r\n\t\t\r\n\t\ttagName: \"li\",\r\n\t\ttemplate: \"footer-viewMode\",\r\n\t\tmodel: settings,\r\n\t\t\r\n\t\tevents: {\r\n\t\t\t\'click .js-changemode\' : \'viewmode\'\r\n\t\t},\r\n\t\t\r\n\t\tafterRender: function() {\r\n\t\t\tthis.model.on(\'change:viewmode\', this.update, this);\r\n\t\t\tthis.update( this.model, this.model.get(\'viewmode\') );\r\n\t\t},\r\n\t\t\r\n\t\tupdate: function( model, val ) {\r\n\t\t\tvar $btn = this.$el.find(\'.js-changemode\');\r\n\t\t\t\r\n\t\t\t$btn\r\n\t\t\t\t.removeClass(\'active\')\r\n\t\t\t\t.filter(\'[data-mode=\' + val + \']\')\r\n\t\t\t\t.addClass(\'active\');\r\n\t\t},\r\n\t\t\r\n\t\tviewmode: function( e ) {\r\n\t\t\tvar $el  = $(e.currentTarget),\r\n\t\t\t\tmode = $el.attr(\'data-mode\');\r\n\t\t\t\r\n\t\t\tthis.model.set(\'viewmode\', mode);\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\tvar ModulesSection = Backbone.View.extend({\r\n\t\t\r\n\t\ttagName: \"ul\",\r\n\t\tclassName: \"nav pull-right\",\r\n\t\t\r\n\t\tbeforeRender: function() {\r\n\t\t\tthis.insertView(new ZoomLevel());\r\n\t\t\tthis.insertView(new ViewMode());\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t\r\n\t// ---\r\n\t// Main Footer section\r\n\t\r\n\tvar MainFooter = Backbone.View.extend({\r\n\t\t\r\n\t\ttemplate: \"footer\",\r\n\t\t\r\n\t\tbeforeRender: function() {\r\n\t\t\t\r\n\t\t\t// @todo: add all modules\r\n\t\t\t\r\n\t\t\tthis.insertViews({\r\n\t\t\t\t\".navbar-inner\": new ModulesSection()\r\n\t\t\t});\r\n\t\t\t\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t\r\n\t// Required, return the module for AMD compliance\r\n\treturn MainFooter;\r\n\r\n});\r\n\n//@ sourceURL=/views/footer.js");

eval("/**\r\n * Folder filtering view\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'views/folders\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"instances/all-bookmarks\",\r\n\t\"models/searchCriterias\"\r\n],\r\nfunction( app, $, _, Backbone, bookmarks, searchCriterias ) {\r\n\t\"use strict\";\r\n\r\n\r\n\t// ---\r\n\t// Folders list\r\n\r\n\tvar FolderItem = Backbone.View.extend({\r\n\r\n\t\ttemplate: \"folder-item\",\r\n\r\n\t\tserialize: function() {\r\n\t\t\treturn this.model;\r\n\t\t},\r\n\r\n\t\tafterRender: function() {\r\n\t\t\t\r\n\t\t\t// Make full template\r\n\t\t\tvar oldEl = this.$el,\r\n\t\t\t\tnewEl = this.$(\'li\');\r\n\r\n\t\t\tthis.setElement( newEl );\r\n\t\t\toldEl.replaceWith( newEl );\r\n\t\t}\r\n\r\n\t});\r\n\r\n\tvar FoldersList = Backbone.View.extend({\r\n\r\n\t\ttagName   : \"ul\",\r\n\t\tclassName : \"folders\",\r\n\r\n\t\tbeforeRender: function() {\r\n\t\t\tvar folders = _.uniq( bookmarks.pluck(\'folder\'), false, function( array ) {\r\n\t\t\t\treturn JSON.stringify( array );\r\n\t\t\t});\r\n\t\t\tfolders = _.first( folders, 15 );\r\n\t\t\tfolders = _.map( folders, function( folder_path ) {\r\n\t\t\t\treturn {name: folder_path.join(\' > \')};\r\n\t\t\t});\r\n\r\n\t\t\t_.each( folders, function( folder ) {\r\n\t\t\t\tthis.insertView( new FolderItem({ model : folder }) );\r\n\t\t\t}, this);\r\n\t\t}\r\n\r\n\t});\r\n\r\n\r\n\t// ---\r\n\t// Domains list\r\n\r\n\tvar DomainItem = Backbone.View.extend({\r\n\r\n\t\ttemplate: \"domain-item\",\r\n\r\n\t\tserialize: function() {\r\n\t\t\treturn this.model;\r\n\t\t},\r\n\r\n\t\tafterRender: function() {\r\n\t\t\t\r\n\t\t\t// Make full template\r\n\t\t\tvar oldEl = this.$el,\r\n\t\t\t\tnewEl = this.$(\'li\');\r\n\r\n\t\t\tthis.setElement( newEl );\r\n\t\t\toldEl.replaceWith( newEl );\r\n\t\t}\r\n\r\n\t});\r\n\r\n\tvar DomainsList = Backbone.View.extend({\r\n\r\n\t\ttagName   : \"ul\",\r\n\t\tclassName : \"domains\",\r\n\r\n\t\tbeforeRender: function() {\r\n\t\t\tvar domains = _.groupBy( bookmarks.pluck(\'domain\'), function( domain ) {\r\n\t\t\t\treturn domain;\r\n\t\t\t});\r\n\t\t\tdomains = _.sortBy( domains, \"length\");\r\n\t\t\tdomains = _.last( domains, 5 ).reverse();\r\n\t\t\tdomains = _.map( domains, function( val ) {\r\n\t\t\t\treturn {\r\n\t\t\t\t\tname: val[0],\r\n\t\t\t\t\tquantity: val.length\r\n\t\t\t\t};\r\n\t\t\t});\r\n\r\n\t\t\t_.each( domains, function( domain ) {\r\n\t\t\t\tthis.insertView( new DomainItem({ model : domain }) );\r\n\t\t\t}, this);\r\n\t\t}\r\n\r\n\t});\r\n\r\n\r\n\t// ---\r\n\t// Sources list\r\n\r\n\tvar SourceItem = Backbone.View.extend({\r\n\r\n\t\ttemplate: \"source-item\",\r\n\r\n\t\tserialize: function() {\r\n\t\t\treturn this.model;\r\n\t\t},\r\n\r\n\t\tafterRender: function() {\r\n\t\t\t\r\n\t\t\t// Make full template\r\n\t\t\tvar oldEl = this.$el,\r\n\t\t\t\tnewEl = this.$(\'li\');\r\n\r\n\t\t\tthis.setElement( newEl );\r\n\t\t\toldEl.replaceWith( newEl );\r\n\t\t}\r\n\r\n\t});\r\n\r\n\tvar SourcesList = Backbone.View.extend({\r\n\r\n\t\ttagName   : \"ul\",\r\n\t\tclassName : \"sources\",\r\n\r\n\t\tnameMap : {\r\n\t\t\tchrome: {\r\n\t\t\t\tlabel: \'Chrome\',\r\n\t\t\t\ticon: \'icon-star\'\r\n\t\t\t},\r\n\t\t\ttwitter: {\r\n\t\t\t\tlabel: \'Twitter\',\r\n\t\t\t\ticon: \'icon-retweet\'\r\n\t\t\t},\r\n\t\t\tdelicious: {\r\n\t\t\t\tlabel: \'Delicious\',\r\n\t\t\t\ticon: \'icon-th-large\'\r\n\t\t\t},\r\n\t\t\tfacebook: {\r\n\t\t\t\tlabel: \'Facebook Posts\',\r\n\t\t\t\ticon: \'icon-comment\'\r\n\t\t\t},\r\n\t\t\tfacebook_like: {\r\n\t\t\t\tlabel: \'Facebook Likes\',\r\n\t\t\t\ticon: \'icon-thumbs-up\'\r\n\t\t\t},\r\n\t\t\tfacebook_friend: {\r\n\t\t\t\tlabel: \'Facebook Friends\',\r\n\t\t\t\ticon: \'icon-user\'\r\n\t\t\t}\r\n\t\t},\r\n\r\n\t\tbeforeRender: function() {\r\n\t\t\tvar self = this;\r\n\t\t\tvar sources = _.groupBy( bookmarks.pluck(\'type\'), function( source ) {\r\n\t\t\t\treturn source;\r\n\t\t\t});\r\n\t\t\t\r\n\t\t\tsources = _.sortBy( sources, \"length\");\r\n\t\t\tsources = _.last( sources, 5 ).reverse();\r\n\t\t\tsources = _.map( sources, function( val ) {\r\n\t\t\t\treturn {\r\n\t\t\t\t\tname: self.nameMap[ val[0] ].label,\r\n\t\t\t\t\ticon: self.nameMap[ val[0] ].icon,\r\n\t\t\t\t\tquantity: val.length\r\n\t\t\t\t};\r\n\t\t\t});\r\n\r\n\t\t\t_.each( sources, function( source ) {\r\n\t\t\t\tthis.insertView( new SourceItem({ model : source }) );\r\n\t\t\t}, this);\r\n\t\t}\r\n\r\n\t});\r\n\t\r\n\t\r\n\t// ---\r\n\t// Main Folder section\r\n\t\r\n\tvar CategoriesDropdown = Backbone.View.extend({\r\n\t\t\r\n\t\ttemplate: \"folder-dropdown\",\r\n\r\n\t\tevents: {\r\n\t\t\t\"click .js-clear-search\": \"clear\"\r\n\t\t},\r\n\t\t\r\n\t\tbeforeRender: function() {\r\n\t\t\t\r\n\t\t\tthis.insertView( \'.dropdown-menu\', new FoldersList() );\r\n\t\t\tthis.insertView( \'.dropdown-menu\', new DomainsList() );\r\n\t\t\tthis.insertView( \'.dropdown-menu\', new SourcesList() );\r\n\t\t\t\r\n\t\t},\r\n\t\t\r\n\t\tafterRender: function() {\r\n\t\t\t\r\n\t\t\t// Make full template\r\n\t\t\tvar oldEl = this.$el,\r\n\t\t\t\tnewEl = this.$(\'.categories_drop\');\r\n\r\n\t\t\tthis.setElement( newEl );\r\n\t\t\toldEl.replaceWith( newEl );\r\n\t\t\t\r\n\t\t},\r\n\r\n\r\n\t\t// ---\r\n\t\t// UI relation\r\n\r\n\t\tclear: function( e ) {\r\n\t\t\te && e.preventDefault();\r\n\t\t\tsearchCriterias.clear();\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t\r\n\t// Required, return the module for AMD compliance\r\n\treturn CategoriesDropdown;\r\n\r\n});\r\n\n//@ sourceURL=/views/folders.js");

/* =========================================================
 * bootstrap-modal.js v2.3.0
 * http://twitter.github.com/bootstrap/javascript.html#modals
 * =========================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================= */


!function ($) {

   // jshint ;_;


 /* MODAL CLASS DEFINITION
  * ====================== */

  var Modal = function (element, options) {
    this.options = options
    this.$element = $(element)
      .delegate('[data-dismiss="modal"]', 'click.dismiss.modal', $.proxy(this.hide, this))
    this.options.remote && this.$element.find('.modal-body').load(this.options.remote)
  }

  Modal.prototype = {

      constructor: Modal

    , toggle: function () {
        return this[!this.isShown ? 'show' : 'hide']()
      }

    , show: function () {
        var that = this
          , e = $.Event('show')

        this.$element.trigger(e)

        if (this.isShown || e.isDefaultPrevented()) return

        this.isShown = true

        this.escape()

        this.backdrop(function () {
          var transition = $.support.transition && that.$element.hasClass('fade')

          if (!that.$element.parent().length) {
            that.$element.appendTo(document.body) //don't move modals dom position
          }

          that.$element.show()

          if (transition) {
            that.$element[0].offsetWidth // force reflow
          }

          that.$element
            .addClass('in')
            .attr('aria-hidden', false)

          that.enforceFocus()

          transition ?
            that.$element.one($.support.transition.end, function () { that.$element.focus().trigger('shown') }) :
            that.$element.focus().trigger('shown')

        })
      }

    , hide: function (e) {
        e && e.preventDefault()

        var that = this

        e = $.Event('hide')

        this.$element.trigger(e)

        if (!this.isShown || e.isDefaultPrevented()) return

        this.isShown = false

        this.escape()

        $(document).off('focusin.modal')

        this.$element
          .removeClass('in')
          .attr('aria-hidden', true)

        $.support.transition && this.$element.hasClass('fade') ?
          this.hideWithTransition() :
          this.hideModal()
      }

    , enforceFocus: function () {
        var that = this
        $(document).on('focusin.modal', function (e) {
          if (that.$element[0] !== e.target && !that.$element.has(e.target).length) {
            that.$element.focus()
          }
        })
      }

    , escape: function () {
        var that = this
        if (this.isShown && this.options.keyboard) {
          this.$element.on('keyup.dismiss.modal', function ( e ) {
            e.which == 27 && that.hide()
          })
        } else if (!this.isShown) {
          this.$element.off('keyup.dismiss.modal')
        }
      }

    , hideWithTransition: function () {
        var that = this
          , timeout = setTimeout(function () {
              that.$element.off($.support.transition.end)
              that.hideModal()
            }, 500)

        this.$element.one($.support.transition.end, function () {
          clearTimeout(timeout)
          that.hideModal()
        })
      }

    , hideModal: function () {
        var that = this
        this.$element.hide()
        this.backdrop(function () {
          that.removeBackdrop()
          that.$element.trigger('hidden')
        })
      }

    , removeBackdrop: function () {
        this.$backdrop.remove()
        this.$backdrop = null
      }

    , backdrop: function (callback) {
        var that = this
          , animate = this.$element.hasClass('fade') ? 'fade' : ''

        if (this.isShown && this.options.backdrop) {
          var doAnimate = $.support.transition && animate

          this.$backdrop = $('<div class="modal-backdrop ' + animate + '" />')
            .appendTo(document.body)

          this.$backdrop.click(
            this.options.backdrop == 'static' ?
              $.proxy(this.$element[0].focus, this.$element[0])
            : $.proxy(this.hide, this)
          )

          if (doAnimate) this.$backdrop[0].offsetWidth // force reflow

          this.$backdrop.addClass('in')

          if (!callback) return

          doAnimate ?
            this.$backdrop.one($.support.transition.end, callback) :
            callback()

        } else if (!this.isShown && this.$backdrop) {
          this.$backdrop.removeClass('in')

          $.support.transition && this.$element.hasClass('fade')?
            this.$backdrop.one($.support.transition.end, callback) :
            callback()

        } else if (callback) {
          callback()
        }
      }
  }


 /* MODAL PLUGIN DEFINITION
  * ======================= */

  var old = $.fn.modal

  $.fn.modal = function (option) {
    return this.each(function () {
      var $this = $(this)
        , data = $this.data('modal')
        , options = $.extend({}, $.fn.modal.defaults, $this.data(), typeof option == 'object' && option)
      if (!data) $this.data('modal', (data = new Modal(this, options)))
      if (typeof option == 'string') data[option]()
      else if (options.show) data.show()
    })
  }

  $.fn.modal.defaults = {
      backdrop: true
    , keyboard: true
    , show: true
  }

  $.fn.modal.Constructor = Modal


 /* MODAL NO CONFLICT
  * ================= */

  $.fn.modal.noConflict = function () {
    $.fn.modal = old
    return this
  }


 /* MODAL DATA-API
  * ============== */

  $(document).on('click.modal.data-api', '[data-toggle="modal"]', function (e) {
    var $this = $(this)
      , href = $this.attr('href')
      , $target = $($this.attr('data-target') || (href && href.replace(/.*(?=#[^\s]+$)/, ''))) //strip for ie7
      , option = $target.data('modal') ? 'toggle' : $.extend({ remote:!/#/.test(href) && href }, $target.data(), $this.data())

    e.preventDefault()

    $target
      .modal(option)
      .one('hide', function () {
        $this.focus()
      })
  })

}(window.jQuery);

define("bootstrapModal", function(){});

eval("/**\r\n * Folder filtering view\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'views/options-menu\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"instances/all-bookmarks\",\r\n\t\"models/searchCriterias\",\r\n\t\"bootstrapModal\"\r\n],\r\nfunction( app, $, _, Backbone, bookmarks, searchCriterias ) {\r\n\t\"use strict\";\r\n\t\r\n\t\r\n\t// ---\r\n\t// Main Folder section\r\n\t\r\n\tvar OptionsMenu = Backbone.View.extend({\r\n\t\t\r\n\t\ttemplate: \"options-menu\",\r\n\r\n\t\tevents: {\r\n\t\t\t\"click .js-clear-search\"       : \"clear\",\r\n\t\t\t\"click  .js-add-delicious\"     : \"addDelicious\",\r\n\t\t\t\"click  .js-remove-deliciouos\" : \"removeDelicious\"\r\n\t\t},\r\n\t\t\r\n\t\tafterRender: function() {\r\n\t\t\t\r\n\t\t\t// Make full template\r\n\t\t\tvar oldEl = this.$el,\r\n\t\t\t\tnewEl = this.$(\'.options\');\r\n\r\n\t\t\tthis.setElement( newEl );\r\n\t\t\toldEl.replaceWith( newEl );\r\n\r\n\t\t\t// Load modal plugins\r\n\t\t\tthis.$(\'.bt_modal\').modal();\r\n\t\t\t\r\n\t\t},\r\n\r\n\t\t// ---\r\n\t\t// UI relation\r\n\r\n\t\tclear: function( e ) {\r\n\t\t\te && e.preventDefault();\r\n\t\t\tsearchCriterias.clear();\r\n\t\t},\r\n\r\n\t\taddDelicious: function( ev ) {\r\n\t\t\tev.preventDefault();\r\n\t\t\t\r\n\t\t\tvar that = this;\r\n\t\t\tvar handle = $(\'#options .delicious .input\').val();\r\n\t\t\t\r\n\t\t\tif ( handle === \'\' ) {\r\n\t\t\t\twindow.alert(\'please enter your delicious username here\');\r\n\t\t\t} else {\r\n\t\t\t\t\r\n\t\t\t\tconsole.log(\'importing delicious user: \' + handle); //ayudantegrafico\r\n\t\t\t\t$(ev[\'currentTarget\']).button(\'loading\');\r\n\t\t\t\t\r\n\t\t\t\tbookmarksCollection.addDelicious(handle, function(){\r\n\t\t\t\t\t$(ev[\'currentTarget\']).button(\'reset\');\r\n\t\t\t\t\t$(\'#options .delicious .input\').val(\'\');\r\n\t\t\t\t});\r\n\t\t\t\t\r\n\t\t\t}\r\n\t\t\t\r\n\t\t},\r\n\t\t\r\n\t\tremoveDelicious: function( ev ) {\r\n\t\t\tev && ev.preventDefault();\r\n\t\t\t\r\n\t\t\tvar that= this;\r\n\t\t\tvar delicious = bookmarksCollection.where({type: \"delicious\"});\r\n\t\t\t\r\n\t\t\tconsole.log( \'rm\', delicious );\r\n\t\t\t\r\n\t\t\t_.each( delicious, function( m ) {\r\n\t\t\t\tconsole.log( \'destroy delicious model1:\', m );\r\n\t\t\t\tm.destroy({ wait: true });\r\n\t\t\t});\r\n\t\t\t\r\n\t\t\tsettings.set(\'delicious_user\', false);\r\n\t\t\t\r\n\t\t\t//refresh the page...\r\n\t\t\t_.delay(function() {\r\n\t\t\t\t$(\'#options .delicious .input\').val(\'\');\r\n\t\t\t}, 200);\r\n\t\t\t\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t\r\n\t// Required, return the module for AMD compliance\r\n\treturn OptionsMenu;\r\n\r\n});\r\n\n//@ sourceURL=/views/options-menu.js");

/* ===========================================================
 * bootstrap-tooltip.js v2.3.0
 * http://twitter.github.com/bootstrap/javascript.html#tooltips
 * Inspired by the original jQuery.tipsy by Jason Frame
 * ===========================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================== */


!function ($) {

   // jshint ;_;


 /* TOOLTIP PUBLIC CLASS DEFINITION
  * =============================== */

  var Tooltip = function (element, options) {
    this.init('tooltip', element, options)
  }

  Tooltip.prototype = {

    constructor: Tooltip

  , init: function (type, element, options) {
      var eventIn
        , eventOut
        , triggers
        , trigger
        , i

      this.type = type
      this.$element = $(element)
      this.options = this.getOptions(options)
      this.enabled = true

      triggers = this.options.trigger.split(' ')

      for (i = triggers.length; i--;) {
        trigger = triggers[i]
        if (trigger == 'click') {
          this.$element.on('click.' + this.type, this.options.selector, $.proxy(this.toggle, this))
        } else if (trigger != 'manual') {
          eventIn = trigger == 'hover' ? 'mouseenter' : 'focus'
          eventOut = trigger == 'hover' ? 'mouseleave' : 'blur'
          this.$element.on(eventIn + '.' + this.type, this.options.selector, $.proxy(this.enter, this))
          this.$element.on(eventOut + '.' + this.type, this.options.selector, $.proxy(this.leave, this))
        }
      }

      this.options.selector ?
        (this._options = $.extend({}, this.options, { trigger: 'manual', selector: '' })) :
        this.fixTitle()
    }

  , getOptions: function (options) {
      options = $.extend({}, $.fn[this.type].defaults, this.$element.data(), options)

      if (options.delay && typeof options.delay == 'number') {
        options.delay = {
          show: options.delay
        , hide: options.delay
        }
      }

      return options
    }

  , enter: function (e) {
      var self = $(e.currentTarget)[this.type](this._options).data(this.type)

      if (!self.options.delay || !self.options.delay.show) return self.show()

      clearTimeout(this.timeout)
      self.hoverState = 'in'
      this.timeout = setTimeout(function() {
        if (self.hoverState == 'in') self.show()
      }, self.options.delay.show)
    }

  , leave: function (e) {
      var self = $(e.currentTarget)[this.type](this._options).data(this.type)

      if (this.timeout) clearTimeout(this.timeout)
      if (!self.options.delay || !self.options.delay.hide) return self.hide()

      self.hoverState = 'out'
      this.timeout = setTimeout(function() {
        if (self.hoverState == 'out') self.hide()
      }, self.options.delay.hide)
    }

  , show: function () {
      var $tip
        , pos
        , actualWidth
        , actualHeight
        , placement
        , tp
        , e = $.Event('show')

      if (this.hasContent() && this.enabled) {
        this.$element.trigger(e)
        if (e.isDefaultPrevented()) return
        $tip = this.tip()
        this.setContent()

        if (this.options.animation) {
          $tip.addClass('fade')
        }

        placement = typeof this.options.placement == 'function' ?
          this.options.placement.call(this, $tip[0], this.$element[0]) :
          this.options.placement

        $tip
          .detach()
          .css({ top: 0, left: 0, display: 'block' })

        this.options.container ? $tip.appendTo(this.options.container) : $tip.insertAfter(this.$element)

        pos = this.getPosition()

        actualWidth = $tip[0].offsetWidth
        actualHeight = $tip[0].offsetHeight

        switch (placement) {
          case 'bottom':
            tp = {top: pos.top + pos.height, left: pos.left + pos.width / 2 - actualWidth / 2}
            break
          case 'top':
            tp = {top: pos.top - actualHeight, left: pos.left + pos.width / 2 - actualWidth / 2}
            break
          case 'left':
            tp = {top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left - actualWidth}
            break
          case 'right':
            tp = {top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left + pos.width}
            break
        }

        this.applyPlacement(tp, placement)
        this.$element.trigger('shown')
      }
    }

  , applyPlacement: function(offset, placement){
      var $tip = this.tip()
        , width = $tip[0].offsetWidth
        , height = $tip[0].offsetHeight
        , actualWidth
        , actualHeight
        , delta
        , replace

      $tip
        .offset(offset)
        .addClass(placement)
        .addClass('in')

      actualWidth = $tip[0].offsetWidth
      actualHeight = $tip[0].offsetHeight

      if (placement == 'top' && actualHeight != height) {
        offset.top = offset.top + height - actualHeight
        replace = true
      }

      if (placement == 'bottom' || placement == 'top') {
        delta = 0

        if (offset.left < 0){
          delta = offset.left * -2
          offset.left = 0
          $tip.offset(offset)
          actualWidth = $tip[0].offsetWidth
          actualHeight = $tip[0].offsetHeight
        }

        this.replaceArrow(delta - width + actualWidth, actualWidth, 'left')
      } else {
        this.replaceArrow(actualHeight - height, actualHeight, 'top')
      }

      if (replace) $tip.offset(offset)
    }

  , replaceArrow: function(delta, dimension, position){
      this
        .arrow()
        .css(position, delta ? (50 * (1 - delta / dimension) + "%") : '')
    }

  , setContent: function () {
      var $tip = this.tip()
        , title = this.getTitle()

      $tip.find('.tooltip-inner')[this.options.html ? 'html' : 'text'](title)
      $tip.removeClass('fade in top bottom left right')
    }

  , hide: function () {
      var that = this
        , $tip = this.tip()
        , e = $.Event('hide')

      this.$element.trigger(e)
      if (e.isDefaultPrevented()) return

      $tip.removeClass('in')

      function removeWithAnimation() {
        var timeout = setTimeout(function () {
          $tip.off($.support.transition.end).detach()
        }, 500)

        $tip.one($.support.transition.end, function () {
          clearTimeout(timeout)
          $tip.detach()
        })
      }

      $.support.transition && this.$tip.hasClass('fade') ?
        removeWithAnimation() :
        $tip.detach()

      this.$element.trigger('hidden')

      return this
    }

  , fixTitle: function () {
      var $e = this.$element
      if ($e.attr('title') || typeof($e.attr('data-original-title')) != 'string') {
        $e.attr('data-original-title', $e.attr('title') || '').attr('title', '')
      }
    }

  , hasContent: function () {
      return this.getTitle()
    }

  , getPosition: function () {
      var el = this.$element[0]
      return $.extend({}, (typeof el.getBoundingClientRect == 'function') ? el.getBoundingClientRect() : {
        width: el.offsetWidth
      , height: el.offsetHeight
      }, this.$element.offset())
    }

  , getTitle: function () {
      var title
        , $e = this.$element
        , o = this.options

      title = $e.attr('data-original-title')
        || (typeof o.title == 'function' ? o.title.call($e[0]) :  o.title)

      return title
    }

  , tip: function () {
      return this.$tip = this.$tip || $(this.options.template)
    }

  , arrow: function(){
      return this.$arrow = this.$arrow || this.tip().find(".tooltip-arrow")
    }

  , validate: function () {
      if (!this.$element[0].parentNode) {
        this.hide()
        this.$element = null
        this.options = null
      }
    }

  , enable: function () {
      this.enabled = true
    }

  , disable: function () {
      this.enabled = false
    }

  , toggleEnabled: function () {
      this.enabled = !this.enabled
    }

  , toggle: function (e) {
      var self = e ? $(e.currentTarget)[this.type](this._options).data(this.type) : this
      self.tip().hasClass('in') ? self.hide() : self.show()
    }

  , destroy: function () {
      this.hide().$element.off('.' + this.type).removeData(this.type)
    }

  }


 /* TOOLTIP PLUGIN DEFINITION
  * ========================= */

  var old = $.fn.tooltip

  $.fn.tooltip = function ( option ) {
    return this.each(function () {
      var $this = $(this)
        , data = $this.data('tooltip')
        , options = typeof option == 'object' && option
      if (!data) $this.data('tooltip', (data = new Tooltip(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.tooltip.Constructor = Tooltip

  $.fn.tooltip.defaults = {
    animation: true
  , placement: 'top'
  , selector: false
  , template: '<div class="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>'
  , trigger: 'hover focus'
  , title: ''
  , delay: 0
  , html: false
  , container: false
  }


 /* TOOLTIP NO CONFLICT
  * =================== */

  $.fn.tooltip.noConflict = function () {
    $.fn.tooltip = old
    return this
  }

}(window.jQuery);

define("bootstrapTooltip", function(){});

eval("/**\r\n * Header view\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'views/header\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"instances/settings\",\r\n\t\"instances/all-bookmarks\",\r\n\t\"models/searchCriterias\",\r\n\t\"views/folders\",\r\n\t\"views/options-menu\",\r\n\t\"bootstrapTooltip\"\r\n],\r\nfunction( app, $, _, Backbone, settings, bookmarks, searchCriterias, FoldersDropdown, OptionsMenu ) {\r\n\t\"use strict\";\r\n\t\r\n\r\n\t// ---\r\n\t// Bookmarks content type\r\n\t\r\n\tvar TypeBtn = Backbone.View.extend({\r\n\r\n\t\ttemplate : \"header-typeBtn\",\r\n\t\tisActive : false,\r\n\r\n\t\tevents: {\r\n\t\t\t\"click a\": \"select\"\r\n\t\t},\r\n\r\n\t\tinitialize: function( opt ) {\r\n\t\t\tthis.type = opt.type;\r\n\t\t\tthis.model = searchCriterias.category;\r\n\r\n\t\t\tthis.model.on( \'change\', this.change, this );\r\n\t\t},\r\n\r\n\t\tserialize: function() {\r\n\t\t\tvar source = {\r\n\t\t\t\tphoto: {\r\n\t\t\t\t\tlabel: \'Photos\',\r\n\t\t\t\t\ticon: \'icon-picture\'\r\n\t\t\t\t},\r\n\t\t\t\tweb: {\r\n\t\t\t\t\tlabel: \'Websites\',\r\n\t\t\t\t\ticon: \'icon-globe\'\r\n\t\t\t\t},\r\n\t\t\t\tvideo: {\r\n\t\t\t\t\tlabel: \'Videos\',\r\n\t\t\t\t\ticon: \'icon-film\'\r\n\t\t\t\t},\r\n\t\t\t\tfacebook_like: {\r\n\t\t\t\t\tlabel: \'Facebook Pages\',\r\n\t\t\t\t\ticon: \'icon-thumbs-up\'\r\n\t\t\t\t},\r\n\t\t\t\tdoc: {\r\n\t\t\t\t\tlabel: \'Documents (pdf)\',\r\n\t\t\t\t\ticon: \'icon-book\'\r\n\t\t\t\t},\r\n\t\t\t\tmusic: {\r\n\t\t\t\t\tlabel: \'Music\',\r\n\t\t\t\t\ticon: \'icon-music\'\r\n\t\t\t\t},\r\n\t\t\t\tfile: {\r\n\t\t\t\t\tlabel: \'Files\',\r\n\t\t\t\t\ticon: \'icon-file\'\r\n\t\t\t\t},\r\n\t\t\t\tblog: {\r\n\t\t\t\t\tlabel: \'Blogs\',\r\n\t\t\t\t\ticon: \'icon-comment\'\r\n\t\t\t\t},\r\n\t\t\t\tperson: {\r\n\t\t\t\t\tlabel: \'Persons\',\r\n\t\t\t\t\ticon: \'icon-user\'\r\n\t\t\t\t},\r\n\t\t\t\tnsfw: {\r\n\t\t\t\t\tlabel: \'NSFW\',\r\n\t\t\t\t\ticon: \'icon-eye-open\'\r\n\t\t\t\t}\r\n\t\t\t};\r\n\r\n\t\t\treturn _.extend(\r\n\t\t\t\tsource[ this.type ],\r\n\t\t\t\t{\r\n\t\t\t\t\tcount: bookmarks.where({ content_type: this.type }).length\r\n\t\t\t\t}\r\n\t\t\t);\r\n\t\t},\r\n\r\n\t\tafterRender: function() {\r\n\t\t\tvar oldEl = this.$el,\r\n\t\t\t\tnewEl = this.$el.children();\r\n\r\n\t\t\tthis.setElement( newEl );\r\n\t\t\toldEl.replaceWith( newEl );\r\n\r\n\t\t\tthis.$(\'.tip\').tooltip();\r\n\t\t},\r\n\r\n\r\n\t\t// ---\r\n\t\t// Model relation\r\n\t\t\r\n\t\tchange: function( model ) {\r\n\t\t\tif ( this.type === model.get(\'value\') && model.get(\'filterBy\') === \'content_type\' ) {\r\n\t\t\t\tthis.isActive = true;\r\n\t\t\t\tthis.$el.addClass(\'active\');\r\n\t\t\t} else {\r\n\t\t\t\tthis.isActive = false;\r\n\t\t\t\tthis.$el.removeClass(\'active\');\r\n\t\t\t}\r\n\t\t},\r\n\r\n\t\t// ---\r\n\t\t// Ui relation\r\n\t\t\r\n\t\tselect: function( e ) {\r\n\t\t\te && e.preventDefault();\r\n\r\n\t\t\tif ( !this.isActive ) {\r\n\t\t\t\tthis.model.set({\r\n\t\t\t\t\t\'filterBy\' : \'content_type\',\r\n\t\t\t\t\t\'value\'    : this.type \r\n\t\t\t\t});\r\n\t\t\t} else {\r\n\t\t\t\tthis.model.clear();\r\n\t\t\t}\r\n\t\t\t\r\n\t\t}\r\n\r\n\t});\r\n\r\n\tvar TypeBar = Backbone.View.extend({\r\n\t\t\r\n\t\ttagName   : \"ul\",\r\n\t\tclassName : \"content_types pull-right\",\r\n\r\n\t\tbeforeRender: function() {\r\n\t\t\tvar self  = this,\r\n\t\t\t\ttypes = _.without( bookmarks.all(\'content_type\'), undefined );\r\n\r\n\t\t\t_.each( types, function( type ) {\r\n\t\t\t\tself.insertView( new TypeBtn({ type: type }) );\r\n\t\t\t});\r\n\t\t},\r\n\r\n\t\tafterRender: function() {\r\n\t\t\t// Initialize tooltips\r\n\t\t\tthis.$el.find(\'.tip\').tooltip();\r\n\t\t}\r\n\t});\r\n\r\n\t\r\n\t// ---\r\n\t// Search Bar\r\n\t\r\n\tvar SearchBar = Backbone.View.extend({\r\n\t\t\r\n\t\tclassName: \"nav pull-left\",\r\n\t\ttemplate: \"searchBar\",\r\n\t\t\r\n\t\tinitialize: function() {\r\n\t\t\t// @todo: Should use 2-way data binding instead of events\r\n\t\t\tthis.model = searchCriterias.keywords;\r\n\t\t},\r\n\t\t\r\n\t\tevents: {\r\n\t\t\t\"keyup #search\": \"search\"\r\n\t\t},\r\n\t\t\r\n\t\tsearch: function( e ) {\r\n\t\t\tvar val = this.$el.find(\'#search\').val();\r\n\t\t\tthis.model.set( \'value\', val );\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t\r\n\t// ---\r\n\t// Main Header section\r\n\t\r\n\tvar MainHeader = Backbone.View.extend({\r\n\t\t\r\n\t\ttemplate: \"header\",\r\n\r\n\t\tevents: {\r\n\t\t\t\"click .js-clear-search\": \"clear\"\r\n\t\t},\r\n\t\t\r\n\t\tbeforeRender: function() {\r\n\t\t\t\r\n\t\t\t// @todo: Create modules for all sections here\r\n\t\t\t\r\n\t\t\tthis.insertViews({\r\n\t\t\t\t\".navbar-inner\": [\r\n\t\t\t\t\tnew SearchBar(),\r\n\t\t\t\t\tnew TypeBar()\r\n\t\t\t\t],\r\n\t\t\t\t\".dropdown-section\" : [\r\n\t\t\t\t\tnew FoldersDropdown(),\r\n\t\t\t\t\tnew OptionsMenu()\r\n\t\t\t\t]\r\n\t\t\t});\r\n\t\t\t\r\n\t\t},\r\n\t\t\r\n\t\tafterRender: function() {\r\n\r\n\t\t\tthis.$(\'.tip\').tooltip();\r\n\t\t\t\r\n\t\t},\r\n\r\n\t\t// Clear all search criterias\r\n\t\tclear: function() {\r\n\t\t\tsearchCriterias.clear();\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\t\r\n\t// Required, return the module for AMD compliance\r\n\treturn MainHeader;\r\n\r\n});\r\n\n//@ sourceURL=/views/header.js");

eval("/**\r\n * Router\r\n */\r\n/*global require:true, define:true */\r\n\r\ndefine(\'router\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"instances/all-bookmarks\",\r\n\t\"models/searchCriterias\",\r\n\t\"views/all-bookmarks\",\r\n\t\"views/options-page\",\r\n\t\"views/footer\",\r\n\t\"views/header\"\r\n],\r\nfunction( app, $, _, Backbone, bookmarksCollection, searchCriterias, AllBookmarksView, OptionsPage, Footer, Header ) {\r\n\t\"use strict\";\r\n\t\r\n\tvar MainLayout = Backbone.Layout.extend({\r\n\t\tel: \'body\'\r\n\t});\r\n\tvar mainLayout = new MainLayout();\r\n\tmainLayout.setViews({\r\n\t\t\"#header\": new Header(),\r\n\t\t\"#footer\": new Footer()\r\n\t});\r\n\t\r\n\tvar Router = Backbone.Router.extend({\r\n\t\t\r\n\t\troutes: {\r\n\t\t\t\"\"        : \"home\",\r\n\t\t\t\"options\" : \"options\"    // #help\r\n\t\t},\r\n\r\n\t\tinitialize: function() {\r\n\t\t\tBackbone.history.start();\r\n\t\t},\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// Routes\r\n\t\t\r\n\t\thome: function() {\r\n\t\t\tsearchCriterias.clear();\r\n\r\n\t\t\t//@TODO: close popup\r\n\t\t\tmainLayout.setViews({\r\n\t\t\t\t\'#stage\': new AllBookmarksView()\r\n\t\t\t}).render()\r\n\t\t\t\t.then(function() {\r\n\t\t\t\t\t// Trigger scroll to force start of lazyloading\r\n\t\t\t\t\t$(window).trigger(\'scroll\');\r\n\t\t\t\t});\r\n\t\t\tthis.page(\'home\');\r\n\t\t},\r\n\t\t\r\n\t\toptions: function() {\r\n\t\t\tmainLayout.setViews({\r\n\t\t\t\t\'#stage\': new OptionsPage()\r\n\t\t\t}).render();\r\n\t\t\tthis.page(\'options\');\r\n\t\t},\r\n\t\t\r\n\t\t\r\n\t\t// ---\r\n\t\t// Helpers\r\n\t\t\r\n\t\tpage: function( p ) {\r\n\t\t\t$(window).scrollTop(0);\r\n\t\t\t\r\n\t\t\tif ( p === \'options\' ) {\r\n\t\t\t\t$(\'#options\').show();\r\n\t\t\t\t$(\'#bookmarks\').hide();\r\n\t\t\t\t$(\'body\').addClass(\'options\');\r\n\t\t\t} else {\r\n\t\t\t\t$(\'#options\').hide();\r\n\t\t\t\t$(\'#bookmarks\').show();\r\n\t\t\t\t$(\'body\').removeClass(\'options\');\r\n\t\t\t}\r\n\t\t}\r\n\t\t\r\n\t});\r\n\t\r\n\treturn Router;\r\n\t\r\n});\r\n\n//@ sourceURL=/router.js");

eval("/**\r\n * Main.js - Bootstrap the application (required from config.js)\r\n *\r\n * @todo: Move most of the app initialization code in here when the components dependencies\r\n *        are made more flexible\r\n * \r\n */\r\n/*global require:true, define:true, chrome:true */\r\n\r\ndefine(\'main\',[\r\n\t\"app\",\r\n\t\"jquery\",\r\n\t\"underscore\",\r\n\t\"backbone\",\r\n\t\"router\",\r\n\t\"instances/settings\",\r\n\t\"instances/all-bookmarks\"\r\n],\r\nfunction( app, $, _, Backbone, Router, settings, bookmarksCollection ) {\r\n\t\"use strict\";\r\n\t\r\n\t// ---\r\n\t// Get settings\r\n\t\r\n\tsettings.fetch();\r\n\t\r\n\t\r\n\t// ---\r\n\t// Get Bookmarks\r\n\t\r\n\tbookmarksCollection.fetch({\r\n\t\tsuccess: fetchSources\r\n\t});\r\n\r\n\t\r\n\t// ---\r\n\t// Check bookmarks sources updates\r\n\t// @info: triggered after bookmarksCollection fetch is done\r\n\t// TODO: Transfer to an event/background page\r\n\r\n\tfunction fetchSources() {\r\n\r\n\t\t// Fetch Chrome bookmarks\r\n\t\trequire([ \"modules/bookmarks.chrome\" ], function( chromeBookmarks ) {\r\n\t\t\tchromeBookmarks.fetch();\r\n\t\t});\r\n\r\n\t\trequire([ \"modules/bookmarks.delicious\" ], function( deliciousBookmarks ) {\r\n\t\t\tdeliciousBookmarks.fetch();\r\n\t\t});\r\n\r\n\t}\r\n\r\n\t// ---\r\n\t// Create router\r\n\t\r\n\tapp.router = new Router();\r\n\t\r\n});\r\n\n//@ sourceURL=/main.js");

/*global require:true, define:true, window:true, document:true */

/**
 * AMD loader Configuration
 */

require.config({
	
	// Initialize the application with the main application file
	deps: [
		"main"
	],
	
	paths: {
		// Libraries.
		jquery     : "../assets/js/jquery/jquery", // v 1.8.3
		lodash     : "../assets/js/lodash/lodash.underscore", // v 1.0.0-rc.3
		backbone   : "../assets/js/backbone/backbone", // v 0.9.9
		handlebars : "../assets/js/handlebars/handlebars", // v 1.0.rc.1
		fuzzy      : "../assets/js/fuzzy-search/fuzzy",
		
		// Backbone plugins
		layoutmanager: "../assets/js/layoutmanager/backbone.layoutmanager", // v 0.7.5
		stickit: "../assets/js/backbone.stickit/backbone.stickit", // 0.5.2
		localStorage: "../assets/js/backbone.localStorage/backbone.localStorage",
		
		// jQuery plugins
		lazyload: "../assets/js/jquery.lazyload/jquery.lazyload",
		
		bootstrapTooltip: "../assets/js/bootstrap/bootstrap-tooltip",
		bootstrapModal: "../assets/js/bootstrap/bootstrap-modal"
	},

	map: {
		"*": { "underscore" : "lodash" }
	},
	
	shim: {

		lodash: {
			exports: "_"
		},
		
		backbone: {
			deps: [ "underscore", "jquery" ],
			exports: "Backbone"
		},
		
		
		handlebars: {
			exports: "Handlebars"
		},
		
		layoutmanager: [ "backbone" ],
		
		stickit: ["backbone"],
		
		localStorage: ["backbone"],
		
		bootstrap: ["jquery"],
		lazyload: ["jquery"],

		fuzzy: {
			exports: "fuzzy"
		}
		
	}
	
});

define("config", function(){});
 