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
  products: [],
  destacados: [],
  cotizacion: null,
  orders: [],
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
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (networkErr) {
    throw new Error("No se pudo conectar al servidor.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || data.message || `Error ${res.status}`);
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
  if (name === "carrito") renderCart();
  if (name === "checkout") updateCheckoutTotal();
  if (name === "pedidos") loadOrders();
  if (name === "perfil") loadProfile();

  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.showView = showView;

$$(".nav-links a").forEach((a) =>
  a.addEventListener("click", (e) => { e.preventDefault(); showView(a.dataset.view); })
);

/* ---------- AUTH ---------- */
$("#btn-login").addEventListener("click", () => $("#modal-login").classList.remove("hidden"));
$("#btn-register").addEventListener("click", () => $("#modal-register").classList.remove("hidden"));
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }
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
    state.token = data.token;
    state.user = normalizeUser(data.user || data.usuario);

    localStorage.setItem(TOKEN_KEY, data.token);
    closeModal("modal-login");
    updateAuthUI();
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
  state.token = null;
  state.user = null;
  state.orders = [];
  state.cart = [];
  state.checkoutAttempt = null;
  localStorage.removeItem(TOKEN_KEY);
  updateCartCount();
  updateAuthUI();
  renderProfile();
}

async function restoreSession() {
  if (!state.token) return;
  const token = state.token;
  try {
    const response = await api("/api/usuarios/me");
    if (state.token !== token) return;
    state.user = normalizeUser(response.user);
    state.checkoutAttempt = localStorage.getItem(`techstore_attempt_${state.user.id}`) || null;
  } catch (err) {
    // api clears only an unauthorized session. A transient failure is retryable.
    if (err.status !== 401) toast("No se pudo verificar la sesión. Reintentá desde Perfil.", "error");
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

async function loadProducts(page = 1) {
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
    state.cotizacion = data.cotizacion || null;
    $("#catalog-prev").disabled = !data.pagination?.hasPreviousPage;
    $("#catalog-next").disabled = !data.pagination?.hasNextPage;
    state.products = (data.items || data.productos || []).map((p) => ({
      ...p,
      precio: Number(p.precio),
      stock: Number(p.stock),
    }));
  } catch (err) {
    $("#catalog-prev").disabled = true;
    $("#catalog-next").disabled = true;
    state.products = [];
    state.cotizacion = null;
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

    const imgHtml = imgUrl
      ? `<img src="${imgUrl}" alt="${escapeHtml(p.nombre || "Producto")}" onerror="this.parentElement.innerHTML='<span class=\\'no-img\\'>📦</span>'">`
      : `<span class="no-img">📦</span>`;

    return `
      <div class="destacados-card">
        <div class="destacados-img-wrap">${imgHtml}</div>
        <div class="destacados-body">
          <h3 class="card-title">${escapeHtml(p.nombre || "Sin nombre")}</h3>
          <p class="descripcion-producto">${escapeHtml(p.descripcion || "Sin descripción.")}</p>
          <span class="precio">$${precioFmt}</span>
          <button class="btn-primary" onclick="addToCart('${p.id}')">Agregar al carrito</button>
        </div>
      </div>`;
  }).join("");
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function renderProducts(list) {
  const grid = $("#products-grid");
  if (!list.length) {
    grid.innerHTML = `<p class="empty-msg">No se encontraron productos.</p>`;
    return;
  }

  grid.innerHTML = list.map((p) => {
    const sinStock = p.stock <= 0;
    const stockClass = sinStock ? "out" : p.stock <= 5 ? "low" : "";
    const stockText = sinStock ? "Sin stock" : `Stock: ${p.stock}${p.stock <= 5 ? " ⚠️" : ""}`;
    const usd = p.precioUSD ? `<span class="price-usd">≈ USD ${Number(p.precioUSD).toFixed(2)}</span>` : "";

    const imgSrc = p.image || p.imagen || p.foto;
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" alt="${p.nombre}" style="width: 100%; height: 100%; object-fit: contain;">`
      : "📦";

    return `
    <div class="product-card">
      <div class="product-img">${imgHtml}</div>
      <div class="product-body">
        <h4>${p.nombre}</h4>
        <p class="desc">${p.descripcion || ""}</p>
        <span class="price">$${p.precio.toFixed(2)}</span>
        ${usd}
        <span class="stock ${stockClass}">${stockText}</span>
        <!-- IMPORTANTE: Pasamos el ID entre comillas simples para que no falle si es un string (UUID) -->
        <button class="btn-primary" ${sinStock ? "disabled" : ""} onclick="addToCart('${p.id}')">
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
function addToCart(id) {
  if (state.checkoutAttempt) return toast("Consultá el pedido pendiente antes de modificar el carrito", "info");
  const prod = state.products.find((p) => String(p.id) === String(id)) || state.destacados.find((p) => String(p.id) === String(id));
  if (!prod) return toast("Error: Producto no encontrado", "error");

  const existing = state.cart.find((i) => String(i.id) === String(prod.id));
  if ((existing?.qty || 0) >= Number(prod.stock)) return toast("No hay más stock disponible", "error");
  if (existing) existing.qty++;
  else state.cart.push({ ...prod, qty: 1 });

  updateCartCount();
  toast(`${prod.nombre} agregado 🛒`);
}
window.addToCart = addToCart;

function updateCartCount() {
  const total = state.cart.reduce((s, i) => s + i.qty, 0);
  $("#cart-count").textContent = total;
}

function changeQty(id, delta) {
  if (state.checkoutAttempt) return toast("Consultá el pedido pendiente antes de modificar el carrito", "info");
  const item = state.cart.find((i) => String(i.id) === String(id));
  if (!item) return;
  if (item.qty + delta > Number(item.stock)) return toast("No hay más stock disponible", "error");
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter((i) => String(i.id) !== String(id));
  updateCartCount();
  renderCart();
}
window.changeQty = changeQty;

function removeItem(id) {
  if (state.checkoutAttempt) return toast("Consultá el pedido pendiente antes de modificar el carrito", "info");
  state.cart = state.cart.filter((i) => String(i.id) !== String(id));
  updateCartCount();
  renderCart();
  toast("Producto eliminado", "info");
}
window.removeItem = removeItem;

function cartTotal() {
  return state.cart.reduce((s, i) => s + i.precio * i.qty, 0);
}

function renderCart() {
  const cont = $("#cart-items");
  const footer = $("#cart-footer");

  if (!state.cart.length) {
    cont.innerHTML = `<p class="empty-msg">Tu carrito está vacío</p>`;
    footer.classList.add("hidden");
    return;
  }

  cont.innerHTML = state.cart.map((i) => `
    <div class="cart-item">
      <div class="thumb">${emojiFor(i)}</div>
      <div class="info">
        <strong>${i.nombre}</strong>
        <small>$${i.precio.toFixed(2)} c/u</small>
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

/* ---------- CHECKOUT ---------- */
function setCheckoutAttempt(value) {
  state.checkoutAttempt = value;
  const key = `techstore_attempt_${state.user.id}`;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

function updateCheckoutTotal() {
  $("#checkout-total").textContent = cartTotal().toFixed(2);
}

$("#checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (state.checkoutBusy) return;
  if (state.token && !state.user) await restoreSession();
  if (state.checkoutBusy) return;
  if (!state.token || !state.user) {
    toast("Iniciá sesión para comprar", "error");
    $("#modal-login").classList.remove("hidden");
    return;
  }
  if (!state.cart.length && !state.checkoutAttempt) return toast("Tu carrito está vacío", "error");

  const body = {
    items: state.cart.map((i) => ({ productId: i.id, quantity: i.qty })),
  };

  state.checkoutBusy = true;
  const button = $("#checkout-form button[type=submit]");
  button.disabled = true;
  try {
    let pedido;
    if (state.checkoutAttempt) {
      // Never create a second order after an ambiguous result.
      pedido = await api(`/api/pedidos/operaciones/${encodeURIComponent(state.checkoutAttempt)}`);
    } else {
      setCheckoutAttempt(crypto.randomUUID());
      pedido = await api("/api/pedidos", {
        method: "POST",
        headers: { "Idempotency-Key": state.checkoutAttempt },
        body: JSON.stringify(body),
      });
    }
    if (["confirmed", "paid"].includes(pedido.estado)) {
      state.cart = [];
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
    if (state.user && [400, 409, 422].includes(err.status)) setCheckoutAttempt(null);
    toast(err.message + (state.checkoutAttempt ? " Volvé a confirmar para consultar el intento, sin duplicarlo." : ""), "error");
  } finally {
    state.checkoutBusy = false;
    button.disabled = false;
  }
});

/* ---------- PEDIDOS ---------- */
async function loadOrders() {
  const cont = $("#orders-list");
  if (!state.token) {
    cont.innerHTML = `<p class="empty-msg">Iniciá sesión para ver tus pedidos.</p>`;
    return;
  }
  cont.innerHTML = `<p class="empty-msg">Cargando pedidos...</p>`;

  try {
    const pedidos = await api("/api/pedidos");
    state.orders = Array.isArray(pedidos) ? pedidos : [];
    renderOrders(state.orders);
  } catch (err) {
    cont.innerHTML = `<p class="empty-msg">No se pudieron cargar los pedidos: ${err.message}</p>`;
  }
}

function renderOrders(list) {
  const cont = $("#orders-list");
  if (!list.length) {
    cont.innerHTML = `<p class="empty-msg">No tenés pedidos todavía.</p>`;
    return;
  }
  cont.innerHTML = list.map((o) => {
    const cancelado = ["cancelado", "cancelled"].includes((o.estado || "").toLowerCase());
    const estado = (o.estado || "pendiente").toUpperCase();
    const fecha = (o.fecha || o.created_at) ? new Date(o.fecha || o.created_at).toLocaleString("es-AR") : "—";
    const items = Array.isArray(o.detalles) ? o.detalles : (Array.isArray(o.items) ? o.items : []);
    const itemsHtml = items.length
      ? `<ul class="items-list">${items.map((it) =>
          `<li>• ${it.nombre_producto || it.nombreProducto || "Producto"} × ${it.cantidad} — $${Number(it.precio_unitario ?? it.precioUnitario ?? 0).toFixed(2)}</li>`
        ).join("")}</ul>`
      : "";
    return `
    <div class="order-card ${cancelado ? "cancelado" : ""}">
      <div class="order-head">
        <span>Pedido #${o.id}</span>
        <span class="status ${cancelado ? "cancelado" : ""}">${estado}</span>
      </div>
      <div class="order-meta">
        <span>Total: <strong>$${Number(o.total).toFixed(2)}</strong></span>
        <span>${fecha}</span>
      </div>
      ${itemsHtml}
      ${["confirmed", "paid"].includes(o.estado) ? `<button class="btn-cancelar" onclick="cancelOrder('${o.id}')">Cancelar pedido</button>` : ""}
    </div>`;
  }).join("");
}

async function cancelOrder(id) {
  if (!confirm("¿Cancelar este pedido? El stock se restaura.")) return;
  try {
    await api(`/api/pedidos/${encodeURIComponent(id)}/cancelar`, { method: "PATCH" });
    toast("Pedido cancelado", "info");
    loadOrders();
  } catch (err) {
    toast(err.message, "error");
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

$("#cliente-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.token || !state.user) return toast("Iniciá sesión para editar tu perfil", "error");
  const body = {
    name: $("#cl-nombre").value.trim(),
    apellido: $("#cl-apellido").value.trim(),
    dni: $("#cl-dni").value.trim() || null,
    telefono: $("#cl-telefono").value.trim() || null,
    direccion: $("#cl-direccion").value.trim() || null,
  };
  try {
    const response = await api("/api/usuarios/me", { method: "PUT", body: JSON.stringify(body) });
    state.user = normalizeUser(response.user);
    renderProfile();
    toast("Perfil actualizado");
  } catch (err) {
    toast(err.message, "error");
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
