/**
 * HTTP settings for googleapis / gaxios clients.
 *
 * Node 24.17+ can spuriously throw ERR_STREAM_PREMATURE_CLOSE when reusing
 * keep-alive HTTPS sockets (nodejs/node#63989, nodejs/node#64098). Google
 * client libraries use node-fetch v2, which hits this regression.
 */
import * as https from 'https';
import { google } from 'googleapis';

let configured = false;

export function configureGoogleApiHttp(): void {
  if (configured) {
    return;
  }

  if (typeof google.options === 'function') {
    google.options({
      agent: new https.Agent({ keepAlive: false }),
    });
  }

  configured = true;
}
