/* =========================================================
   TechStore — Frontend conectado al API Gateway real
   Gateway: https://pp3-ecommerce-api-gateway.onrender.com
   ========================================================= */

const API_BASE = "https://pp3-ecommerce-api-gateway.onrender.com";
const TOKEN_KEY = "techstore_token";

/* ---------- ESTADO ---------- */
let state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  cart: [],
  cartReady: false,
  cartBusy: false,
  products: [],
  destacados: [],
  cotizacion: null,
  orders: [],
  paymentBusy: false,
  cancellationBusy: false,
  checkoutBusy: false,
  checkoutAttempt: null,
  page: 1,
};

/* ---------- HELPERS ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function toast(msg, type = "success") {
  const t = $("#toast");
  if(!t) return;
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 3200);
}

async function api(path, options = {}) {
  const requestToken = state.token;
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  let res;
  let data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
    data = await res.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      if (!res.ok) return {};
      throw new Error("El servidor devolvió una respuesta inválida. Consultá el estado antes de reintentar.");
    });
  } catch (networkErr) {
    if (res && !controller.signal.aborted) throw networkErr;
    throw new Error(controller.signal.aborted ? "El servidor tardó demasiado en responder." : "No se pudo conectar al servidor.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const error = new Error(data.error || data.message || data.mensaje || `Error ${res.status}`);
    error.status = res.status;
    error.data = data;
    if (res.status === 401 && requestToken && state.token === requestToken && path !== "/api/sesiones") clearSession();
    throw error;
  }
  return data;
}

/* ---------- NAVEGACIÓN ---------- */
function showView(name) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  const el = document.getElementById(`view-${name}`);
  if (el) el.classList.add("active");

  if (name === "catalogo") loadProducts();
  if (name === "carrito") loadCart();
  if (name === "checkout") updateCheckoutTotal();
  if (name === "pedidos") loadOrders();
  if (name === "perfil") loadProfile();

  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.showView = showView;

$$("a[data-view]").forEach((a) =>
  a.addEventListener("click", (e) => { e.preventDefault(); showView(a.dataset.view); })
);

/* ---------- AUTH ---------- */
$("#btn-login").addEventListener("click", () => $("#modal-login").classList.remove("hidden"));
$("#btn-register").addEventListener("click", () => $("#modal-register").classList.remove("hidden"));
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  if (id === "modal-receipt") {
    ++receiptRequest;
    $("#receipt-content").textContent = "";
  }
}
window.closeModal = closeModal;

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;

  try {
    const data = await api("/api/sesiones", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (!data.token || !(data.user || data.usuario)) throw new Error("Respuesta de sesión inválida");
    const user = normalizeUser(data.user || data.usuario);
    clearSession();
    state.token = data.token;
    state.user = user;
    state.cart = [];
    state.cartReady = false;
    state.checkoutAttempt = null;

    localStorage.setItem(TOKEN_KEY, data.token);
    closeModal("modal-login");
    updateAuthUI();
    await restoreSession();
    showView("perfil");
  } catch (err) {
    toast(err.message, "error");
  }
});

$("#register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("#reg-nombre").value.trim();
  const apellido = $("#reg-apellido") ? $("#reg-apellido").value.trim() : "";
  const email = $("#reg-email").value.trim();
  const password = $("#reg-password").value;

  try {
    // Registro público: nunca enviar role ni credenciales de servicio.
    await api("/api/usuarios", {
      method: "POST",
      body: JSON.stringify({ name: nombre, apellido, email, password }),
    });
    toast("Cuenta creada. Ahora iniciá sesión.");
    closeModal("modal-register");
    $("#login-email").value = email;
    $("#modal-login").classList.remove("hidden");
  } catch (err) {
    toast(err.message, "error");
  }
});

$("#btn-logout").addEventListener("click", () => {
  clearSession();
  toast("Sesión cerrada", "info");
  showView("home");
});

function normalizeUser(user) {
  if (!user || typeof user !== "object") throw new Error("Respuesta de perfil inválida");
  return { ...user, name: user.name ?? user.nombre ?? "", role: user.role ?? user.rol ?? "" };
}

