const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Run the actual frontend handlers. fetch is intercepted: no production writes.
function harness({ token = 'test-token', storage, respond } = {}) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', innerHTML: '', textContent: '', disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; },
    });
    return nodes.get(id);
  };
  const saved = storage || new Map(token ? [['techstore_token', token]] : []);
  const calls = [];
  let response = respond || (() => ({ user: { id: 'u1', name: 'Test', role: 'client' } }));
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [], getElementById: id => node('#' + id), createElement: () => ({}) },
    window: { scrollTo() {} }, localStorage: {
      getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)), removeItem: k => saved.delete(k),
    }, URLSearchParams, crypto: { randomUUID: () => 'test-attempt' },
    setTimeout: () => 0, clearTimeout() {}, console, confirm: () => true,
    fetch: async (url, options) => {
      const call = { path: new URL(url).pathname, query: new URL(url).search, ...options };
      calls.push(call);
      const data = await response(call);
      return { ok: (data.status || 200) < 400, status: data.status || 200, json: async () => data.body ?? data };
    },
  });
  vm.runInContext(fs.readFileSync('app.js', 'utf8').replace(/init\(\);\s*$/, ''), context);
  return { node, saved, calls, run: code => vm.runInContext(code, context), respond: fn => { response = fn; },
    submit: id => node(id).handlers.submit({ preventDefault() {} }) };
}

test('F5 reads response.user, normalizes legacy fields and sends Bearer', async () => {
  const h = harness({ respond: () => ({ success: true, user: { id: 'u1', nombre: 'Ana', rol: 'client' } }) });
  await h.run('restoreSession()');
  assert.equal(h.run('state.user.name'), 'Ana');
  assert.equal(h.run('state.user.role'), 'client');
  assert.equal(h.calls[0].path, '/api/usuarios/me');
  assert.equal(h.calls[0].headers.Authorization, 'Bearer test-token');
});

for (const failure of ['network', 503, 401]) {
  test(`restoration handles ${failure} without treating transient failure as logout`, async () => {
    const h = harness({ respond: () => { if (failure === 'network') throw Error('offline'); return { status: failure, body: { message: 'failed' } }; } });
    await h.run('restoreSession()');
    assert.equal(h.saved.has('techstore_token'), failure !== 401);
    assert.equal(h.run('state.token'), failure === 401 ? null : 'test-token');
  });
}

test('profile GET/PUT fills the editor and renders saved values, including escaped address', async () => {
  let user = { id: 'u1', name: 'Ana', apellido: 'Test', role: 'client', email: 'ana@example.invalid', dni: null };
  const h = harness({ respond: call => {
    assert.equal(call.path, '/api/usuarios/me');
    if (call.method === 'PUT') {
      const body = JSON.parse(call.body);
      assert.deepEqual(Object.keys(body).sort(), ['apellido', 'direccion', 'dni', 'name', 'telefono']);
      user = { ...user, ...body };
    }
    return { success: true, user };
  } });
  await h.run('loadProfile()');
  assert.equal(h.node('#cl-nombre').value, 'Ana');
  for (const [id, value] of Object.entries({ nombre: 'Editada', apellido: 'Test', dni: '12345678', telefono: '1122334455', direccion: '<calle> 123' })) h.node('#cl-' + id).value = value;
  await h.submit('#cliente-form');
  assert.equal(h.node('#profile-nombre').textContent, 'Editada');
  assert.match(h.node('#profile-direcciones').innerHTML, /&lt;calle&gt;/);
  assert.equal(h.run('state.user.dni'), '12345678');
});

test('login and registration use Gateway payloads', async () => {
  const h = harness({ token: null, respond: call => call.path === '/api/sesiones' ? { token: 'test-token', user: { id: 'u1', name: 'Ana', role: 'client' } } : { success: true, user: { id: 'u1', name: 'Ana', role: 'client' } } });
  h.node('#reg-nombre').value = 'Ana'; h.node('#reg-apellido').value = 'Test';
  h.node('#reg-email').value = 'ana@example.invalid'; h.node('#reg-password').value = 'fake-test-password';
  await h.submit('#register-form');
  assert.deepEqual(JSON.parse(h.calls[0].body), { name: 'Ana', apellido: 'Test', email: 'ana@example.invalid', password: 'fake-test-password' });
  h.node('#login-password').value = 'fake-test-password';
  await h.submit('#login-form');
  assert.equal(h.saved.get('techstore_token'), 'test-token');
  assert.equal(h.calls[1].path, '/api/sesiones');
});

