/* ============================================================
   Ember & Oak — Frontend App Logic
   ============================================================ */

// ── CONFIG ─────────────────────────────────────────────────
const API_BASE = "http://127.0.0.1:5000";

// ── STATE ──────────────────────────────────────────────────
let cart = JSON.parse(localStorage.getItem("eo_cart") || "[]");
let allMenuItems = [];
let currentUser = JSON.parse(localStorage.getItem("eo_user") || "null");
let authToken = localStorage.getItem("eo_token") || null;
let pendingOtpEmail = null;

// ── DOM HELPERS ────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function saveCart() { localStorage.setItem("eo_cart", JSON.stringify(cart)); }

function showToast(msg, duration = 3000) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

function authHeaders() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` };
}

// ── NAV SCROLL ─────────────────────────────────────────────
window.addEventListener("scroll", () => {
  $("#nav").classList.toggle("scrolled", window.scrollY > 40);
});

// ── SESSION HELPERS ────────────────────────────────────────
function clearSession() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem("eo_token");
  localStorage.removeItem("eo_user");
}

// Call after every authenticated fetch — returns true if 401 was handled
function handleApiError(status) {
  if (status === 401) {
    clearSession();
    showToast("Session expired. Please sign in again.");
    showAuthModal("login");
    return true;
  }
  return false;
}

// ── MAIN INIT ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  if (!authToken || !currentUser) {
    showAuthModal("login");
  } else {
    // Silently validate token before loading app
    try {
      const check = await fetch(`${API_BASE}/api/health`, { headers: authHeaders() });
      // health is public, so use orders/my to actually test auth
      const authCheck = await fetch(`${API_BASE}/api/orders/my`, { headers: authHeaders() });
      if (authCheck.status === 401) {
        clearSession();
        showToast("Session expired. Please sign in again.");
        showAuthModal("login");
      } else {
        initApp();
      }
    } catch {
      // Flask not running or network error — still try to load
      initApp();
    }
  }

  $("#authTabLogin")?.addEventListener("click", () => showAuthModal("login"));
  $("#authTabRegister")?.addEventListener("click", () => showAuthModal("register"));
  $("#loginForm")?.addEventListener("submit", handleLogin);
  $("#otpForm")?.addEventListener("submit", handleVerifyOtp);
  $("#registerForm")?.addEventListener("submit", handleRegister);
  $("#logoutBtn")?.addEventListener("click", handleLogout);
});

// ── AUTH MODAL ─────────────────────────────────────────────
function showAuthModal(tab = "login") {
  $("#authModal").style.display = "flex";
  $("#appContent").style.display = "none";
  $("#otpStep").style.display = "none";
  $("#loginStep").style.display = tab === "login" ? "block" : "none";
  $("#registerStep").style.display = tab === "register" ? "block" : "none";
  $("#authTabLogin").classList.toggle("tab--active", tab === "login");
  $("#authTabRegister").classList.toggle("tab--active", tab === "register");
}

function hideAuthModal() {
  $("#authModal").style.display = "none";
  $("#appContent").style.display = "block";
}

function initApp() {
  hideAuthModal();
  updateUserNav();

  const today = new Date().toISOString().split("T")[0];
  if ($("#resDate")) $("#resDate").setAttribute("min", today);
  if (currentUser) {
    if ($("#resName")) $("#resName").value = currentUser.name || "";
    if ($("#resEmail")) $("#resEmail").value = currentUser.email || "";
  }

  loadMenu();
  updateCartUI();

  $("#navOrders")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector("#orders-history").scrollIntoView({ behavior: "smooth" });
    loadMyOrders();
  });

  $("#navReservations")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector("#reservations-history").scrollIntoView({ behavior: "smooth" });
    loadMyReservations();
  });

  $("#orderType")?.addEventListener("change", function() {
    const da = $("#deliveryAddressGroup");
    if (da) da.style.display = this.value === "delivery" ? "block" : "none";
  });

  $("#placeOrderBtn")?.addEventListener("click", handlePlaceOrder);
  $("#reservationForm")?.addEventListener("submit", handleReservation);
  $("#filterOrderDate")?.addEventListener("change", loadMyOrders);
  $("#filterOrderType")?.addEventListener("change", loadMyOrders);
  $("#filterOrderDiet")?.addEventListener("change", loadMyOrders);

  loadMyOrders();
  loadMyReservations();
}

// ── AUTH HANDLERS ──────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Signing in…";
  const msgEl = $("#loginMessage");

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("#loginEmail").value.trim(), password: $("#loginPassword").value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");

    pendingOtpEmail = $("#loginEmail").value.trim();
    $("#loginStep").style.display = "none";
    $("#registerStep").style.display = "none";
    $("#otpStep").style.display = "block";
    $("#otpEmailDisplay").textContent = pendingOtpEmail;
    msgEl.textContent = "";
    startOtpTimer();
  } catch (err) {
    msgEl.className = "form__message form__message--error";
    msgEl.textContent = `✗ ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Continue";
  }
}