function clearSession() {
  $("#modal-receipt").classList.add("hidden");
  $("#receipt-content").textContent = "";
  state.token = null;
  state.user = null;
  state.orders = [];
  state.cart = [];
  state.cartReady = false;
  state.cartBusy = false;
  state.checkoutBusy = false;
  state.checkoutAttempt = null;
  state.paymentBusy = false;
  state.cancellationBusy = false;
  $("#direccion").value = "";
  $("#coupon-code").value = "";
  localStorage.removeItem(TOKEN_KEY);
  updateCartCount();
  updateAuthUI();
  renderProfile();
  renderCart();
  $("#orders-list").innerHTML = "";
}

async function restoreSession() {
  if (!state.token) return;
  const token = state.token;
  try {
    const response = await api("/api/usuarios/me");
    if (state.token !== token) return;
    state.user = normalizeUser(response.user);
    state.checkoutAttempt = localStorage.getItem(`techstore_attempt_${state.user.id}`) || null;
    if (!state.cartReady) await loadCart();
  } catch (err) {
    // api clears only an unauthorized session. A transient failure is retryable.
    if (state.token === token && err.status !== 401) toast("No se pudo verificar la sesión. Reintentá desde Perfil.", "error");
  }
  updateAuthUI();
}

function updateAuthUI() {
  const logged = !!state.token;
  $("#btn-login").classList.toggle("hidden", logged);
  $("#btn-register").classList.toggle("hidden", logged);
  $("#btn-logout").classList.toggle("hidden", !logged);
}

/* ---------- PRODUCTOS ---------- */
const EMOJIS = { laptops: "💻", audio: "🎧", accesorios: "🖱️", monitores: "🖥️", default: "📦" };
function emojiFor(p) { return EMOJIS[p.categoria] || EMOJIS.default; }

let catalogRequest = 0;
async function loadProducts(page = 1) {
  const request = ++catalogRequest;
  state.page = page;
  const grid = $("#products-grid");
  grid.innerHTML = `<p class="empty-msg">Cargando productos...</p>`;

  const q = $("#search-input").value.trim();
  const cat = $("#category-select").value;

  const params = new URLSearchParams();
  params.set("page", page);
  if (cat) params.append("categoria", cat);
  if (q) params.append("nombre", q);

  try {
    const data = await api(`/api/productos?${params.toString()}`);
    if (request !== catalogRequest) return;
    state.cotizacion = data.cotizacion || null;
    $("#catalog-prev").disabled = !data.pagination?.hasPreviousPage;
    $("#catalog-next").disabled = !data.pagination?.hasNextPage;
    state.products = (data.items || data.productos || []).map((p) => ({
      ...p,
      precio: Number(p.precio),
      stock: Number(p.stock),
    }));
  } catch (err) {
    if (request !== catalogRequest) return;
    $("#catalog-prev").disabled = true;
    $("#catalog-next").disabled = true;
    state.products = [];
    state.cotizacion = null;
    $("#cotizacion-info").classList.add("hidden");
    grid.innerHTML = `<p class="empty-msg">No se pudo cargar el catálogo. Reintentá en unos instantes.</p>`;
    return;
  }

  const cot = $("#cotizacion-info");
  if (state.cotizacion) {
    cot.textContent = `💵 Dólar: compra $${state.cotizacion.compra} · venta $${state.cotizacion.venta}`;
    cot.classList.remove("hidden");
  } else {
    cot.classList.add("hidden");
  }

  renderProducts(state.products);
}

async function loadCategories() {
  const select = $("#category-select");
  if (!select) return;

  try {
    const categorias = await api("/api/categorias");
    categorias.forEach(cat => {
      const valor = typeof cat === 'string' ? cat : cat.nombre || cat.categoria;
      const option = document.createElement("option");
      option.value = valor;
      option.textContent = valor;
      select.appendChild(option);
    });
  } catch (err) {
    console.warn("Fallo /api/categorias");
  }
}

