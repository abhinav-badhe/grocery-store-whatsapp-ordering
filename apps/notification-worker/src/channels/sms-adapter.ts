import type { NotificationChannelAdapter, NotificationMessage, SendResult } from './types.js';

export class SmsChannelAdapter implements NotificationChannelAdapter {
  public readonly channel = 'SMS' as const;

  async send(message: NotificationMessage): Promise<SendResult> {
    if (!message.recipient || message.recipient.trim().length === 0) {
      return {
        success: false,
        errorMessage: 'Recipient phone number cannot be empty',
      };
    }

    return {
      success: true,
      providerMessageId: `sms_${Date.now().toString(36)}`,
    };
  }
}
