const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Run the actual frontend handlers. fetch is intercepted: no production writes.
function harness({ token = 'test-token', storage, respond, cart = { items: [] }, cartRespond, productRespond } = {}) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: id === '#direccion' ? 'Test address 123' : '', innerHTML: '', textContent: '', disabled: false,
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
    }, URL, URLSearchParams, AbortController, crypto: { randomUUID: () => 'test-attempt' },
    setTimeout: () => 0, clearTimeout() {}, console, confirm: () => true,
    fetch: async (url, options) => {
      const call = { path: new URL(url).pathname, query: new URL(url).search, ...options };
      calls.push(call);
      let data;
      if (call.path === '/api/usuarios/me/carrito') {
        if (cartRespond) data = await cartRespond(call);
        else {
          if (call.method === 'PUT') cart.items = JSON.parse(call.body).carrito;
          data = { success: true, carrito: cart.items };
        }
      } else if (/^\/api\/productos\/\d+$/.test(call.path)) {
        data = productRespond ? await productRespond(call) : { id: Number(call.path.split('/').at(-1)), nombre: 'Test', precio: 12, stock: 2 };
      } else data = await response(call);
      return { ok: (data.status || 200) < 400, status: data.status || 200, json: async () => {
        if (data.jsonError) throw new SyntaxError('invalid JSON');
        return data.body ?? data;
      } };
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
  const h = harness({ respond: call => call.path === '/api/usuarios/me' ? { user: { id: 'u1', name: 'Ana', role: 'client' } } : { items: [{ id: 7, nombre: 'Test', precio: 12, stock: 2 }], pagination: { hasNextPage: true } } });
  h.node('#search-input').value = 'Test'; h.node('#category-select').value = 'audio';
  await h.run('restoreSession()');
  await h.run('loadProducts()');
  const catalog = h.calls.find(c => c.path === '/api/productos');
  assert.match(catalog.query, /categoria=audio/);
  assert.match(catalog.query, /nombre=Test/);
  assert.equal(h.node('#catalog-next').disabled, false);
  await h.run('addToCart(7)');
  await h.run('addToCart(7)');
  await h.run('addToCart(7)');
  await h.run('changeQty(7, 1)');
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
  assert.deepEqual(JSON.parse(post.body), { items: [{ productId: 7, quantity: 2 }], direccionEntrega: 'Test address 123', couponCode: null });
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
  assert.equal(h.calls[0].path, '/api/pedidos/9');
  assert.deepEqual(JSON.parse(h.calls[0].body), { estado: 'cancelled' });
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

test('API cart persists add/change/remove across F5; product data is fetched again', async () => {
  const cart = { items: [] };
  const h = harness({ cart });
  await h.run('restoreSession()');
  h.run('state.products = [{ id: 7, nombre: "Test", precio: 12, stock: 2 }]');
  await h.run('addToCart(7)');
  await h.run('changeQty(7, 1)');
  assert.deepEqual(cart.items, [{ productId: '7', quantity: 2 }]);
  const writes = h.calls.filter(c => c.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].headers.Authorization, 'Bearer test-token');
  assert.equal(writes[0].headers['x-service-token'], undefined);
  const reload = harness({ cart, productRespond: () => ({ id: 7, nombre: 'Updated API name', precio: 18, stock: 9 }) });
  await reload.run('restoreSession()');
  assert.equal(reload.run('state.cart[0].qty'), 2);
  assert.equal(reload.run('cartTotal()'), 36);
  assert.equal(reload.run('state.cart[0].nombre'), 'Updated API name');
  await reload.run('removeItem(7)');
  assert.deepEqual(cart.items, []);
  assert.equal(reload.run('state.cart.length'), 0);
});

test('guests cannot create a browser-only cart', async () => {
  const h = harness({ token: null });
  h.run('state.products = [{ id: 7, nombre: "Test", precio: 12, stock: 2 }]');
  await h.run('addToCart(7)');
  assert.equal(h.run('state.cart.length'), 0);
  assert.equal(h.calls.length, 0);
});

