/**
 * Consumer Inbox Deduplication Repository
 * Conforms to ADR-009 (Transactional Outbox & Consumer Inbox Pattern)
 */

export interface InboxRepositoryPort {
  recordProcessed(eventId: string, consumerName: string): Promise<boolean>;
  isProcessed(eventId: string, consumerName: string): Promise<boolean>;
}

export class InMemoryInboxRepository implements InboxRepositoryPort {
  private readonly processed = new Set<string>();

  async recordProcessed(eventId: string, consumerName: string): Promise<boolean> {
    const key = `${consumerName}:${eventId}`;
    if (this.processed.has(key)) {
      return false; // Already processed duplicate
    }
    this.processed.add(key);
    return true; // Successfully recorded new event
  }

  async isProcessed(eventId: string, consumerName: string): Promise<boolean> {
    const key = `${consumerName}:${eventId}`;
    return this.processed.has(key);
  }
}
