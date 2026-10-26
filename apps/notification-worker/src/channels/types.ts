import type { NotificationChannel } from '@grocery/database';

export interface NotificationMessage {
  readonly storeId: string;
  readonly outboxId?: string;
  readonly channel: NotificationChannel;
  readonly recipient: string;
  readonly templateName: string;
  readonly variables: Record<string, string>;
  readonly payload?: unknown;
}

export interface SendResult {
  readonly success: boolean;
  readonly providerMessageId?: string;
  readonly errorMessage?: string;
}

export interface NotificationChannelAdapter {
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<SendResult>;
}
