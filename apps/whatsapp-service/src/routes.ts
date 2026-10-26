import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import type { HttpRequestHandler } from '@grocery/service-runtime';
import type { RequestContext } from '@grocery/observability';
import { MetaWebhookPayloadSchema, type WhatsAppInboundMessage } from '@grocery/api-contracts';
import type { ConversationCoordinator } from './coordinator/conversation-coordinator.js';

export interface WhatsAppRoutesOptions {
  readonly coordinator: ConversationCoordinator;
  readonly verifyToken: string;
  readonly appSecret: string;
}

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024; // 256 KiB

async function readRawBody(
  req: IncomingMessage,
  maxBytes = MAX_WEBHOOK_BODY_BYTES,
): Promise<{ rawString: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    let exceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        exceeded = true;
        reject(new Error(`Payload too large: exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (exceeded) return;
      const buffer = Buffer.concat(chunks);
      resolve({
        rawString: buffer.toString('utf8'),
        buffer,
      });
    });

    req.on('error', (err) => reject(err));
  });
}

function verifyHubSignature(
  rawBuffer: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSig = signatureHeader.slice('sha256='.length).trim();
  const hmac = crypto.createHmac('sha256', appSecret);
  hmac.update(rawBuffer);
  const actualSig = hmac.digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(actualSig, 'utf8'), Buffer.from(expectedSig, 'utf8'));
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

export function createWhatsAppRoutes(options: WhatsAppRoutesOptions): HttpRequestHandler {
  const { coordinator, verifyToken, appSecret } = options;

  return async (req: IncomingMessage, res: ServerResponse, _context: RequestContext) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    // 1. Meta Webhook Handshake (GET /api/v1/whatsapp/webhook or /webhook)
    if (method === 'GET' && (pathname === '/api/v1/whatsapp/webhook' || pathname === '/webhook')) {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === verifyToken && challenge) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.statusCode = 200;
        res.end(challenge);
        return;
      }

      sendJson(res, 403, {
        type: 'https://tools.ietf.org/html/rfc7807',
        title: 'Forbidden',
        status: 403,
        detail: 'Invalid verify token or handshake mode',
        code: 'INVALID_VERIFY_TOKEN',
      });
      return;
    }

    // 2. Meta Webhook Inbound Event Ingestion (POST /api/v1/whatsapp/webhook or /webhook)
    if (method === 'POST' && (pathname === '/api/v1/whatsapp/webhook' || pathname === '/webhook')) {
      const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;

      let rawString = '';
      let rawBuffer: Buffer;
      try {
        const body = await readRawBody(req);
        rawString = body.rawString;
        rawBuffer = body.buffer;
      } catch (err) {
        sendJson(res, 413, {
          type: 'https://tools.ietf.org/html/rfc7807',
          title: 'Payload Too Large',
          status: 413,
          detail: err instanceof Error ? err.message : String(err),
          code: 'PAYLOAD_TOO_LARGE',
        });
        return;
      }

      // Verify HMAC-SHA256 signature
      if (!verifyHubSignature(rawBuffer, signatureHeader, appSecret)) {
        sendJson(res, 401, {
          type: 'https://tools.ietf.org/html/rfc7807',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid or missing X-Hub-Signature-256 signature',
          code: 'INVALID_SIGNATURE',
        });
        return;
      }

      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(rawString);
      } catch {
        sendJson(res, 400, {
          type: 'https://tools.ietf.org/html/rfc7807',
          title: 'Bad Request',
          status: 400,
          detail: 'Malformed JSON payload',
          code: 'INVALID_JSON',
        });
        return;
      }

      // Validate payload schema against Meta WhatsApp webhook schema
      const parseResult = MetaWebhookPayloadSchema.safeParse(parsedPayload);
      if (!parseResult.success) {
        // Return 200 to acknowledge unhandled notification types (e.g. status updates) per Meta requirements
        sendJson(res, 200, {
          received: true,
          status: 'ignored_unsupported_schema',
        });
        return;
      }

      const webhookData = parseResult.data;
      const processingOutcomes: Array<{ messageId: string; outcome: string }> = [];

      for (const entry of webhookData.entry) {
        for (const change of entry.changes) {
          const val = change.value;
          const phoneNumberId = val.metadata.phone_number_id;

          if (!val.messages || val.messages.length === 0) {
            continue;
          }

          for (const msg of val.messages) {
            let messageType: 'text' | 'interactive' | 'unsupported' = 'unsupported';
            if (msg.type === 'text') {
              messageType = 'text';
            } else if (msg.type === 'interactive') {
              messageType = 'interactive';
            }

            const fromPhone = msg.from.startsWith('+') ? msg.from : `+${msg.from}`;

            const interactiveData = msg.interactive as
              | {
                  type: 'button_reply' | 'list_reply';
                  button_reply?: { id: string; title: string };
                  list_reply?: { id: string; title: string; description?: string };
                }
              | undefined;

            const inboundMsg: WhatsAppInboundMessage = {
              providerMessageId: msg.id,
              fromPhoneE164: fromPhone,
              timestamp: msg.timestamp,
              type: messageType,
              text: msg.text?.body,
              interactive: interactiveData
                ? {
                    type: interactiveData.type,
                    buttonReply: interactiveData.button_reply,
                    listReply: interactiveData.list_reply,
                  }
                : undefined,
            };

            try {
              const outcome = await coordinator.processInboundMessage({
                phoneNumberId,
                message: inboundMsg,
                rawPayload: parsedPayload,
              });

              processingOutcomes.push({
                messageId: msg.id,
                outcome: outcome.outcome,
              });
            } catch (err) {
              console.error('ERROR PROCESSING INBOUND MESSAGE:', err);
              throw err;
            }
          }
        }
      }

      sendJson(res, 200, {
        received: true,
        processed: processingOutcomes,
      });
      return;
    }

    // 3. Fallthrough 404
    sendJson(res, 404, {
      type: 'https://tools.ietf.org/html/rfc7807',
      title: 'Not Found',
      status: 404,
      detail: `Cannot ${method} ${pathname}`,
    });
  };
}