async function handleVerifyOtp(e) {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Verifying…";
  const msgEl = $("#otpMessage");

  try {
    const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pendingOtpEmail, otp: $("#otpCode").value.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Invalid OTP");

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("eo_token", authToken);
    localStorage.setItem("eo_user", JSON.stringify(currentUser));
    showToast(`Welcome back, ${currentUser.name}!`);
    initApp();
  } catch (err) {
    msgEl.className = "form__message form__message--error";
    msgEl.textContent = `✗ ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Verify OTP";
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Creating account…";
  const msgEl = $("#registerMessage");

  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: $("#regName").value.trim(),
        email: $("#regEmail").value.trim(),
        password: $("#regPassword").value,
        phone: $("#regPhone").value.trim(),
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");

    msgEl.className = "form__message form__message--success";
    msgEl.textContent = "✓ Account created! Please log in.";
    setTimeout(() => showAuthModal("login"), 1500);
  } catch (err) {
    msgEl.className = "form__message form__message--error";
    msgEl.textContent = `✗ ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Account";
  }
}

function handleLogout() {
  authToken = null; currentUser = null; cart = [];
  localStorage.removeItem("eo_token");
  localStorage.removeItem("eo_user");
  localStorage.removeItem("eo_cart");
  showAuthModal("login");
  showToast("Logged out successfully");
}

function updateUserNav() {
  const nameEl = $("#navUserName");
  if (nameEl && currentUser) nameEl.textContent = currentUser.name;
}

function startOtpTimer() {
  let seconds = 600;
  const timerEl = $("#otpTimer");
  const interval = setInterval(() => {
    seconds--;
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    if (timerEl) timerEl.textContent = `${m}:${s}`;
    if (seconds <= 0) { clearInterval(interval); if (timerEl) timerEl.textContent = "Expired"; }
  }, 1000);
}

// ── FOOD PHOTOS MAP ────────────────────────────────────────
const FOOD_PHOTOS = {
  arancini: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600",
  salmon: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600",
  lamb: "https://images.unsplash.com/photo-1574484284002-952d92456975?w=600",
  rogan: "https://images.unsplash.com/photo-1574484284002-952d92456975?w=600",
  mushroom: "https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=600",
  risotto: "https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=600",
  chocolate: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600",
  fondant: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600",
  lassi: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=600",
  mango: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=600",
  pasta: "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600",
  pizza: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600",
  burger: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600",
  salad: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600",
  soup: "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=600",
  steak: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600",
  chicken: "https://images.unsplash.com/photo-1518492104633-130d0cc84637?w=600",
  cake: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600",
  default: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600"
};

function getFoodPhoto(name, provided_url) {
  if (provided_url) return provided_url;
  const lower = name.toLowerCase();
  for (const [key, url] of Object.entries(FOOD_PHOTOS)) {
    if (lower.includes(key)) return url;
  }
  return FOOD_PHOTOS.default;
}

// ── MENU ───────────────────────────────────────────────────
async function loadMenu() {
  const grid = $("#menuGrid");
  const tabsEl = $("#categoryTabs");

  try {
    const catRes = await fetch(`${API_BASE}/api/menu/categories`);
    if (catRes.ok) {
      const { categories } = await catRes.json();

      const allBtn = document.querySelector('.tab[data-cat="all"]');
      allBtn?.addEventListener("click", () => {
      $$(".tab").forEach(t => t.classList.remove("tab--active"));
      allBtn.classList.add("tab--active");
      renderMenu(allMenuItems);
    });

      categories.forEach(c => {
        const btn = document.createElement("button");
        btn.className = "tab";
        btn.dataset.cat = c.name.toLowerCase();
        btn.textContent = c.name;
        btn.addEventListener("click", () => filterMenu(c.name.toLowerCase(), btn));
        tabsEl.appendChild(btn);
      });
    }

    const res = await fetch(`${API_BASE}/api/menu`);
    if (!res.ok) throw new Error("Failed to load menu");
    const { menu } = await res.json();
    allMenuItems = menu;
    renderMenu(menu);
  } catch (err) {
    grid.innerHTML = `<p class="loader">⚠ Could not load menu. Is the backend running?</p>`;
  }
}

