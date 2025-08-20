import {
  IncomingMessage,
  ServerResponse,
  createServer as createHttpServer,
} from 'http';
import { URL } from 'url';
import { logger } from '../lib/logger';

export interface ApiResponse {
  statusCode: number;
  data?: unknown;
  message?: string;
}

export function createServer() {
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Parse URL
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    logger.info(`${method} ${path}`);

    // Simple routing
    if (path === '/' && method === 'GET') {
      handleHealthCheck(res);
    } else if (path === '/api/hello' && method === 'GET') {
      handleHello(res);
    } else {
      handleNotFound(res);
    }
  });
}

function handleHealthCheck(res: ServerResponse): void {
  sendJsonResponse(res, {
    statusCode: 200,
    data: { status: 'OK', timestamp: new Date().toISOString() },
    message: 'Server is running',
  });
}

function handleHello(res: ServerResponse): void {
  sendJsonResponse(res, {
    statusCode: 200,
    data: { greeting: 'Hello, World!' },
    message: 'Welcome to Acorn API',
  });
}

function handleNotFound(res: ServerResponse): void {
  sendJsonResponse(res, {
    statusCode: 404,
    message: 'Not Found',
  });
}

function sendJsonResponse(res: ServerResponse, response: ApiResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(response.statusCode);
  res.end(JSON.stringify(response));
}
