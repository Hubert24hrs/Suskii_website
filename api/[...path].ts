/**
 * Single Vercel Function for every /api/* route (Web-standard Request/Response handlers).
 */
import { handle } from '../server/app.js';

export const GET = (req: Request) => handle(req);
export const POST = (req: Request) => handle(req);
export const PUT = (req: Request) => handle(req);
export const PATCH = (req: Request) => handle(req);
export const DELETE = (req: Request) => handle(req);
export const HEAD = (req: Request) => handle(req);
