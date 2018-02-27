import Promise from '../promise';
import Notice from '../notice';
import jsonifyNotice from '../jsonify_notice';

import {ReporterOptions, errors} from './reporter';


let rateLimitReset = 0;


export default function report(notice: Notice, opts: ReporterOptions, promise: Promise): void {
    let utime = Date.now() / 1000;
    if (utime < rateLimitReset) {
        promise.reject(errors.ipRateLimited);
        return;
    }

    let url = `${opts.host}/api/v3/projects/${opts.projectId}/notices?key=${opts.projectKey}`;
    let payload = jsonifyNotice(notice);

    let opt = {
        method: 'POST',
        body: payload,
    };

    fetch(url, opt).then((req: Response) => {
        if (req.status === 401) {
            promise.reject(errors.unauthorized);
            return;
        }

        if (req.status === 429) {
            promise.reject(errors.ipRateLimited);

            let s = req.headers.get('X-RateLimit-Delay');
            if (!s) {
                return;
            }

            let n = parseInt(s, 10);
            if (n > 0) {
                rateLimitReset = Date.now() / 1000 + n;
            }
            return;
        }

        if (req.status >= 200 && req.status < 500) {
            req.json().then((resp) => {
                if (resp.id) {
                    notice.id = resp.id;
                    promise.resolve(notice);
                    return;
                }
                if (resp.message) {
                    let err = new Error(resp.message);
                    promise.reject(err);
                    return;
                }
            });
            return;
        }
        req.text().then((body) => {
            let err = new Error(
                `airbrake: fetch: unexpected response: code=${req.status} body='${body}'`);
            promise.reject(err);
        });
    }).catch((err) => {
        promise.reject(err);
    });
}