async function loadDestacados() {
  const grid = document.getElementById("destacados-grid");
  if (!grid) return;

  grid.innerHTML = `<p class="empty-msg">Cargando productos destacados...</p>`;

  let productos = [];
  try {
    const data = await api("/api/productos");
    productos = (data.items || data.productos || []).slice(0, 4);
    state.destacados = productos;
  } catch (err) {
    state.destacados = [];
    grid.innerHTML = `<p class="empty-msg">No se pudieron cargar los destacados.</p>`;
    return;
  }

  if (!productos.length) {
    grid.innerHTML = `<p class="empty-msg">No hay productos destacados.</p>`;
    return;
  }

  grid.innerHTML = productos.map((p) => {
    const imgUrl = p.imagen || p.imagen_url || p.foto || p.image || p.imagenUrl || null;
    const precio = Number(p.precio);
    const precioFmt = isNaN(precio) ? "—" : precio.toFixed(2);

    const imgHtml = safeImageUrl(imgUrl)
      ? `<img src="${safeImageUrl(imgUrl)}" alt="${escapeHtml(p.nombre || "Producto")}">`
      : `<span class="no-img">📦</span>`;

    return `
      <div class="destacados-card">
        <div class="destacados-img-wrap">${imgHtml}</div>
        <div class="destacados-body">
          <h3 class="card-title">${escapeHtml(p.nombre || "Sin nombre")}</h3>
          <p class="descripcion-producto">${escapeHtml(p.descripcion || "Sin descripción.")}</p>
          <span class="precio">$${precioFmt}</span>
          <button class="btn-primary" ${Number(p.stock) > 0 ? "" : "disabled"} onclick="addToCart(${inlineArgument(p.id)})">${Number(p.stock) > 0 ? "Agregar al carrito" : "Sin stock"}</button>
        </div>
      </div>`;
  }).join("");
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function inlineArgument(value) { return escapeHtml(JSON.stringify(String(value))); }
function safeImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, "https://pp3-frontend-alternativo.vercel.app/");
    return ["https:", "http:"].includes(url.protocol) ? escapeHtml(value) : "";
  } catch { return ""; }
}

function renderProducts(list) {
  const grid = $("#products-grid");
  if (!list.length) {
    grid.innerHTML = `<p class="empty-msg">No se encontraron productos.</p>`;
    return;
  }

  grid.innerHTML = list.map((p) => {
    const sinStock = !Number.isFinite(Number(p.stock)) || p.stock <= 0;
    const stockClass = sinStock ? "out" : p.stock <= 5 ? "low" : "";
    const stockText = sinStock ? "Sin stock" : `Stock: ${p.stock}${p.stock <= 5 ? " ⚠️" : ""}`;
    const usd = p.precioUSD ? `<span class="price-usd">≈ USD ${Number(p.precioUSD).toFixed(2)}</span>` : "";

    const imgSrc = safeImageUrl(p.image || p.imagen || p.foto || p.imagen_url || p.imagenUrl);
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" alt="${escapeHtml(p.nombre)}" style="width: 100%; height: 100%; object-fit: contain;">`
      : "📦";

    return `
    <div class="product-card">
      <div class="product-img">${imgHtml}</div>
      <div class="product-body">
        <h4>${escapeHtml(p.nombre)}</h4>
        <p class="desc">${escapeHtml(p.descripcion || "")}</p>
        <span class="price">$${p.precio.toFixed(2)}</span>
        ${usd}
        <span class="stock ${stockClass}">${escapeHtml(stockText)}</span>
        <button class="btn-primary" ${sinStock ? "disabled" : ""} onclick="addToCart(${inlineArgument(p.id)})">
          ${sinStock ? "Sin stock" : "Agregar al carrito"}
        </button>
      </div>
    </div>`;
  }).join("");
}

let searchTimeout;
$("#search-input").addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { loadProducts(); }, 400);
});
$("#category-select").addEventListener("change", () => { loadProducts(); });
$("#catalog-prev").addEventListener("click", () => loadProducts(state.page - 1));
$("#catalog-next").addEventListener("click", () => loadProducts(state.page + 1));

