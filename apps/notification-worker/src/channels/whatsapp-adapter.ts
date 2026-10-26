import type { NotificationChannelAdapter, NotificationMessage, SendResult } from './types.js';

export class WhatsAppChannelAdapter implements NotificationChannelAdapter {
  public readonly channel = 'WHATSAPP' as const;

  constructor(
    private readonly apiKey?: string,
    private readonly phoneNumberId?: string,
  ) {}

  async send(message: NotificationMessage): Promise<SendResult> {
    if (!message.recipient || message.recipient.trim().length === 0) {
      return {
        success: false,
        errorMessage: 'Recipient phone number cannot be empty',
      };
    }

    // In production, would invoke Meta Cloud API: https://graph.facebook.com/v19.0/{phone_number_id}/messages
    const providerMessageId = `wamid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      success: true,
      providerMessageId,
    };
  }
}