test('failed cart GET never writes an empty replacement', async () => {
  const h = harness({ cartRespond: () => ({ status: 503, body: { message: 'offline' } }) });
  await h.run('restoreSession()');
  assert.equal(h.run('state.cartReady'), false);
  assert.equal(h.saved.get('techstore_token'), 'test-token');
  h.run('state.products = [{ id: 7, nombre: "Test", precio: 12, stock: 2 }]');
  await h.run('addToCart(7)');
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 0);
});

test('lost PUT response is reconciled by GET before the next mutation', async () => {
  let persisted = [{ productId: '7', quantity: 1 }];
  let fail = true;
  const h = harness({ cartRespond: call => {
    if (call.method === 'PUT') {
      persisted = JSON.parse(call.body).carrito;
      if (fail) { fail = false; throw Error('response lost'); }
    }
    return { carrito: persisted };
  } });
  await h.run('restoreSession()');
  await h.run('changeQty(7, 1)');
  assert.equal(h.run('state.cartReady'), false);
  assert.equal(h.run('state.cart[0].qty'), 1);
  assert.equal(persisted[0].quantity, 2);
  await h.run('changeQty(7, -1)');
  assert.equal(persisted[0].quantity, 1);
  assert.equal(h.run('state.cartReady'), true);
  const sequence = h.calls.filter(c => c.path.endsWith('/carrito')).map(c => c.method || 'GET');
  assert.deepEqual(sequence, ['GET', 'PUT', 'GET', 'PUT']);
});

test('deleted products stay removable and cannot be bought', async () => {
  const cart = { items: [{ productId: '7', quantity: 1 }] };
  const h = harness({ cart, productRespond: () => ({ status: 404, body: {} }) });
  await h.run('restoreSession()');
  assert.equal(h.run('state.cart[0].unavailable'), true);
  await h.submit('#checkout-form');
  assert.equal(h.calls.some(c => c.method === 'POST'), false);
  await h.run('removeItem(7)');
  assert.deepEqual(cart.items, []);
});

test('checkout sends address/coupon, uses authoritative totals and clears persisted cart', async () => {
  const cart = { items: [{ productId: '7', quantity: 1 }] };
  const order = { id: 9, estado: 'confirmed', total: 10, descuento: 2, direccionEntrega: 'New address 42', cuponCodigo: 'TEST' };
  const h = harness({ cart, respond: call => call.path === '/api/usuarios/me' ? { user: { id: 'u1', name: 'Ana', role: 'client' } } : call.method === 'POST' ? { success: true, pedido: order } : call.path === '/api/pedidos/9' ? order : [order] });
  await h.run('restoreSession()');
  h.node('#direccion').value = ' New address 42 ';
  h.node('#coupon-code').value = ' test ';
  await h.submit('#checkout-form');
  const call = h.calls.find(c => c.method === 'POST');
  assert.deepEqual(JSON.parse(call.body), { items: [{ productId: '7', quantity: 1 }], direccionEntrega: 'New address 42', couponCode: 'TEST' });
  assert.equal(call.headers['x-user-id'], undefined);
  assert.equal(call.headers['x-user-role'], undefined);
  assert.deepEqual(cart.items, []);
  await h.run('loadOrderDetail(9)');
  assert.match(h.node('#orders-list').innerHTML, /New address 42/);
  assert.match(h.node('#orders-list').innerHTML, /TEST/);
  assert.match(h.node('#orders-list').innerHTML, /\$10\.00/);
  assert.match(h.node('#orders-list').innerHTML, /Descuento: \$2\.00/);
});

