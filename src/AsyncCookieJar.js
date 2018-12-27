(function () {
    'use strict';
    const Promise = require('aigle');
    const jsdom = require('jsdom');

    class AsyncCookieJar {
        constructor(cookieJar) {
            Object.defineProperties(this, {
                _cookieJar: {
                    value: cookieJar
                },
                _promisify: {
                    value: {}
                }
            });
        }
    }

    {
        let propSync = {}, propAsync = {}, properties = {};
        let proto = jsdom.CookieJar.prototype;
        while (proto != null) {
            if (proto.constructor.name === 'CookieJar') {
                let names = Object.getOwnPropertyNames(proto);
                names.forEach(name => {
                    if(name === 'constructor') {
                        return;
                    }
                    properties[name] = Object.getOwnPropertyDescriptor(proto, name);
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
            if (AsyncCookieJar.prototype.hasOwnProperty(name)) {
                return;
            }
            let desc = propSync[name];
            if (desc.configurable && typeof desc.value === 'function') {
                let targetDesc = {};
                Object.keys(desc).forEach(key => {
                    targetDesc[key] = desc[key]
                });
                targetDesc.value = promisifyOrSuper(name);
                Object.defineProperty(AsyncCookieJar.prototype, name, targetDesc);
            }
        });
        Object.keys(properties).forEach(name => {
            if(AsyncCookieJar.prototype.hasOwnProperty(name)) {
                return;
            }
            let targetDesc = {}, desc = properties[name];
            Object.keys(desc).forEach(key => {
                targetDesc[key] = desc[key];
            });
            ['value', 'get', 'set'].forEach(prop => {
                if(typeof targetDesc[prop] === 'function') {
                    targetDesc[prop] = redirectThis(targetDesc[prop]);
                }
            });
            Object.defineProperty(AsyncCookieJar.prototype, name, targetDesc);
        });
    }

    function redirectThis(func) {
        return function() {
            return func.apply(this._cookieJar, arguments);
        }
    }

    function promisifyOrSuper(name) {
        return function() {
            let args = Array.prototype.slice.call(arguments);
            if(args.length > 0 && typeof args[args.length - 1] === 'function') {
                return void this._cookieJar[name].apply(this._cookieJar, args);
            }
            if(!this._promisify.hasOwnProperty(name)) {
                this._promisify[name] = Promise.promisify(this._cookieJar[name]);
            }
            return this._promisify[name].apply(this._cookieJar, args);
        }
    }

    module.exports = AsyncCookieJar;
})();