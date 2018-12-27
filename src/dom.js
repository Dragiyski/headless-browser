(function () {
    'use strict';
    const uuid = require('uuid/v5');

    exports.extensions = function (after) {
        return function (window) {
            let exts = [blobURL];
            if (typeof after === 'function') {
                exts.push(after);
            }
            exts.forEach(ext => ext(window));
        }
    };

    const blobURL = exports.blobUrl = function (window) {
        window[blobURL.impl] = {};
        window.URL.createObjectURL = function (object) {
            let id = object[blobURL.impl];
            if (id == null) {
                do {
                    id = object[blobURL.impl] = uuid(window.location.origin, uuid.URL);
                } while (window[blobURL.impl].hasOwnProperty(id));
            }
            window[blobURL.impl][id] = object;
            return 'blob:' + window.location.origin + '/' + id;
        };
        window.URL.revokeObjectURL = function (url) {
            if (typeof url === 'string' && url.startsWith('blob:')) {
                url = url.substr(5);
                url = new URL(url);
                let id = url.pathname;
                if (!id.startsWith('/')) {
                    return;
                }
                id = id.substr(1);
                delete window[blobURL.impl][id];
            }
        }
    };

    blobURL.impl = Symbol('blobURL');
})();