for (const cleanupStatus of [400, 503]) {
test(`cart cleanup ${cleanupStatus} after confirmation never creates a second order`, async () => {
  let persisted = [{ productId: '7', quantity: 1 }];
  let fail = true;
  const h = harness({ cartRespond: call => {
    if (call.method === 'PUT') {
      if (fail) { fail = false; return { status: cleanupStatus, body: { message: 'cleanup failed' } }; }
      persisted = JSON.parse(call.body).carrito;
    }
    return { carrito: persisted };
  }, respond: call => call.path === '/api/usuarios/me' ? { user: { id: 'u1', name: 'Ana', role: 'client' } } : call.path === '/api/pedidos' && call.method !== 'POST' ? [] : { id: 9, estado: 'confirmed' } });
  await h.run('restoreSession()');
  await h.submit('#checkout-form');
  assert.equal(h.saved.get('techstore_attempt_u1'), 'test-attempt');
  assert.equal(h.run('state.cartReady'), false);
  await h.submit('#checkout-form');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.deepEqual(persisted, []);
  assert.equal(h.saved.has('techstore_attempt_u1'), false);
});
}

test('late cart response after logout cannot restore another session data', async () => {
  let release;
  const h = harness({ cartRespond: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.run('restoreSession()');
  await new Promise(resolve => setImmediate(resolve));
  h.run('clearSession()');
  release({ carrito: [{ productId: '7', quantity: 1 }] });
  await pending;
  assert.equal(h.run('state.user'), null);
  assert.equal(h.run('state.cart.length'), 0);
});

test('payment sends simulation contract and refreshes orders for approval and rejection', async () => {
  for (const approved of [true, false]) {
    const h = harness({ respond: call => call.method === 'POST' ? {
      estadoPedido: approved ? 'Pagado' : 'Pendiente', comprobante: approved ? { numero: 'COMP-1' } : null,
      mensaje: approved ? 'Pago aprobado' : 'Pago rechazado',
    } : [] });
    h.node('#payment-method-9').value = 'transferencia';
    h.node('#payment-result-9').value = approved ? 'aprobado' : 'rechazado';
    await h.run('payOrder(9)');
    assert.equal(h.calls[0].path, '/api/pedidos/9/pagar');
    assert.equal(h.calls[0].method, 'POST');
    assert.equal(h.calls[0].headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(h.calls[0].body), { metodo: 'transferencia', resultadoSimulado: approved ? 'aprobado' : 'rechazado' });
    assert.equal(h.calls[1].path, '/api/pedidos');
    assert.equal(h.node('#toast').className, approved ? 'toast success' : 'toast error');
    assert.equal(h.node('#payment-button-9').disabled, false);
  }
});

test('payment prevents concurrent POSTs and reconciles a lost response without retrying', async () => {
  let release;
  const h = harness({ respond: call => call.method === 'POST' ? new Promise((resolve, reject) => { release = reject; }) : [] });
  h.node('#payment-method-9').value = 'tarjeta';
  h.node('#payment-result-9').value = 'aprobado';
  const pending = h.run('payOrder(9)');
  await h.run('payOrder(9)');
  assert.equal(h.calls.length, 1);
  release(Error('offline'));
  await pending;
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(h.calls[1].path, '/api/pedidos');
  assert.match(h.node('#toast').textContent, /el estado del pedido/);
  assert.equal(h.run('state.paymentBusy'), false);
});

test('receipt uses authenticated GET and renders untrusted values as plain text', async () => {
  const h = harness({ respond: () => ({ numero: 'COMP-1', pedidoId: 9, cliente: '<img onerror=alert(1)>', total: 12, productos: [{ nombreProducto: '<script>', cantidad: 1, subtotal: 12 }] }) });
  await h.run('loadOrderReceipt(9)');
  assert.equal(h.calls[0].path, '/api/pedidos/9/comprobante');
  assert.equal(h.calls[0].headers.Authorization, 'Bearer test-token');
  assert.match(h.node('#receipt-content').textContent, /<script>/);
  assert.equal(h.node('#receipt-content').innerHTML, '');
  h.run('clearSession()');
  assert.equal(h.node('#receipt-content').textContent, '');
});

test('receipt errors show service message and late responses cannot expose another session receipt', async () => {
  const h = harness({ respond: () => ({ status: 404, body: { mensaje: 'Sin comprobante' } }) });
  await h.run('loadOrderReceipt(9)');
  assert.equal(h.node('#toast').textContent, 'Sin comprobante');
  let resolve;
  h.respond(() => new Promise(done => { resolve = done; }));
  const pending = h.run('loadOrderReceipt(9)');
  h.run('clearSession()');
  resolve({ numero: 'PRIVATE', productos: [], total: 12 });
  await pending;
  assert.equal(h.node('#receipt-content').textContent, '');
});

test('order actions follow the payment lifecycle', () => {
  const h = harness();
  for (const estado of ['confirmed', 'paid', 'shipped', 'delivered', 'cancelled']) {
    h.run(`renderOrders([{ id: 9, estado: '${estado}', total: 12 }])`);
    const html = h.node('#orders-list').innerHTML;
    assert.equal(html.includes('Pagar pedido'), estado === 'confirmed');
    assert.equal(html.includes('Ver comprobante'), ['paid', 'shipped', 'delivered'].includes(estado));
  }
});

test('catalog escapes HTML, image attributes and executable ID arguments', () => {
  const h = harness();
  const product = { id: "7');alert(1);//", nombre: '<img src=x onerror=alert(1)>', descripcion: '<script>alert(1)</script>', precio: 12, stock: 2, imagen: 'https://example.invalid/a" onerror="alert(1)' };
  h.run(`renderProducts(${JSON.stringify([product])})`);
  const html = h.node('#products-grid').innerHTML;
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes(' onerror="'));
  const encoded = html.match(/onclick="([^"]+)"/)[1];
  const decoded = encoded.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let observed;
  vm.runInNewContext(decoded, { addToCart: id => { observed = id; }, alert: () => assert.fail('injected JavaScript') });
  assert.equal(observed, product.id);
  assert.equal(h.run('safeImageUrl("javascript:alert(1)")'), '');
  assert.match(h.run('safeImageUrl("img/test.png")'), /img\/test.png/);
});

