export interface SendWhatsAppTextMessageParams {
  readonly toPhoneE164: string;
  readonly text: string;
  readonly phoneNumberId?: string;
}

export interface SendWhatsAppButtonOption {
  readonly id: string;
  readonly title: string;
}

export interface SendWhatsAppButtonsParams {
  readonly toPhoneE164: string;
  readonly bodyText: string;
  readonly buttons: readonly SendWhatsAppButtonOption[];
  readonly phoneNumberId?: string;
}

export interface WhatsAppOutboundClient {
  sendTextMessage(params: SendWhatsAppTextMessageParams): Promise<{ messageId: string }>;
  sendButtonsMessage(params: SendWhatsAppButtonsParams): Promise<{ messageId: string }>;
}

export interface HttpWhatsAppOutboundClientOptions {
  readonly apiToken: string;
  readonly baseUrl?: string;
  readonly defaultPhoneNumberId?: string;
}

export class HttpWhatsAppOutboundClient implements WhatsAppOutboundClient {
  private readonly baseUrl: string;

  constructor(private readonly options: HttpWhatsAppOutboundClientOptions) {
    this.baseUrl = options.baseUrl ?? 'https://graph.facebook.com/v19.0';
  }

  async sendTextMessage(params: SendWhatsAppTextMessageParams): Promise<{ messageId: string }> {
    const phoneNumberId = params.phoneNumberId ?? this.options.defaultPhoneNumberId;
    if (!phoneNumberId) {
      throw new Error('phoneNumberId is required to send WhatsApp message');
    }

    const cleanTo = params.toPhoneE164.replace(/^\+/, '');
    const url = `${this.baseUrl}/${encodeURIComponent(phoneNumberId)}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'text',
      text: {
        preview_url: false,
        body: params.text,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WhatsApp API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    const messageId = data.messages?.[0]?.id ?? 'mock-wamid-' + Date.now();
    return { messageId };
  }

  async sendButtonsMessage(params: SendWhatsAppButtonsParams): Promise<{ messageId: string }> {
    const phoneNumberId = params.phoneNumberId ?? this.options.defaultPhoneNumberId;
    if (!phoneNumberId) {
      throw new Error('phoneNumberId is required to send WhatsApp message');
    }

    const cleanTo = params.toPhoneE164.replace(/^\+/, '');
    const url = `${this.baseUrl}/${encodeURIComponent(phoneNumberId)}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: params.bodyText,
        },
        action: {
          buttons: params.buttons.map((b) => ({
            type: 'reply',
            reply: {
              id: b.id,
              title: b.title.slice(0, 20), // Meta 20 char limit
            },
          })),
        },
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WhatsApp API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    const messageId = data.messages?.[0]?.id ?? 'mock-wamid-' + Date.now();
    return { messageId };
  }
}
