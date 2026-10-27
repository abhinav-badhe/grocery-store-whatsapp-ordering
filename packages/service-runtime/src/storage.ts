/**
 * Object Storage Abstraction (StorageServicePort)
 * Conforms to ADR-008 (Ephemeral Container Storage & Durable Object Storage)
 */

export interface PresignedUploadParams {
  readonly storeId: string;
  readonly fileKey: string;
  readonly contentType: string;
  readonly contentLengthBytes?: number;
  readonly expiresInSeconds?: number;
}

export interface PresignedUrlResult {
  readonly uploadUrl: string;
  readonly fileKey: string;
  readonly expiresAt: string;
  readonly headers?: Record<string, string>;
}

export interface PresignedDownloadParams {
  readonly storeId: string;
  readonly fileKey: string;
  readonly expiresInSeconds?: number;
}

export interface UploadBufferParams {
  readonly storeId: string;
  readonly fileKey: string;
  readonly buffer: Buffer;
  readonly contentType: string;
}

export interface UploadResult {
  readonly fileKey: string;
  readonly url: string;
  readonly sizeBytes: number;
}

export interface StorageServicePort {
  generatePresignedUploadUrl(params: PresignedUploadParams): Promise<PresignedUrlResult>;
  generatePresignedDownloadUrl(params: PresignedDownloadParams): Promise<string>;
  deleteFile(fileKey: string): Promise<void>;
  uploadBuffer(params: UploadBufferParams): Promise<UploadResult>;
  getFile(fileKey: string): Promise<{ buffer: Buffer; contentType: string } | null>;
}

/**
 * In-Memory Storage Service for Local Development, Testing, and CI
 */
export class InMemoryStorageService implements StorageServicePort {
  private readonly files = new Map<string, { buffer: Buffer; contentType: string }>();

  async generatePresignedUploadUrl(params: PresignedUploadParams): Promise<PresignedUrlResult> {
    const expiresAt = new Date(Date.now() + (params.expiresInSeconds ?? 900) * 1000).toISOString();
    return {
      uploadUrl: `http://localhost:10000/api/v1/storage/upload?key=${encodeURIComponent(params.fileKey)}`,
      fileKey: params.fileKey,
      expiresAt,
      headers: {
        'Content-Type': params.contentType,
      },
    };
  }

  async generatePresignedDownloadUrl(params: PresignedDownloadParams): Promise<string> {
    const file = this.files.get(params.fileKey);
    if (!file) {
      throw new Error(`File not found: ${params.fileKey}`);
    }
    return `http://localhost:10000/api/v1/storage/download?key=${encodeURIComponent(params.fileKey)}`;
  }

  async deleteFile(fileKey: string): Promise<void> {
    this.files.delete(fileKey);
  }

  async uploadBuffer(params: UploadBufferParams): Promise<UploadResult> {
    this.files.set(params.fileKey, {
      buffer: params.buffer,
      contentType: params.contentType,
    });
    return {
      fileKey: params.fileKey,
      url: `http://localhost:10000/api/v1/storage/download?key=${encodeURIComponent(params.fileKey)}`,
      sizeBytes: params.buffer.length,
    };
  }

  async getFile(fileKey: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const file = this.files.get(fileKey);
    return file ?? null;
  }
}