/* ---------- CARRITO ---------- */
async function hydrateCart(response) {
  if (!Array.isArray(response.carrito)) throw new Error("Respuesta de carrito inválida");
  return Promise.all(response.carrito.map(async (item) => {
    const id = String(item.productId);
    const qty = Number(item.quantity);
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(qty) || qty <= 0) throw new Error("Artículo de carrito inválido");
    try {
      const p = await api(`/api/productos/${encodeURIComponent(id)}`);
      const precio = Number(p.precio ?? p.price);
      const stock = Number(p.stock);
      if (!Number.isFinite(precio) || precio < 0 || !Number.isSafeInteger(stock) || stock < 0) throw new Error("Producto inválido");
      return { ...p, id, nombre: p.nombre ?? p.name, precio, stock, qty };
    } catch (err) {
      if (err.status !== 404) throw err;
      return { id, qty, nombre: `Producto ${id} no disponible`, precio: 0, stock: 0, unavailable: true };
    }
  }));
}

async function loadCart() {
  if (state.cartBusy || state.checkoutBusy) return false;
  if (!state.token || !state.user) { renderCart(); return false; }
  const token = state.token;
  state.cartBusy = true;
  try {
    const response = await api("/api/usuarios/me/carrito");
    if (state.token !== token) return false;
    const cart = await hydrateCart(response);
    if (state.token !== token) return false;
    state.cart = cart;
    state.cartReady = true;
    return true;
  } catch (err) {
    if (state.token === token) {
      state.cartReady = false;
      toast("No se pudo recuperar el carrito. Reintentá desde Carrito.", "error");
    }
    return false;
  } finally {
    if (state.token === token) state.cartBusy = false;
    updateCartCount();
    renderCart();
  }
}

async function saveCart(cart) {
  const token = state.token;
  try {
    const response = await api("/api/usuarios/me/carrito", {
      method: "PUT",
      body: JSON.stringify({ carrito: cart.map(i => ({ productId: String(i.id), quantity: i.qty })) }),
    });
    if (state.token !== token) return false;
    const saved = await hydrateCart(response);
    if (state.token !== token) return false;
    state.cart = saved;
    state.cartReady = true;
    return true;
  } catch (err) {
    if (state.token === token) state.cartReady = false;
    throw err;
  }
}

async function mutateCart(change) {
  if (state.checkoutAttempt || state.checkoutBusy) return toast("Consultá el pedido pendiente antes de modificar el carrito", "info");
  if (state.cartBusy) return;
  if (!state.token || !state.user) {
    toast("Iniciá sesión para guardar tu carrito", "info");
    $("#modal-login").classList.remove("hidden");
    return;
  }
  if (!state.cartReady && !(await loadCart())) return;
  if (state.cartBusy || state.checkoutAttempt) return;
  const token = state.token;
  state.cartBusy = true;
  try {
    const draft = state.cart.map(i => ({ ...i }));
    if (change(draft) === false) return;
    if (await saveCart(draft)) toast("Carrito guardado");
  } catch (err) {
    toast("No se pudo confirmar el guardado. Recuperá el carrito antes de continuar.", "error");
  } finally {
    if (state.token === token) state.cartBusy = false;
    updateCartCount();
    renderCart();
  }
}

async function addToCart(id) {
  return mutateCart((draft) => {
    const prod = state.products.find(p => String(p.id) === String(id)) || state.destacados.find(p => String(p.id) === String(id));
    if (!prod) { toast("Producto no encontrado", "error"); return false; }
    const existing = draft.find(i => String(i.id) === String(id));
    if (!Number.isSafeInteger(Number(prod.stock)) || Number(prod.stock) <= (existing?.qty || 0)) { toast("No hay más stock disponible", "error"); return false; }
    if (existing) existing.qty++;
    else draft.push({ ...prod, qty: 1 });
  });
}
window.addToCart = addToCart;

function updateCartCount() {
  const total = state.cart.reduce((s, i) => s + i.qty, 0);
  $("#cart-count").textContent = total;
}

async function changeQty(id, delta) {
  return mutateCart(draft => {
    const index = draft.findIndex(i => String(i.id) === String(id));
    if (index < 0) return false;
    const item = draft[index];
    if (delta > 0 && item.qty + delta > item.stock) { toast("No hay más stock disponible", "error"); return false; }
    item.qty += delta;
    if (item.qty <= 0) draft.splice(index, 1);
  });
}
window.changeQty = changeQty;