test('featured cards escape images and disable products without stock', async () => {
  const h = harness({ respond: () => ({ items: [{ id: 7, nombre: '<script>', precio: 12, stock: 0, imagen: 'x" onerror="alert(1)' }] }) });
  await h.run('loadDestacados()');
  const html = h.node('#destacados-grid').innerHTML;
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes(' onerror="'));
  assert.match(html, /disabled/);
});

test('order data and service error messages cannot inject HTML', async () => {
  const h = harness({ respond: () => ({ status: 503, body: { message: '<img src=x onerror=alert(1)>' } }) });
  h.run(`renderOrders(${JSON.stringify([{ id: 9, total: 12, estado: '<script>', detalles: [{ nombreProducto: '<script>', cantidad: '<img>' }] }])})`);
  assert.ok(!h.node('#orders-list').innerHTML.includes('<script>'));
  assert.ok(!h.node('#orders-list').innerHTML.includes('<img>'));
  await h.run('loadOrders()');
  assert.ok(!h.node('#orders-list').innerHTML.includes('<img '));
});

test('late profile save cannot restore personal data after logout', async () => {
  const h = harness();
  await h.run('restoreSession()');
  let release;
  h.respond(() => new Promise(resolve => { release = resolve; }));
  const pending = h.submit('#cliente-form');
  h.run('clearSession()');
  release({ user: { id: 'u1', name: 'Private' } });
  await pending;
  assert.equal(h.run('state.user'), null);
  assert.notEqual(h.node('#profile-nombre').textContent, 'Private');
});

test('the newest catalog request wins even if an older request finishes last', async () => {
  let release;
  const h = harness({ respond: () => new Promise(resolve => { release = resolve; }) });
  const old = h.run('loadProducts()');
  h.respond(() => ({ items: [{ id: 2, nombre: 'New', precio: 12, stock: 1 }] }));
  await h.run('loadProducts(2)');
  release({ items: [{ id: 1, nombre: 'Old', precio: 12, stock: 1 }] });
  await old;
  assert.equal(h.run('state.products[0].id'), 2);
  assert.match(h.node('#products-grid').innerHTML, /New/);
});

