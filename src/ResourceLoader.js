(function () {
    'use strict';
    const Promise = require('aigle');
    const punycode = require('punycode');
    const URL = require('url').URL;
    const jsdom = require('jsdom');
    const lodash = {
        assign: require('lodash/assign'),
        merge: require('lodash/merge')
    };

    class ResourceLoader extends jsdom.ResourceLoader {
        constructor(tab, options) {
            super();
            Object.defineProperties(this, {
                _tab: {
                    value: tab
                },
                _options: {
                    configurable: true,
                    enumerable: false,
                    writable: true,
                    value: lodash.merge({}, options)
                }
            });
        }

        fetch(url, options) {
            if (options.element == null) {
                return null;
            }
            if(url.startsWith('blob:')) {
                url = url.substr('blob:'.length);
                url = new URL(url);
                let window = options.element.ownerDocument.defaultView;
                if(url.origin !== window.location.origin || url.pathname.length < 1 || !url.pathname.startsWith('/')) {
                    return null;
                }
                let blobSymbol = require('./dom').blobUrl.impl;
                if(window[blobSymbol] == null) {
                    return null;
                }
                let id = url.pathname.substr(1);
                if(window[blobSymbol].hasOwnProperty(id)) {
                    let blob = window[blobSymbol][id];
                    if(blob instanceof window.Blob) {
                        let buffer = null;
                        if(Object.getOwnPropertySymbols(blob).some(symbol => {
                            let impl = blob[symbol];
                            if(impl != null && Buffer.isBuffer(blob[symbol]._buffer)) {
                                buffer = blob[symbol]._buffer;
                                return true;
                            }
                            return false;
                        })) {
                            return Promise.resolve(buffer);
                        }
                    }
                }
                return null;
            }
            if(url.startsWith('data:')) {
                return null;
            }
            if (options.element.nodeName.toUpperCase() === 'LINK' && options.element.hasAttribute('rel') && options.element.getAttribute('rel').toLowerCase() === 'stylesheet') {
                if(!isResourceAllowed(this._options.stylesheet, url + '', options.element)) {
                    return null;
                }
                return this.stylesheet(url, options);
            }
            if (options.element.nodeName.toUpperCase() === 'SCRIPT') {
                if(!isResourceAllowed(this._options.script, url + '', options.element)) {
                    return null;
                }
                return this.script(url, options);
            }
            if (['IFRAME', 'FRAME'].indexOf(options.element.nodeName.toUpperCase()) >= 0) {
                if(!isResourceAllowed(this._options.frame, url + '', options.element)) {
                    return null;
                }
                return this.frame(url, options);
            }
            return null;
        }

        stylesheet(url, options) {
            let mimeType = 'text/css';
            if (options.element.hasAttribute('type')) {
                mimeType = options.element.getAttribute('type').toLowerCase();
                if (mimeType.length <= 0) {
                    mimeType = 'text/css';
                }
            }
            if (mimeType !== 'text/css') {
                return null;
            }
            let resourceOptions = {
                request: {
                    headers: {
                        accept: mimeType,
                        referer: options.referrer
                    }
                }
            };
            return this._tab.resource(url + '', resourceOptions);
        }

        script(url, options) {
            let mimeType;
            if (options.element.hasAttribute('type')) {
                mimeType = options.element.getAttribute('type').toLowerCase();
                if ([
                    'application/ecmascript',
                    'application/javascript',
                    'application/x-ecmascript',
                    'application/x-javascript',
                    'text/ecmascript',
                    'text/javascript',
                    'text/javascript1.0',
                    'text/javascript1.1',
                    'text/javascript1.2',
                    'text/javascript1.3',
                    'text/javascript1.4',
                    'text/javascript1.5',
                    'text/jscript',
                    'text/livescript',
                    'text/x-ecmascript',
                    'text/x-javascript',
                    'module'
                ].indexOf(mimeType) < 0) {
                    return null;
                }
            }
            let accept = [];
            if (mimeType != null && mimeType !== 'module') {
                accept.push(mimeType);
            }
            if (mimeType !== 'application/javascript') {
                accept.push('application/javascript');
            }
            if (mimeType !== 'text/javascript') {
                accept.push('text/javascript');
            }
            return this._tab.resource(url + '', {
                request: {
                    headers: {
                        accept: accept.join(','),
                        referer: options.referrer
                    }
                }
            });
        }

        frame(url, options) {
            if ((url + '').toLowerCase() === 'about:blank') {
                return Buffer.alloc(0);
            }
            let referer = options.referrer;
            let referrerPolicy = typeof options.element.referrerPolicy === 'string' && options.element.referrerPolicy.toLowerCase() || '';
            if (referrerPolicy === 'no-referrer') {
                referer = null;
            } else if (referrerPolicy === 'origin') {
                referer = new URL(referer.origin);
            } else if (referrerPolicy === 'origin-when-cross-origin') {
                let u = new URL(url);
                if (u.origin !== referer.origin) {
                    referer = new URL(referer.origin);
                }
            } else if (referrerPolicy === 'same-origin') {
                let u = new URL(url);
                if (u.origin !== referer.origin) {
                    referer = null;
                }
            } else if (referrerPolicy === 'strict-origin') {
                let u = new URL(url);
                if (u.protocol === 'http:' && referer.protocol === 'https:') {
                    referer = null;
                }
            } else if (referrerPolicy === 'strict-origin-when-cross-origin') {
                let u = new URL(url);
                if (u.protocol === 'http:' && referer.protocol === 'https:') {
                    referer = new URL(referer.origin);
                }
            } else if (referrerPolicy === 'unsafe-url') {
            } else {
                let u = new URL(url);
                if (u.protocol !== 'https:') {
                    referer = null;
                }
            }
            return this._tab.resource(url, {
                request: {
                    headers: {
                        referer: referer
                    }
                }
            });
        }
    }

    function isResourceAllowed(criteria, url, element) {
        if (criteria === true) {
            return true;
        }
        if (criteria == null || criteria === false) {
            return false;
        }
        if (Array.isArray(criteria)) {
            return criteria.some(c => isResourceAllowed(c, url, element));
        }
        if (typeof criteria === 'function') {
            return criteria(url, element);
        }
        url = new URL(url);
        return [
            'protocol',
            'hostname',
            'port',
            'host',
            'username',
            'password',
            'origin',
            'pathname',
            'search',
            'searchParams',
            'hash',
            'href'
        ].every(option => {
            if(Array.isArray(criteria[option])) {
                return criteria[option].some(cc => optionHandler(cc));
            }
            return optionHandler(criteria[option]);

            function optionHandler(c) {
                if (typeof c === 'function') {
                    return c.call(null, url[option], element);
                }
                if (typeof url[option] === 'string') {
                    if (c instanceof RegExp) {
                        return c.test(url[option]);
                    }
                }
                if (resourceUrlHandlers[option] != null) {
                    return resourceUrlHandlers[option](c, url, element);
                }
                if (typeof url[option] === 'string') {
                    if (typeof c === 'string') {
                        return c === url[option];
                    }
                }
                return true;
            }
        });
    }

    const resourceUrlHandlers = {
        hostname: function (criteria, url, element) {
            if (typeof criteria === 'string') {
                let haystack = criteria.toLowerCase().split('.').map(punycode.toASCII).reverse();
                let needle = url.hostname.toLowerCase().split('.').map(punycode.toASCII).reverse();
                if (haystack.length > 1 && haystack[0] === '@') {
                    haystack.shift();
                    let base = element.ownerDocument.defaultView.top.location.hostname.toLowerCase().split('.').map(punycode.toASCII).reverse();
                    haystack = base.concat(haystack);
                }
                for (let i = 0, hl = haystack.length; i < hl; ++i) {
                    if (haystack[i] === '*') {
                        break;
                    }
                    if (haystack[i] !== needle[i]) {
                        return false;
                    }
                }
            }
            return true;
        },
        port: function (criteria, url, element) {
            let haystack, needle;
            if (typeof criteria === 'string') {
                if (criteria.length <= 0) {
                    return true;
                }
                haystack = parseInt(criteria);
            } else if (typeof criteria === 'number') {
                haystack = criteria;
            }
            if (!isFinite(haystack) || haystack === 0) {
                return true;
            }
            if (haystack < 0) {
                return false;
            }
            if (typeof url.port === 'string') {
                if (needle.length <= 0) {
                    let protocol = url.protocol.toLowerCase();
                    if (protocol.endsWith(':')) {
                        protocol = protocol.substr(0, protocol.length - 1);
                    }
                    if (protocol === 'http') {
                        needle = 80;
                    } else if (protocol === 'https') {
                        needle = 443;
                    } else {
                        return false;
                    }
                }
                needle = parseInt(needle);
                if (!isFinite(needle) || needle <= 0) {
                    return false;
                }
            }
            if (haystack != null && needle != null) {
                return haystack === needle;
            }
            return true;
        },
        pathname: function (criteria, url, element) {
            if (typeof criteria === 'string') {
                let haystack = decodeURIComponent(criteria).split('/');
                let needle = decodeURIComponent(url.pathname).split('/');
                if (haystack.length > needle.length) {
                    return false;
                }
                for (let i = 0, hl = haystack.length; i < hl; ++i) {
                    if (haystack[i] !== needle[i]) {
                        return false;
                    }
                }
            }
            return true;
        }
    };

    const resourceHandlers = {
        link: function () {

        },
        script: function () {

        }
    };

    module.exports = ResourceLoader;
})();