async function removeItem(id) {
  return mutateCart(draft => {
    const index = draft.findIndex(i => String(i.id) === String(id));
    if (index < 0) return false;
    draft.splice(index, 1);
  });
}
window.removeItem = removeItem;

function cartTotal() {
  return state.cart.reduce((s, i) => s + i.precio * i.qty, 0);
}

function renderCart() {
  const cont = $("#cart-items");
  const footer = $("#cart-footer");
  if (!state.user || !state.cartReady) {
    cont.innerHTML = `<p class="empty-msg">${!state.user ? "Iniciá sesión para recuperar tu carrito." : "Carrito sin verificar. Usá Recuperar carrito para reintentar."}</p>`;
    footer.classList.add("hidden");
    return;
  }

  if (!state.cart.length) {
    cont.innerHTML = `<p class="empty-msg">Tu carrito está vacío</p>`;
    footer.classList.add("hidden");
    return;
  }

  cont.innerHTML = state.cart.map((i) => `
    <div class="cart-item">
      <div class="thumb">${emojiFor(i)}</div>
      <div class="info">
        <strong>${escapeHtml(i.nombre)}</strong>
        <small>${i.unavailable ? "No disponible" : `$${i.precio.toFixed(2)} c/u · Stock: ${i.stock}`}</small>
      </div>
      <div class="controls">
        <button class="qty-btn" onclick="changeQty('${i.id}', -1)">−</button>
        <span>${i.qty}</span>
        <button class="qty-btn" onclick="changeQty('${i.id}', 1)">+</button>
      </div>
      <strong class="subtotal">$${(i.precio * i.qty).toFixed(2)}</strong>
      <button class="remove" onclick="removeItem('${i.id}')" title="Quitar">🗑️</button>
    </div>`
  ).join("");

  $("#cart-total").textContent = cartTotal().toFixed(2);
  footer.classList.remove("hidden");
}

$("#btn-cart").addEventListener("click", () => showView("carrito"));
$("#cart-reload").addEventListener("click", loadCart);

/* ---------- CHECKOUT ---------- */
function setCheckoutAttempt(value) {
  state.checkoutAttempt = value;
  const key = `techstore_attempt_${state.user.id}`;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

function updateCheckoutTotal() {
  $("#checkout-total").textContent = cartTotal().toFixed(2);
  if (!$("#direccion").value) $("#direccion").value = state.user?.direccion || "";
  $("#direccion").disabled = !!state.checkoutAttempt;
  $("#coupon-code").disabled = !!state.checkoutAttempt;
  $("#direccion").required = !state.checkoutAttempt;
}

$("#checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (state.checkoutBusy || state.cartBusy) return;
  if (state.token && !state.user) await restoreSession();
  if (state.checkoutBusy || state.cartBusy) return;
  if (!state.token || !state.user) {
    toast("Iniciá sesión para comprar", "error");
    $("#modal-login").classList.remove("hidden");
    return;
  }
  if (!state.cart.length && !state.checkoutAttempt) return toast("Tu carrito está vacío", "error");
  if (!state.checkoutAttempt && !state.cartReady && !(await loadCart())) return;
  if (state.checkoutBusy || state.cartBusy || !state.user) return;
  if (!state.checkoutAttempt && (!state.cart.length || state.cart.some(i => i.unavailable || i.qty > i.stock))) return toast("Revisá los productos y el stock del carrito", "error");
  const direccionEntrega = $("#direccion").value.trim();
  if (!state.checkoutAttempt && (!direccionEntrega || [...direccionEntrega].length > 500)) return toast("Ingresá una dirección de hasta 500 caracteres", "error");

  const body = {
    items: state.cart.map((i) => ({ productId: i.id, quantity: i.qty })),
    direccionEntrega,
    couponCode: $("#coupon-code").value.trim().toUpperCase() || null,
  };

  state.checkoutBusy = true;
  const checkoutToken = state.token;
  const button = $("#checkout-form button[type=submit]");
  button.disabled = true;
  let submitted = false;
  let confirmed = false;
  try {
    let pedido;
    if (state.checkoutAttempt) {
      // Never create a second order after an ambiguous result.
      pedido = await api(`/api/pedidos/operaciones/${encodeURIComponent(state.checkoutAttempt)}`);
    } else {
      setCheckoutAttempt(crypto.randomUUID());
      submitted = true;
      pedido = await api("/api/pedidos", {
        method: "POST",
        headers: { "Idempotency-Key": state.checkoutAttempt },
        body: JSON.stringify(body),
      });
    }
    if (state.token !== checkoutToken) return;
    pedido = pedido.pedido || pedido;
    if (["confirmed", "paid", "shipped", "delivered"].includes(pedido.estado)) {
      confirmed = true;
      // Keep the confirmed attempt until the API has acknowledged cart cleanup.
      // Retrying after a failed cleanup queries this order instead of creating another.
      if (!(await saveCart([]))) return;
      setCheckoutAttempt(null);
      updateCartCount();
      toast(`Pedido #${pedido.id} confirmado`);
      showView("pedidos");
    } else if (["rejected", "cancelled"].includes(pedido.estado)) {
      setCheckoutAttempt(null);
      toast("El pedido no fue confirmado. Revisá tu carrito.", "error");
    } else {
      toast("Pedido pendiente. Volvé a confirmar para consultar su estado.", "info");
    }
  } catch (err) {
    if (state.token !== checkoutToken) return;
    if (submitted && !confirmed && !err.data?.uncertain && [400, 409, 422].includes(err.status)) setCheckoutAttempt(null);
    toast(err.message + (state.checkoutAttempt ? " Volvé a confirmar para consultar el intento, sin duplicarlo." : ""), "error");
  } finally {
    if (state.token === checkoutToken) state.checkoutBusy = false;
    button.disabled = false;
    updateCheckoutTotal();
  }
});