function filterMenu(cat, clickedBtn) {
  $$(".tab").forEach(t => t.classList.remove("tab--active"));
  clickedBtn.classList.add("tab--active");
  const filtered = cat === "all" ? allMenuItems : allMenuItems.filter(i => i.category_name?.toLowerCase() === cat);
  renderMenu(filtered);
}

function renderMenu(items) {
  const grid = $("#menuGrid");
  if (!items.length) { grid.innerHTML = `<p class="loader">No items found.</p>`; return; }
  grid.innerHTML = items.map((item, i) => `
    <div class="menu-card" style="animation-delay:${i * 0.06}s">
      <div class="menu-card__img">
        <img src="${getFoodPhoto(item.name, item.image_url)}" alt="${item.name}" loading="lazy" />
      </div>
      <div class="menu-card__body">
        <p class="menu-card__cat">${item.category_name || ""}
          ${item.is_vegan ? '<span class="badge badge--vegan">Vegan</span>' : item.is_vegetarian ? '<span class="badge badge--veg">Veg</span>' : '<span class="badge badge--nonveg">Non-Veg</span>'}
        </p>
        <h3 class="menu-card__name">${item.name}</h3>
        <p class="menu-card__desc">${item.description || ""}</p>
        <div class="menu-card__footer">
          <span class="menu-card__price">₹${Number(item.price).toFixed(2)}</span>
          <button class="menu-card__add" onclick="addToCart('${item.id}', '${item.name}', ${item.price}, '${getFoodPhoto(item.name, item.image_url)}')">+</button>
        </div>
      </div>
    </div>
  `).join("");
}

// ── CART ───────────────────────────────────────────────────
function addToCart(id, name, price, image) {
  const existing = cart.find(i => i.id === id);
  if (existing) { existing.qty++; } else { cart.push({ id, name, price: parseFloat(price), image, qty: 1 }); }
  saveCart(); updateCartUI(); showToast(`${name} added to cart`);
}

function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  $("#cartCount").textContent = count;
  const cartEl = $("#cartItems");
  const summaryEl = $("#cartSummary");

  if (!cart.length) {
    cartEl.innerHTML = `<p class="cart__empty">Your cart is empty. Add items from the menu above.</p>`;
    summaryEl.style.display = "none";
    return;
  }

  cartEl.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img class="cart-item__img" src="${item.image || FOOD_PHOTOS.default}" alt="${item.name}" />
      <div class="cart-item__info">
        <p class="cart-item__name">${item.name}</p>
        <p class="cart-item__price">₹${(item.price * item.qty).toFixed(2)}</p>
      </div>
      <div class="cart-item__qty">
        <button class="qty-btn" onclick="changeQty('${item.id}', -1)">−</button>
        <span class="qty-val">${item.qty}</span>
        <button class="qty-btn" onclick="changeQty('${item.id}', 1)">+</button>
      </div>
    </div>
  `).join("");

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = subtotal * 0.05;
  $("#summarySubtotal").textContent = `₹${subtotal.toFixed(2)}`;
  $("#summaryTax").textContent = `₹${tax.toFixed(2)}`;
  $("#summaryTotal").textContent = `₹${(subtotal + tax).toFixed(2)}`;
  summaryEl.style.display = "flex";
}

function changeQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
  saveCart(); updateCartUI();
}

// ── PLACE ORDER ────────────────────────────────────────────
async function handlePlaceOrder() {
  if (!cart.length) return showToast("Cart is empty!");
  const btn = $("#placeOrderBtn");
  btn.disabled = true; btn.textContent = "Placing order…";
  const msgEl = $("#orderMessage");

  try {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        items: cart.map(i => ({ menu_item_id: i.id, quantity: i.qty })),
        order_type: $("#orderType").value,
        delivery_address: $("#deliveryAddress")?.value || null,
      }),
    });
    const data = await res.json();
    if (handleApiError(res.status)) return;
    if (!res.ok) throw new Error(data.error || "Order failed");
    cart = []; saveCart(); updateCartUI();
    msgEl.className = "form__message form__message--success";
    msgEl.textContent = `✓ Order #${data.order_id.slice(0,8)} placed! Total: ₹${data.total}`;
    showToast("Order placed successfully!");
  } catch (err) {
    msgEl.className = "form__message form__message--error";
    msgEl.textContent = `✗ ${err.message}`;
  } finally {
    btn.disabled = false; btn.textContent = "Place Order";
  }
}

