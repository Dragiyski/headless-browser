(function () {
    'use strict';
    const Promise = require('aigle');
    const jsdom = require('jsdom');

    class SyncAsyncCookieJar {
        constructor(cookieJar) {
            let options = {
                looseMode: cookieJar.enableLooseMode,
                rejectPublicSuffixes: cookieJar.rejectPublicSuffixes
            };
            Object.defineProperties(this, {
                _sync_jar: {
                    value: new jsdom.CookieJar(null, options)
                },
                _sync_async_jar: {
                    value: cookieJar
                },
                _sync_async_queue: {
                    value: []
                },
                _sync_async_execution: {
                    writable: true,
                    value: Promise.resolve(this)
                },
                _sync_async_promisify: {
                    value: {}
                },
                enableLooseMode: {
                    value: options.looseMode
                },
                rejectPublicSuffixes: {
                    value: options.rejectPublicSuffixes
                }
            });
        }

        setCookieSync() {
            let args = Array.prototype.slice.call(arguments);
            let result = this._sync_jar.setCookieSync.apply(this._sync_jar, args);
            this._sync_async_queue.push(['setCookie', args]);
            if (this._sync_async_queue.length <= 1) {
                this._sync_async_run();
            }
            return result;
        }

        _sync_async_run() {
            return this._sync_async_execution = this._sync_async_execution.then(() => {
                if (this._sync_async_queue.length <= 0) {
                    return this;
                }
                let fnCall = this._sync_async_queue.shift();
                if (!this._sync_async_promisify.hasOwnProperty(fnCall[0])) {
                    this._sync_async_promisify[fnCall[0]] = Promise.promisify(this._sync_async_jar[fnCall[0]]);
                }
                return this._sync_async_promisify[fnCall[0]].apply(this._sync_async_jar, fnCall[1]).then(() => {
                    if(this._sync_async_queue.length > 0) {
                        this._sync_async_run();
                    }
                    return this;
                }, err => {
                    this._sync_async_queue.unshift(fnCall);
                    throw err;
                });
            });
        }
        awaitSync() {
            let cb = arguments.length > 0 && arguments[arguments.length - 1];
            if(typeof cb !== 'function') {
                return this._sync_async_execution = this._sync_async_execution.then(() => this);
            }
            this._sync_async_execution = this._sync_async_execution.then(() => {
                cb(null, this);
                return this;
            }, (err) => {
                cb(err);
                throw err;
            });
        }
    }

    {
        let propSync = {}, propAsync = {};
        let proto = jsdom.CookieJar.prototype;
        while (proto != null) {
            if (proto.constructor.name === 'CookieJar') {
                let names = Object.getOwnPropertyNames(proto);
                names.forEach(name => {
                    if (name.endsWith('Sync')) {
                        let asyncName = name.substr(0, name.length - 4);
                        if (!proto.hasOwnProperty(asyncName)) {
                            return;
                        }
                        if (!propSync.hasOwnProperty(asyncName)) {
                            propSync[asyncName] = Object.getOwnPropertyDescriptor(proto, name);
                        }
                        if (!propAsync.hasOwnProperty(asyncName)) {
                            propAsync[asyncName] = Object.getOwnPropertyDescriptor(proto, asyncName);
                        }
                    }
                });
            }
            proto = Object.getPrototypeOf(proto);
        }
        Object.keys(propAsync).forEach(name => {
            if(SyncAsyncCookieJar.prototype.hasOwnProperty(name)) {
                return;
            }
            let desc = propSync[name];
            if (desc.configurable && typeof desc.value === 'function') {
                let targetDesc = {};
                Object.keys(desc).forEach(key => {
                    targetDesc[key] = desc[key]
                });
                targetDesc.value = asyncWithAwait(name);
                Object.defineProperty(SyncAsyncCookieJar.prototype, name, targetDesc);
            }
        });
        Object.keys(propSync).forEach(name => {
            let syncName = name + 'Sync';
            if(SyncAsyncCookieJar.prototype.hasOwnProperty(name)) {
                return;
            }
            let desc = propSync[name];

            if (desc.configurable && typeof desc.value === 'function') {
                let targetDesc = {};
                Object.keys(desc).forEach(key => {
                    targetDesc[key] = desc[key]
                });
                targetDesc.value = syncRedirect(syncName);
                Object.defineProperty(SyncAsyncCookieJar.prototype, syncName, targetDesc);
            }
        })
    }

    function syncRedirect(name) {
        return function () {
            return this._sync_jar[name].apply(this._sync_jar, arguments);
        }
    }

    function asyncWithAwait(name) {
        return function () {
            let args = Array.prototype.slice.call(arguments);
            let cb = args.length > 0 && args[args.length - 1];
            if(typeof cb !== 'function') {
                return this.awaitSync().then(() => {
                    if(!this._sync_async_promisify.hasOwnProperty(name)) {
                        this._sync_async_promisify[name] = Promise.promisify(this._sync_async_jar[name]);
                    }
                    return this._sync_async_promisify[name].apply(this._sync_async_jar, args);
                });
            }
            this.awaitSync().then(() => {
                this._sync_async_jar[name].apply(this._sync_async_jar, args);
            }, err => {
                cb(err);
            });
        };
    }

    module.exports = SyncAsyncCookieJar;
})();