/* ---------- PEDIDOS ---------- */
let ordersRequest = 0;
async function loadOrders() {
  const request = ++ordersRequest;
  const cont = $("#orders-list");
  const token = state.token;
  if (!state.token) {
    cont.innerHTML = `<p class="empty-msg">Iniciá sesión para ver tus pedidos.</p>`;
    return;
  }
  cont.innerHTML = `<p class="empty-msg">Cargando pedidos...</p>`;

  try {
    const pedidos = await api("/api/pedidos");
    if (state.token !== token || request !== ordersRequest) return;
    if (!Array.isArray(pedidos)) throw new Error("Respuesta de pedidos inválida");
    state.orders = pedidos;
    renderOrders(state.orders);
  } catch (err) {
    if (state.token !== token || request !== ordersRequest) return;
    cont.innerHTML = `<p class="empty-msg">No se pudieron cargar los pedidos: ${escapeHtml(err.message)}</p>`;
  }
}

function renderOrders(list) {
  const cont = $("#orders-list");
  if (!list.length) {
    cont.innerHTML = `<p class="empty-msg">No tenés pedidos todavía.</p>`;
    return;
  }
  cont.innerHTML = list.map((o) => {
    // The orders contract uses numeric IDs, including in selector attributes.
    if (!/^\d+$/.test(String(o.id))) return "";
    const cancelado = ["cancelado", "cancelled"].includes((o.estado || "").toLowerCase());
    const estado = (o.estado || "pendiente").toUpperCase();
    const fecha = (o.fecha || o.created_at) ? new Date(o.fecha || o.created_at).toLocaleString("es-AR") : "—";
    const items = Array.isArray(o.detalles) ? o.detalles : (Array.isArray(o.items) ? o.items : []);
    const itemsHtml = items.length
      ? `<ul class="items-list">${items.map((it) =>
          `<li>• ${escapeHtml(it.nombre_producto || it.nombreProducto || "Producto")} × ${escapeHtml(it.cantidad)} — $${Number(it.precio_unitario ?? it.precioUnitario ?? 0).toFixed(2)}</li>`
        ).join("")}</ul>`
      : "";
    return `
    <div class="order-card ${cancelado ? "cancelado" : ""}">
      <div class="order-head">
        <span>Pedido #${o.id}</span>
        <span class="status ${cancelado ? "cancelado" : ""}">${escapeHtml(estado)}</span>
      </div>
      <div class="order-meta">
        <span>Total: <strong>$${Number(o.total).toFixed(2)}</strong></span>
        <span>Dirección: ${escapeHtml(o.direccionEntrega ?? o.direccion_entrega ?? "Sin dirección registrada")}</span>
        <span>Cupón: ${escapeHtml(o.couponCode ?? o.cuponCodigo ?? "Sin cupón")}</span>
        <span>Descuento: $${Number(o.descuento || 0).toFixed(2)}</span>
        <span>${fecha}</span>
      </div>
      ${itemsHtml}
      <button class="btn-secondary" onclick="loadOrderDetail('${o.id}')">Ver detalle</button>
      ${o.estado === "confirmed" ? `<div class="order-payment">
        <p>Pago simulado para la demo. No ingreses datos bancarios.</p>
        <label>Método <select id="payment-method-${o.id}"><option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia</option></select></label>
        <label>Resultado <select id="payment-result-${o.id}"><option value="aprobado">Aprobado</option><option value="rechazado">Rechazado</option></select></label>
        <button class="btn-primary" id="payment-button-${o.id}" onclick="payOrder('${o.id}')">Pagar pedido</button>
      </div>` : ""}
      ${["paid", "shipped", "delivered"].includes(o.estado) ? `<button class="btn-secondary" onclick="loadOrderReceipt('${o.id}')">Ver comprobante</button>` : ""}
      ${o.estado === "confirmed" ? `<button class="btn-cancelar" onclick="cancelOrder('${o.id}')">Cancelar pedido</button>` : ""}
    </div>`;
  }).join("");
}

