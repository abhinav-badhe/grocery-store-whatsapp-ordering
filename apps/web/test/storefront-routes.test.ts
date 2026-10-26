import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWebService } from '../dist/index.js';

describe('Web Application Storefront Routes & Server Rendering', () => {
  it('serves responsive HTML storefront page on GET /', async () => {
    const service = createWebService({ port: 0 });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Accept: 'text/html' },
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type')?.includes('text/html'));

      const html = await res.text();
      assert.ok(html.includes('<!DOCTYPE html>'));
      assert.ok(html.includes('Local Corner Grocery'));
      assert.ok(html.includes('product-grid'));
      assert.ok(html.includes('Fresh Fuji Apples'));
      assert.ok(html.includes('Organic Whole Milk 1L'));
      assert.ok(html.includes('btn-add-cart'));
    } finally {
      await service.stop();
    }
  });

  it('serves storefront catalog on GET /catalog', async () => {
    const service = createWebService({ port: 0 });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/catalog`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type')?.includes('text/html'));
      const html = await res.text();
      assert.ok(html.includes('Products'));
      assert.ok(html.includes('Fresh Produce'));
    } finally {
      await service.stop();
    }
  });

  it('serves shopkeeper operations console on GET /admin and GET /shopkeeper', async () => {
    const service = createWebService({ port: 0 });
    const { port } = await service.start();

    try {
      const resAdmin = await fetch(`http://127.0.0.1:${port}/admin`);
      assert.equal(resAdmin.status, 200);
      assert.ok(resAdmin.headers.get('content-type')?.includes('text/html'));
      const htmlAdmin = await resAdmin.text();
      assert.ok(htmlAdmin.includes('Shopkeeper & Admin Operations Console'));
      assert.ok(htmlAdmin.includes('Order Processing Queue'));
      assert.ok(htmlAdmin.includes('Stock Balances & Movements Ledger'));

      const resShop = await fetch(`http://127.0.0.1:${port}/shopkeeper`);
      assert.equal(resShop.status, 200);
      assert.ok(resShop.headers.get('content-type')?.includes('text/html'));
    } finally {
      await service.stop();
    }
  });

  it('returns JSON operational payload on GET / when Accept is explicitly application/json', async () => {
    const service = createWebService({ port: 0 });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Accept: 'application/json' },
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type')?.includes('application/json'));

      const data = (await res.json()) as { application: string; status: string };
      assert.equal(data.application, 'web');
      assert.equal(data.status, 'operational');
    } finally {
      await service.stop();
    }
  });

  it('returns 404 Problem Details for unknown routes', async () => {
    const service = createWebService({ port: 0 });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/unknown-path`);
      assert.equal(res.status, 404);

      const data = (await res.json()) as { status: number; title: string };
      assert.equal(data.status, 404);
      assert.equal(data.title, 'Not Found');
    } finally {
      await service.stop();
    }
  });
});
