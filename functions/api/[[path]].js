import { handleRequest } from '../../cloudflare/app.mjs';

export const onRequest = context => handleRequest(context.request, context.env, context);