test('catalog items, filters, pagination and stock limits drive the cart', async () => {
  const h = harness({ respond: () => ({ items: [{ id: 7, nombre: 'Test', precio: 12, stock: 2 }], pagination: { hasNextPage: true } }) });
  h.node('#search-input').value = 'Test'; h.node('#category-select').value = 'audio';
  await h.run('loadProducts()');
  assert.match(h.calls[0].query, /categoria=audio/);
  assert.match(h.calls[0].query, /nombre=Test/);
  assert.equal(h.node('#catalog-next').disabled, false);
  h.run('addToCart(7); addToCart(7); addToCart(7); changeQty(7, 1)');
  assert.equal(h.run('cartTotal()'), 24);
  h.respond(() => { throw Error('offline'); });
  await h.run('loadProducts()');
  assert.equal(h.run('state.products.length'), 0);
});

test('pending checkout survives F5, queries attempt and clears cart only on confirmation', async () => {
  const h = harness({ respond: call => call.path === '/api/usuarios/me' ? { user: { id: 'u1', name: 'Ana', role: 'client' } } : { estado: 'pending', uncertain: true } });
  await h.run('restoreSession()');
  h.run('state.cart = [{ id: 7, qty: 2, precio: 12 }]');
  await h.submit('#checkout-form');
  const post = h.calls.find(c => c.method === 'POST');
  assert.equal(post.headers['Idempotency-Key'], 'test-attempt');
  assert.deepEqual(JSON.parse(post.body), { items: [{ productId: 7, quantity: 2 }] });
  assert.equal(h.run('state.cart.length'), 1);
  const reload = harness({ storage: h.saved, respond: call => call.path === '/api/usuarios/me' ? { user: { id: 'u1', name: 'Ana', role: 'client' } } : call.path.includes('/operaciones/') ? { id: 9, estado: 'confirmed' } : [] });
  await reload.run('restoreSession()');
  await reload.submit('#checkout-form');
  assert.equal(reload.calls.some(c => c.method === 'POST'), false);
  assert.ok(reload.calls.some(c => c.path === '/api/pedidos/operaciones/test-attempt'));
  assert.equal(reload.saved.has('techstore_attempt_u1'), false);
});

test('orders render detalles/fecha and cancel through PATCH', async () => {
  const h = harness({ respond: () => [] });
  h.run('renderOrders([{ id: 9, estado: "confirmed", total: 24, fecha: "2026-11-07T12:00:00Z", detalles: [{ nombreProducto: "Test", cantidad: 2, precioUnitario: 12 }] }])');
  assert.match(h.node('#orders-list').innerHTML, /Test/);
  await h.run('cancelOrder(9)');
  assert.equal(h.calls[0].method, 'PATCH');
  assert.equal(h.calls[0].path, '/api/pedidos/9/cancelar');
});

test('failed profile save preserves session and entered form values', async () => {
  const h = harness();
  await h.run('loadProfile()');
  h.node('#cl-nombre').value = 'Unsaved';
  h.respond(() => ({ status: 503, body: { message: 'unavailable' } }));
  await h.submit('#cliente-form');
  assert.equal(h.saved.get('techstore_token'), 'test-token');
  assert.equal(h.node('#cl-nombre').value, 'Unsaved');
  assert.equal(h.run('state.user.name'), 'Test');
});

test('lost checkout response preserves attempt; retry queries without another POST', async () => {
  const h = harness();
  await h.run('restoreSession()');
  h.run('state.cart = [{ id: 7, qty: 1, precio: 12 }]');
  h.respond(() => { throw Error('connection lost after write'); });
  await h.submit('#checkout-form');
  assert.equal(h.run('state.cart.length'), 1);
  assert.equal(h.saved.get('techstore_attempt_u1'), 'test-attempt');
  h.respond(() => ({ estado: 'pending', uncertain: true }));
  await h.submit('#checkout-form');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(h.calls.at(-1).path, '/api/pedidos/operaciones/test-attempt');
  assert.equal(h.node('#checkout-form button[type=submit]').disabled, false);
});