async function loadOrderDetail(id) {
  if (!state.token) return;
  const request = ++ordersRequest;
  const token = state.token;
  try {
    const order = await api(`/api/pedidos/${encodeURIComponent(id)}`);
    if (state.token !== token || request !== ordersRequest) return;
    renderOrders([order]);
  } catch (err) {
    if (state.token === token && request === ordersRequest) toast(err.message, "error");
  }
}
window.loadOrderDetail = loadOrderDetail;

async function payOrder(id) {
  if (!state.token || state.paymentBusy || state.cancellationBusy || !/^\d+$/.test(String(id))) return;
  const token = state.token;
  const button = $(`#payment-button-${id}`);
  const body = {
    metodo: $(`#payment-method-${id}`).value,
    resultadoSimulado: $(`#payment-result-${id}`).value,
  };
  if (!confirm("¿Confirmar este pago simulado?")) return;
  state.paymentBusy = true;
  button.disabled = true;
  try {
    const result = await api(`/api/pedidos/${encodeURIComponent(id)}/pagar`, {
      method: "POST", body: JSON.stringify(body),
    });
    if (state.token !== token) return;
    const approved = result.estadoPedido === "Pagado" && !!result.comprobante;
    toast(result.mensaje || (approved ? "Pago aprobado" : "Pago no aprobado"), approved ? "success" : "error");
    await loadOrders();
  } catch (err) {
    if (state.token !== token) return;
    toast(`${err.message} Consultá el estado del pedido antes de volver a pagar.`, "error");
    await loadOrders();
  } finally {
    if (state.token === token) state.paymentBusy = false;
    button.disabled = false;
  }
}
window.payOrder = payOrder;

