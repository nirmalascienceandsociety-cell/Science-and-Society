import app from './index.js';
import { httpServerHandler } from 'cloudflare:node';

const PORT = 3001;
app.listen(PORT);

const nodeHandler = httpServerHandler({ port: PORT });

export default {
  async fetch(request, env, ctx) {
    // Populate process.env with Worker secrets & bindings on first request
    if (env && typeof env === 'object') {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string' && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
    return nodeHandler.fetch(request, env, ctx);
  }
};
