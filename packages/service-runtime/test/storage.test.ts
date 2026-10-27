import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageService } from '../dist/index.js';

describe('StorageServicePort & InMemoryStorageService (ADR-008)', () => {
  it('generates presigned upload URL with valid expiration and headers', async () => {
    const storage = new InMemoryStorageService();
    const result = await storage.generatePresignedUploadUrl({
      storeId: '550e8400-e29b-41d4-a716-446655440000',
      fileKey: 'stores/550e8400-e29b-41d4-a716-446655440000/invoices/2026/inv-001.pdf',
      contentType: 'application/pdf',
      expiresInSeconds: 300,
    });

    assert.ok(result.uploadUrl.includes('inv-001.pdf'));
    assert.equal(result.fileKey, 'stores/550e8400-e29b-41d4-a716-446655440000/invoices/2026/inv-001.pdf');
    assert.equal(result.headers?.['Content-Type'], 'application/pdf');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
  });

  it('uploads, downloads, and deletes file buffers correctly', async () => {
    const storage = new InMemoryStorageService();
    const buffer = Buffer.from('%PDF-1.4 Mock Invoice Content');
    const fileKey = 'stores/test-store/invoices/2026/inv-002.pdf';

    const uploadRes = await storage.uploadBuffer({
      storeId: 'test-store',
      fileKey,
      buffer,
      contentType: 'application/pdf',
    });

    assert.equal(uploadRes.fileKey, fileKey);
    assert.equal(uploadRes.sizeBytes, buffer.length);

    const downloadUrl = await storage.generatePresignedDownloadUrl({
      storeId: 'test-store',
      fileKey,
    });
    assert.ok(downloadUrl.includes('inv-002.pdf'));

    const file = await storage.getFile(fileKey);
    assert.ok(file);
    assert.equal(file.contentType, 'application/pdf');
    assert.equal(file.buffer.toString(), buffer.toString());

    await storage.deleteFile(fileKey);
    const deletedFile = await storage.getFile(fileKey);
    assert.equal(deletedFile, null);
  });
});