let receiptRequest = 0;
async function loadOrderReceipt(id) {
  if (!state.token) return;
  const token = state.token;
  const request = ++receiptRequest;
  $("#modal-receipt").classList.add("hidden");
  $("#receipt-content").textContent = "";
  try {
    const receipt = await api(`/api/pedidos/${encodeURIComponent(id)}/comprobante`);
    if (state.token !== token || request !== receiptRequest) return;
    if (!receipt?.numero || receipt.total == null || !Number.isFinite(Number(receipt.total))) throw new Error("Respuesta de comprobante inválida");
    const products = Array.isArray(receipt.productos) ? receipt.productos : [];
    $("#receipt-content").textContent = [
      `Comprobante ${receipt.numero}`, `Pedido #${receipt.pedidoId}`,
      receipt.tipoFactura || "Comprobante no fiscal",
      `Fecha: ${receipt.fecha || "—"}`,
      `Cliente: ${receipt.cliente || "—"}`,
      `Método: ${receipt.metodoPago || "—"} — ${receipt.estadoPago || "—"}`,
      ...products.map(item => `${item.nombreProducto} × ${item.cantidad} — $${Number(item.subtotal).toFixed(2)}`),
      `Subtotal: $${Number(receipt.subtotal || 0).toFixed(2)}`,
      `Descuento: $${Number(receipt.descuento || 0).toFixed(2)}`,
      `Cupón: ${receipt.cupon || "Sin cupón"}`,
      `Total: $${Number(receipt.total).toFixed(2)}`,
    ].join("\n");
    $("#modal-receipt").classList.remove("hidden");
  } catch (err) {
    if (state.token === token && request === receiptRequest) toast(err.message, "error");
  }
}
window.loadOrderReceipt = loadOrderReceipt;

async function cancelOrder(id) {
  if (!state.token || state.paymentBusy || state.cancellationBusy) return;
  if (!confirm("¿Solicitar la cancelación de este pedido?")) return;
  const token = state.token;
  state.cancellationBusy = true;
  try {
    const result = await api(`/api/pedidos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ estado: "cancelled" }),
    });
    if (state.token !== token) return;
    const order = result.pedido || result;
    toast(order.estado === "cancelled" ? "Pedido cancelado" : "Cancelación solicitada. Consultá el estado del pedido.", "info");
    await loadOrders();
  } catch (err) {
    if (state.token !== token) return;
    toast(err.message, "error");
    await loadOrders();
  } finally {
    if (state.token === token) state.cancellationBusy = false;
  }
}
window.cancelOrder = cancelOrder;

/* ---------- PERFIL ---------- */
function renderProfile() {
  const user = state.user;
  $("#profile-nombre").textContent = user?.name || "Invitado";
  $("#profile-email").textContent = user?.email || (state.token ? "Sesión pendiente de verificar" : "Sin sesión iniciada");
  $("#profile-rol").textContent = user?.role || "—";
  $("#profile-dni").textContent = user?.dni || "—";
  $("#profile-telefono").textContent = user?.telefono || "—";
  $("#profile-direcciones").innerHTML = `<li>${escapeHtml(user?.direccion || "Sin dirección cargada")}</li>`;
  $("#cliente-form-container").classList.toggle("hidden", !user);
  for (const [id, field] of Object.entries({ nombre: "name", apellido: "apellido", dni: "dni", telefono: "telefono", direccion: "direccion" })) {
    $(`#cl-${id}`).value = user?.[field] || "";
  }
}

async function loadProfile() {
  if (state.token) await restoreSession();
  renderProfile();
}

let profileSaveBusy = false;
$("#cliente-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (profileSaveBusy) return;
  if (!state.token || !state.user) return toast("Iniciá sesión para editar tu perfil", "error");
  const body = {
    name: $("#cl-nombre").value.trim(),
    apellido: $("#cl-apellido").value.trim(),
    dni: $("#cl-dni").value.trim() || null,
    telefono: $("#cl-telefono").value.trim() || null,
    direccion: $("#cl-direccion").value.trim() || null,
  };
  const token = state.token;
  const button = $("#cliente-form button[type=submit]");
  profileSaveBusy = true;
  button.disabled = true;
  try {
    const response = await api("/api/usuarios/me", { method: "PUT", body: JSON.stringify(body) });
    if (state.token !== token) return;
    state.user = normalizeUser(response.user);
    renderProfile();
    toast("Perfil actualizado");
  } catch (err) {
    if (state.token === token) toast(err.message, "error");
  } finally {
    profileSaveBusy = false;
    button.disabled = false;
  }
});

/* ---------- INIT ---------- */
async function init() {
  updateCartCount();
  loadCategories();
  loadDestacados();

  const footerYear = document.getElementById("footer-year");
  if (footerYear) footerYear.textContent = new Date().getFullYear();

  updateAuthUI();
  await restoreSession();
  renderProfile();
}

init();
