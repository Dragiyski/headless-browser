(function () {
    'use strict';
    // const SyncAsyncCookieJar = require('./SyncAsyncCookieJar');
    const Promise = require('aigle');
    const jsdom = require('jsdom');
    const lodash = {
        merge: require('lodash/merge'),
        assign: require('lodash/assign')
    };
    const moment = require('moment');
    const stream = require('stream');
    moment.suppressDeprecationWarnings = true;
    const URL = require('url').URL;
    const MOMENT_HTTP_FORMAT = 'ddd, DD MMM YYYY HH:mm:SS [GMT]';
    const protocolLibraries = {
        http: require('http'),
        https: require('https')
    };
    const SyncAsyncCookieJar = require('./SyncAsyncCookieJar');
    const AsyncCookieJar = require('./AsyncCookieJar');
    const ResourceLoader = require('./ResourceLoader');

    function Browser(options) {
        options = options || {};
        let cookies = null;
        if (options.cookieJar != null) {
            cookies = options.cookieJar;
        } else {
            cookies = new jsdom.CookieJar();
        }
        if (cookies.store != null && 'synchronous' in cookies.store && !cookies.store.synchronous) {
            cookies = new SyncAsyncCookieJar(cookies);
        } else {
            cookies = new AsyncCookieJar(cookies);
        }
        Object.defineProperties(this, {
            _cookies: {
                value: cookies
            },
            _options: {
                value: lodash.merge({}, Browser.defaultOptions, options)
            }
        });
        delete this._options.cookieJar;
    }

    Object.defineProperties(Browser, {
        Tab: {
            enumerable: true,
            value: function BrowserTab(browser, options) {
                if (!(browser instanceof Browser)) {
                    throw new TypeError('Tab must be created within Browser context');
                }
                Object.defineProperties(this, {
                    _browser: {
                        value: browser
                    },
                    _cookies: {
                        get: function() {
                            return this._browser._cookies;
                        }
                    },
                    _options: {
                        value: lodash.merge({}, browser._options, options)
                    },
                    _page: {
                        configurable: true,
                        writable: true,
                        value: null
                    }
                });
            }
        },
        Page: {
            enumerable: true,
            value: function BrowserPage(url, request, response) {
                url = new URL(url);
                Object.defineProperties(this, {
                    url: {
                        value: url
                    },
                    request: {
                        configurable: true,
                        value: request
                    },
                    response: {
                        configurable: true,
                        value: response
                    }
                });
            }
        }
    });

    Browser.Tab.prototype = Object.create(Object.prototype, {
        constructor: {
            value: Browser.Tab
        },
        open: {
            value: function (url, options) {
                if (this._page instanceof Promise) {
                    return this._page.finally(() => this.load(url, options));
                }
                return this._page = this.getPage().then(page => {
                    if (page != null && page.window != null && typeof page.window.close === 'function') {
                        page.window.close();
                    }
                }).then(() => {
                    url = new URL(url);
                    options = lodash.merge({}, this._options, {
                        method: 'GET',
                        content: {
                            processors: {
                                text: {
                                    plain: textProcessor,
                                    html: jsdomProcessor
                                },
                                application: {
                                    'xhtml+xml': jsdomProcessor,
                                    xml: jsdomProcessor
                                }
                            }
                        }
                    }, options);
                    return _load.call(this, url, options);
                }).then(page => {
                    return this._page = page;
                });
            }
        },
        request: {
            value: function(url, options) {
                url = new URL(url);
                options = lodash.merge({}, this._options, {
                    method: 'GET',
                    content: {
                        processors: {
                            text: {
                                plain: textProcessor,
                                html: jsdomProcessor
                            },
                            application: {
                                'xhtml+xml': jsdomProcessor,
                                xml: jsdomProcessor
                            }
                        }
                    }
                }, options);
                return _load.call(this, url, options);
            }
        },
        resource: {
            value: function (url, options) {
                url = new URL(url);
                options = options || {};
                let loadOptions = lodash.merge({}, this._options, options);
                if (loadOptions.content == null) {
                    loadOptions.content = {};
                }
                loadOptions.content.processors = {
                    '*': {'*': bufferStoreProcessor}
                };
                return _load.call(this, url, loadOptions).then(page => {
                    if (page.response.statusCode === 200 && Buffer.isBuffer(page.content)) {
                        return page.content;
                    }
                    return Buffer.allocUnsafe(0);
                });
            }
        },
        getPage: {
            value: function () {
                return Promise.resolve(this._page);
            }
        }
    });

    function _load(url, options) {
        let processPage = true;
        return Promise.attempt(() => {
            let protocol = url.protocol;
            if (protocol.length <= 0) {
                throw new Error('Expected URL with a protocol');
            }
            if (protocol.endsWith(':')) {
                protocol = protocol.substr(0, protocol.length - 1);
            }
            protocol = protocol.toLowerCase();
            if (protocol !== 'http' && protocol !== 'https') {
                throw new Error('Only "http" and "https" are supported by this browser');
            }
            if (url.hostname.length <= 0) {
                throw new Error('Expected URL with a hostname');
            }
            let library = protocolLibraries[protocol];
            let request = library.request(url, {
                method: options.method || 'GET'
            });
            options.request != null && options.request.headers != null && Object.keys(options.request.headers).forEach(headerName => {
                if (options.request.headers[headerName] != null) {
                    request.setHeader(headerName, options.request.headers[headerName]);
                } else {
                    request.removeHeader(headerName);
                }
            });
            let requestTime;
            if (options.time instanceof moment || options.time instanceof Date || typeof options.time === 'string') {
                requestTime = moment(options.time);
                if (!requestTime.isValid()) {
                    requestTime = null;
                }
            }
            if (requestTime == null) {
                requestTime = moment();
            }
            requestTime.milliseconds(0);
            if (!request.hasHeader('date')) {
                request.setHeader('date', httpDate(requestTime));
            }
            request.time = requestTime;
            if (options.redirect != null && options.redirect._from instanceof Browser.Page) {
                let lastRequest = options.redirect._from.request;
                if (lastRequest.hasHeader('referer')) {
                    request.setHeader(lastRequest.getHeader('referer'));
                }
            }
            return request;
        }).then(request => {
            return this._cookies.getCookieString(url + '', {
                http: true,
                now: request.time.toDate(),
                ignoreError: true
            }).then(cookieHeader => {
                if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
                    request.setHeader('cookie', cookieHeader);
                }
                return request;
            }, () => request);
        }).then(request => {
            return sendRequest(request, options.body, options.encoding).then(response => {
                let page = new Browser.Page(url, request, response);
                if (response.headers.hasOwnProperty('set-cookie')) {
                    let cookies = null;
                    if (Array.isArray(response.headers['set-cookie'])) {
                        cookies = response.headers['set-cookie'];
                    } else {
                        cookies = [response.headers['set-cookie']];
                    }
                    return Promise.all(cookies.map(cookie => this._cookies.setCookie(cookie, url + '', {
                        http: true,
                        now: request.time.toDate(),
                        ignoreError: true
                    }))).then(() => page);
                }
                return page;
            });
        }).then(page => {
            // Redirect handling: if redirect occurs, this resolves to the destination page
            // or it could resolve to the redirect itself, if the maximum number of redirect is reached,
            // or no "Location" header is specified.
            if (
                options.redirect != null && options.redirect.follow &&
                [301, 302, 303, 307, 308].indexOf(page.response.statusCode) >= 0 &&
                page.response.headers.hasOwnProperty('location')
            ) {
                let nextUrl = new URL(page.response.headers.location, page.url);
                let nextOptions = {
                    redirect: {
                        _from: page,
                        _count: 1
                    }
                };
                if (typeof options.redirect._count === 'number') {
                    nextOptions.redirect._count = options.redirect._count + 1;
                    if (typeof options.redirect.max === 'number' && options.redirect._count >= options.redirect.max) {
                        return page;
                    }
                }
                if (page.response.statusCode <= 303) {
                    nextOptions.method = 'GET'
                }
                processPage = false;
                page.response.connection.end();
                return _load(nextUrl, lodash.merge({}, options, nextOptions));
            }
            return page;
        }).then(page => {
            if (!processPage || options.content === false) {
                return page;
            }
            if (page.response.headers.hasOwnProperty('content-type')) {
                let contentType = page.response.headers['content-type'];
                contentType = contentType.split(';');
                let parameters = contentType.slice(1);
                contentType = contentType[0].trim().toLowerCase();
                {
                    let kv = parameters.map(parameter => {
                        parameter = parameter.trim().split('=');
                        return [parameter[0], parameter.slice(1).join('=')]
                    });
                    parameters = {};
                    kv.forEach(keyValue => {
                        parameters[keyValue[0].toLowerCase()] = keyValue[1].trim();
                    });
                }
                let ctype = contentType.split('/');
                let procs = options.content.processors;
                if (procs != null && ctype.every(t => {
                    if (procs.hasOwnProperty(t)) {
                        procs = procs[t];
                        return true;
                    }
                    if (procs.hasOwnProperty('*')) {
                        procs = procs['*'];
                        return true;
                    }
                    return false;
                }) && typeof procs === 'function') {
                    return procs.call(this, page, options, {
                        mime: contentType,
                        parameters
                    }).then(() => page);
                }
            }
            return page;
        });
    }

    Browser.prototype = Object.create(Object.prototype, {
        constructor: {
            value: Browser
        },
        request: {
            value: function(url, options) {
                url = new URL(url);
                options = lodash.merge({}, this._options, {
                    method: 'GET',
                    content: {
                        processors: {
                            text: {
                                plain: textProcessor,
                                html: jsdomProcessor
                            },
                            application: {
                                'xhtml+xml': jsdomProcessor,
                                xml: jsdomProcessor
                            }
                        }
                    }
                }, options);
                return _load.call(this, url, options);
            }
        },
        resource: {
            value: function (url, options) {
                url = new URL(url);
                options = options || {};
                let loadOptions = lodash.merge({}, this._options, options);
                if (loadOptions.content == null) {
                    loadOptions.content = {};
                }
                loadOptions.content.processors = {
                    '*': {'*': bufferStoreProcessor}
                };
                return _load.call(this, url, loadOptions).then(page => {
                    if (page.response.statusCode === 200 && Buffer.isBuffer(page.content)) {
                        return page.content;
                    }
                    return Buffer.allocUnsafe(0);
                });
            }
        }
    });

    function sendRequest(request, body, encoding) {
        return Promise.attempt(() => {
            if (body != null && request.method !== 'GET' && request.method !== 'HEAD') {
                if (body instanceof stream.Readable) {
                    body.pipe(request);
                } else if (Buffer.isBuffer(body)) {
                    request.write(body);
                } else if (typeof body === 'string') {
                    if (typeof encoding === 'string') {
                        request.write(body, encoding);
                    } else {
                        request.write(body, 'utf8');
                    }
                } else {
                    throw new TypeError('If body is specified, it should be a readable stream, buffer or string');
                }
            }
            return new Promise((resolve, reject) => {
                request.once('error', reject);
                request.once('response', resolve);
                request.end();
            });
        });
    }

    function textProcessor(page, options, type) {
        return Promise.attempt(() => {
            let charset = 'utf-8', s = '';
            if (type.parameters.hasOwnProperty('charset')) {
                charset = type.parameters.charset.toLowerCase();
                if (!supportEncoding(charset)) {
                    return;
                }
            }
            return new Promise((resolve, reject) => {
                const getData = data => {
                    s += data.toString(charset);
                };
                page.response.on('data', getData);
                page.response.once('end', () => {
                    page.response.removeListener('data', getData);
                    page.content = s;
                    resolve(s);
                });
                page.response.once('error', err => {
                    reject(err);
                });
            });
        });
    }

    function bufferProcessor(page) {
        return Promise.attempt(() => {
            let dynamic = true, buffer, processed = 0;
            if (page.response.headers.hasOwnProperty('content-length')) {
                let length = parseInt(page.response.headers['content-length']);
                if (isFinite(length) && length > 0) {
                    dynamic = false;
                    buffer = Buffer.allocUnsafe(length);
                }
            }
            if (buffer == null) {
                buffer = Buffer.allocUnsafe(0);
            }
            return new Promise((resolve, reject) => {
                const getData = data => {
                    if (dynamic) {
                        buffer = Buffer.concat([buffer, data]);
                    } else {
                        data.copy(buffer, processed);
                        processed += data.length;
                    }
                };
                page.response.on('data', getData);
                page.response.once('end', () => {
                    page.response.removeListener('data', getData);
                    resolve(buffer);
                });
                page.response.once('error', err => {
                    reject(err);
                });
            });
        });
    }

    function bufferStoreProcessor(page) {
        return bufferProcessor(page).then(buffer => {
            return page.content = buffer;
        });
    }

    function jsdomProcessor(page, options, type) {
        return bufferProcessor(page).then(buffer => {
            let opt = {
                url: page.url + '',
                contentType: type.mime,
                cookieJar: this._cookies,
                pretendToBeVisual: true,
                runScripts: 'dangerously',
                resources: new ResourceLoader(this, options.resources || {})
            };
            if (page.request.hasHeader('referer')) {
                opt.referrer = page.request.getHeader('referer');
            }
            let jsDomOptions = lodash.assign({}, opt, options.jsdom);
            page.window = new jsdom.JSDOM(buffer, jsDomOptions).window;
            let resolved = false;
            return new Promise((resolve, reject) => {
                page.window.addEventListener('load', pageLoaded);

                function pageLoaded() {
                    page.window.removeEventListener('load', pageLoaded);
                    resolve(page.window);
                }
            });
        });
    }

    Object.defineProperties(Browser, {
        defaultOptions: {
            configurable: true,
            enumerable: true,
            writable: true,
            value: {
                redirect: {
                    follow: true,
                    max: 10
                },
                request: {
                    headers: {
                        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.80 Safari/537.36',
                        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'cache-control': 'no-cache',
                        'pragma': 'no-cache'
                    }
                },
                resources: {
                    stylesheet: true,
                    script: {
                        hostname: '*.@'
                    },
                    frame: true
                }
            }
        }
    });

    function httpDate(date) {
        if (typeof date !== 'string' && !(date instanceof Date) && !(date instanceof moment)) {
            throw new TypeError('Expected date formated as string, Date object or moment object');
        }
        return moment(date).utcOffset(0).format(MOMENT_HTTP_FORMAT);
    }

    function supportEncoding(encoding) {
        try {
            require('string_decoder').StringDecoder(encoding);
        } catch (e) {
            if (!(e instanceof TypeError)) {
                throw e;
            }
            return false;
        }
        return true;
    }

    module.exports = Browser;
})();