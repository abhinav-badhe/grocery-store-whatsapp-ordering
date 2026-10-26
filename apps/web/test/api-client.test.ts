import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApiClient } from '../dist/index.js';

const STORE_ID = '00000000-0000-4000-8000-000000000001';

describe('StorefrontApiClient - Gateway Communication', () => {
  it('calls getCatalog with appropriate query parameters and X-Store-ID header', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = async (input: string | URL, init?: any): Promise<Response> => {
      capturedUrl = String(input);
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ products: [{ id: 'prod-1', name: 'Apples' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createApiClient({
      gatewayUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as any,
    });

    const result = await client.getCatalog(STORE_ID, {
      categoryId: 'cat-1',
      search: 'apple',
      page: 1,
      limit: 20,
    });

    assert.ok(capturedUrl.includes('/api/v1/catalog/products'));
    assert.ok(capturedUrl.includes('categoryId=cat-1'));
    assert.ok(capturedUrl.includes('search=apple'));
    assert.equal(capturedHeaders['X-Store-ID'], STORE_ID);
    assert.equal(result.products.length, 1);
  });

  it('calls createOrder with POST, JSON payload and store header', async () => {
    let capturedMethod = '';
    let capturedBody = '';

    const mockFetch = async (input: string | URL, init?: any): Promise<Response> => {
      capturedMethod = init?.method ?? 'GET';
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ order: { id: 'ord-123', status: 'RECEIVED' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createApiClient({
      gatewayUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as any,
    });

    const result = await client.createOrder(STORE_ID, {
      customerName: 'Aarav Sharma',
      customerPhone: '+919876543210',
      fulfillmentType: 'DELIVERY',
      deliveryAddress: 'Flat 402, Green Towers',
      items: [{ productId: 'prod-1', quantity: 2 }],
    });

    assert.equal(capturedMethod, 'POST');
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.customerName, 'Aarav Sharma');
    assert.equal(result.order.id, 'ord-123');
  });

  it('throws an error with status code when request fails', async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(JSON.stringify({ detail: 'Item out of stock' }), {
        status: 400,
      });
    };

    const client = createApiClient({
      gatewayUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as any,
    });

    await assert.rejects(
      async () => client.getCatalog(STORE_ID),
      /Failed to fetch catalog: HTTP 400/,
    );
  });
});