// ── RESERVATION ────────────────────────────────────────────
async function handleReservation(e) {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Confirming…";
  const msgEl = $("#resMessage");

  try {
    const res = await fetch(`${API_BASE}/api/reservations`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        guest_name: $("#resName").value,
        guest_email: $("#resEmail").value,
        guest_phone: $("#resPhone").value,
        party_size: parseInt($("#resParty").value),
        reserved_date: $("#resDate").value,
        reserved_time: $("#resTime").value,
        special_requests: $("#resRequests").value,
      }),
    });
    const data = await res.json();
    if (handleApiError(res.status)) return;
    if (!res.ok) throw new Error(data.error || "Reservation failed");
    msgEl.className = "form__message form__message--success";
    msgEl.textContent = `✓ ${data.message} Ref: ${data.reservation_id.slice(0,8)}`;
    e.target.reset();
    showToast("Reservation confirmed!");
    loadMyReservations(); // refresh history
  } catch (err) {
    msgEl.className = "form__message form__message--error";
    msgEl.textContent = `✗ ${err.message}`;
  } finally {
    btn.disabled = false; btn.textContent = "Confirm Reservation";
  }
}

// ── ORDER HISTORY ──────────────────────────────────────────
async function loadMyOrders() {
  const container = $("#myOrdersList");
  if (!container) return;
  container.innerHTML = `<p class="loader">Loading orders…</p>`;

  const params = new URLSearchParams();
  const date = $("#filterOrderDate")?.value;
  const type = $("#filterOrderType")?.value;
  const diet = $("#filterOrderDiet")?.value;
  if (date) params.append("date", date);
  if (type) params.append("order_type", type);
  if (diet) params.append("diet", diet);

  try {
    const res = await fetch(`${API_BASE}/api/orders/my?${params}`, { headers: authHeaders() });
    if (handleApiError(res.status)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (!data.orders.length) { container.innerHTML = `<p class="loader">No orders found.</p>`; return; }

    container.innerHTML = data.orders.map(order => `
      <div class="history-card">
        <div class="history-card__header">
          <div>
            <span class="history-card__id">Order #${String(order.id).slice(0,8)}</span>
            <span class="history-badge history-badge--type">${order.order_type.replace("_"," ")}</span>
          </div>
          <div>
            <span class="history-badge history-badge--status">${order.status}</span>
            <span class="history-card__date">${new Date(order.created_at).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</span>
          </div>
        </div>
        <div class="history-card__items">
          ${order.items.map(i => `
            <div class="history-item">
              <span class="diet-dot diet-dot--${i.is_vegan || i.is_vegetarian ? 'veg':'nonveg'}"></span>
              <span>${i.name} × ${i.qty}</span>
              <span>₹${(i.price * i.qty).toFixed(2)}</span>
            </div>
          `).join("")}
        </div>
        <div class="history-card__footer">
          <strong>Total: ₹${Number(order.total).toFixed(2)}</strong>
          <span class="history-badge ${order.payment_status === 'paid' ? 'history-badge--paid' : 'history-badge--unpaid'}">${order.payment_status}</span>
        </div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<p class="loader">⚠ ${err.message}</p>`;
  }
}

// ── RESERVATION HISTORY ────────────────────────────────────
async function loadMyReservations() {
  const container = $("#myReservationsList");
  if (!container) return;
  container.innerHTML = `<p class="loader">Loading reservations…</p>`;

  try {
    const res = await fetch(`${API_BASE}/api/reservations/my`, { headers: authHeaders() });
    if (handleApiError(res.status)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (!data.reservations.length) { container.innerHTML = `<p class="loader">No reservations yet.</p>`; return; }

    container.innerHTML = data.reservations.map(r => `
      <div class="history-card">
        <div class="history-card__header">
          <div>
            <span class="history-card__id">Ref #${String(r.id).slice(0,8)}</span>
            ${r.table_number ? `<span class="history-badge">Table ${r.table_number}</span>` : ""}
          </div>
          <span class="history-badge history-badge--status">${r.status}</span>
        </div>
        <div class="history-card__body">
          <p><strong>${r.guest_name}</strong> · Party of ${r.party_size}</p>
          <p>📅 ${new Date(r.reserved_date).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"long",year:"numeric"})} at ${r.reserved_time?.slice(0,5)}</p>
          ${r.location ? `<p>📍 ${r.location}</p>` : ""}
          ${r.special_requests ? `<p class="history-card__requests">💬 ${r.special_requests}</p>` : ""}
        </div>
        <div class="history-card__footer">
          <span>Booked on ${new Date(r.created_at).toLocaleDateString("en-IN")}</span>
        </div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<p class="loader">⚠ ${err.message}</p>`;
  }
}