test('order detail supersedes a pending order list', async () => {
  let release;
  const h = harness({ respond: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.run('loadOrders()');
  h.respond(() => ({ id: 9, estado: 'paid', total: 12 }));
  await h.run('loadOrderDetail(9)');
  release([{ id: 1, estado: 'confirmed', total: 12 }]);
  await pending;
  assert.match(h.node('#orders-list').innerHTML, /Pedido #9/);
  assert.ok(!h.node('#orders-list').innerHTML.includes('Pedido #1'));
});

test('uncertain checkout conflict retains its key and malformed success never duplicates checkout', async () => {
  for (const response of [{ status: 409, body: { message: 'uncertain', uncertain: true } }, { jsonError: true }]) {
    const h = harness({ cart: { items: [{ productId: '7', quantity: 1 }] } });
    await h.run('restoreSession()');
    h.respond(() => response);
    await h.submit('#checkout-form');
    assert.equal(h.saved.get('techstore_attempt_u1'), 'test-attempt');
    await h.submit('#checkout-form');
    assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
    assert.equal(h.calls.at(-1).path, '/api/pedidos/operaciones/test-attempt');
  }
});

test('receipt closed during loading cannot reopen on a late response', async () => {
  let release;
  const h = harness({ respond: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.run('loadOrderReceipt(9)');
  h.run('closeModal("modal-receipt")');
  release({ numero: 'PRIVATE', total: 12 });
  await pending;
  assert.equal(h.node('#receipt-content').textContent, '');
});

test('pending cancellation is not announced as complete and blocks competing writes', async () => {
  let release;
  const h = harness({ respond: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.run('cancelOrder(9)');
  await h.run('cancelOrder(9)');
  await h.run('payOrder(9)');
  assert.equal(h.calls.length, 1);
  h.respond(() => []);
  release({ estado: 'cancelling' });
  await pending;
  assert.match(h.node('#toast').textContent, /Cancelación solicitada/);
  assert.equal(h.run('state.cancellationBusy'), false);
});

test('invalid JSON on a 401 still clears the session', async () => {
  const h = harness({ respond: () => ({ status: 401, jsonError: true }) });
  await h.run('restoreSession()');
  assert.equal(h.run('state.token'), null);
});

test('HTML has all static JS targets, unique IDs and exported inline handlers', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const js = fs.readFileSync('app.js', 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of js.matchAll(/\$\("#([\w-]+)(?:[ "][^\n]*)?/g)) {
    assert.ok(ids.includes(match[1]), `Missing DOM target ${match[1]}`);
  }
  for (const match of html.matchAll(/onclick="(\w+)\(/g)) {
    assert.ok(js.includes(`window.${match[1]} =`), `Missing exported handler ${match[1]}`);
  }
});

test('concurrent profile submissions send one PUT and release the form afterwards', async () => {
  const h = harness();
  await h.run('restoreSession()');
  let release;
  h.respond(() => new Promise(resolve => { release = resolve; }));
  const pending = h.submit('#cliente-form');
  await h.submit('#cliente-form');
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 1);
  assert.equal(h.node('#cliente-form button[type=submit]').disabled, true);
  release({ user: { id: 'u1', name: 'Saved' } });
  await pending;
  assert.equal(h.node('#cliente-form button[type=submit]').disabled, false);
});

test('late payment from the previous session cannot refresh orders or unlock a new payment', async () => {
  let release;
  const h = harness({ respond: () => new Promise(resolve => { release = resolve; }) });
  h.node('#payment-method-9').value = 'tarjeta';
  h.node('#payment-result-9').value = 'aprobado';
  const pending = h.run('payOrder(9)');
  h.run('clearSession(); state.token = "another-session"; state.paymentBusy = true;');
  release({ estadoPedido: 'Pagado', comprobante: { numero: 'COMP-1' } });
  await pending;
  assert.equal(h.calls.length, 1);
  assert.equal(h.run('state.paymentBusy'), true);
  assert.equal(h.run('state.orders.length'), 0);
});
