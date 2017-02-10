import Promise from './promise';
import {Notice, AirbrakeError} from './notice';

import Processor from './processor/processor';
import stacktracejsProcessor from './processor/stacktracejs';

import Filter from './filter/filter';
import scriptErrorFilter from './filter/script_error';
import uncaughtMessageFilter from './filter/uncaught_message';
import angularMessageFilter from './filter/angular_message';

import {Reporter, ReporterOptions, detectReporter} from './reporter/reporter';
import compatReporter from './reporter/compat';
import xhrReporter from './reporter/xhr';
import jsonpReporter from './reporter/jsonp';


declare const VERSION: string;

interface FunctionWrapper {
    (): any;
    __airbrake__: boolean;
    __inner__: () => any;
}

// Creates window.onerror handler for notifier. See
// https://developer.mozilla.org/en/docs/Web/API/GlobalEventHandlers/onerror.
function makeOnErrorHandler(notifier: Client): ErrorEventHandler {
    return function(message: string, filename?: string, line?: number, column?: number, error?: Error): void {
        if (error) {
            notifier.notify(error);
        }

        notifier.notify({error: {
            message: message,
            fileName: filename,
            lineNumber: line,
            columnNumber: column,
        }});
    };
}

export class Client {
    onerror: ErrorEventHandler;

    private opts: ReporterOptions = {} as ReporterOptions;

    private processor: Processor;
    private reporters: Reporter[] = [];
    private filters: Filter[] = [];

    constructor(opts: any = {}) {
        this.opts.projectId = opts.projectId;
        this.opts.projectKey = opts.projectKey;

        if (opts.host) {
            this.opts.host = opts.host;
        } else {
            this.opts.host = 'https://api.airbrake.io';
        }

        if (opts.processor) {
            this.processor = opts.processor;
        } else {
            this.processor = stacktracejsProcessor;
        }

        if (opts.reporter) {
            this.addReporter(opts.reporter);
        } else {
            this.addReporter(detectReporter(opts));
        }

        this.addFilter(scriptErrorFilter);
        this.addFilter(uncaughtMessageFilter);
        this.addFilter(angularMessageFilter);

        this.onerror = makeOnErrorHandler(this);
        if (!window.onerror && opts.onerror !== false) {
            window.onerror = this.onerror;
        }
    }

    setProject(id: number, key: string): void {
        this.opts.projectId = id;
        this.opts.projectKey = key;
    }

    setHost(host: string) {
        this.opts.host = host;
    }

    addReporter(name: string|Reporter): void {
        let reporter: Reporter;
        switch (name) {
        case 'compat':
            reporter = compatReporter;
            break;
        case 'xhr':
            reporter = xhrReporter;
            break;
        case 'jsonp':
            reporter = jsonpReporter;
            break;
        default:
            reporter = name as Reporter;
        }
        this.reporters.push(reporter);
    }

    addFilter(filter: Filter): void {
        this.filters.push(filter);
    }

    notify(err) {
        let context: any = {
            language: 'JavaScript',
            notifier: {
                name: 'airbrake-js',
                version: VERSION,
                url: 'https://github.com/airbrake/airbrake-js',
            },
        };
        if (window.navigator && window.navigator.userAgent) {
            context.userAgent = window.navigator.userAgent;
        }
        if (window.location) {
            context.url = String(window.location);
            // Set root directory to group errors on different subdomains together.
            context.rootDirectory = window.location.protocol + '//' + window.location.host;
        }

        let promise = new Promise();

        this.processor(err.error || err, (_: string, errInfo: AirbrakeError): void => {
            let notice: Notice = {
                id: '',
                errors: [errInfo],
                context: Object.assign(context, err.context),
                params: err.params || {},
                environment: err.environment || {},
                session: err.session || {},
            };

            for (let i in this.filters) {
                let filterFn = this.filters[i];
                notice = filterFn(notice);
                if (notice === null || (notice as any) === false) {
                    return;
                }
            }

            for (let i in this.reporters) {
                let reporterFn = this.reporters[i];
                reporterFn(notice, this.opts, promise);
            }
        });

        return promise;
    }

    private wrapArguments(args: any[]) {
        for (let i in args) {
            let arg = args[i];
            if (typeof arg === 'function') {
                args[i] = this.wrap(arg);
            }
        }
        return args;
    }

    wrap(fn): FunctionWrapper {
        if (fn.__airbrake__) {
            return fn;
        }

        let self = this;
        let airbrakeWrapper = function () {
            let fnArgs = Array.prototype.slice.call(arguments);
            let wrappedArgs = self.wrapArguments(fnArgs);
            try {
                return fn.apply(this, wrappedArgs);
            } catch (exc) {
                self.notify({error: exc, params: {arguments: fnArgs}});
                return;
            }
        } as FunctionWrapper;

        for (let prop in fn) {
            if (fn.hasOwnProperty(prop)) {
                airbrakeWrapper[prop] = fn[prop];
            }
        }

        airbrakeWrapper.__airbrake__ = true;
        airbrakeWrapper.__inner__ = fn;

        return airbrakeWrapper;
    }

    call(fn) {
        let wrapper = this.wrap(fn);
        return wrapper.apply(this, Array.prototype.slice.call(arguments, 1));
    }
}
