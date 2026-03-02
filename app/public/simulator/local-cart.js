const LOCAL_TEST_CART_KEY = "ida_local_test_cart";

const cartListEl = document.getElementById("cart-list");
const cartTotalEl = document.getElementById("cart-total");
const clearBtn = document.getElementById("clear-cart-btn");

const parsePrice = (price) => {
  const normalized = String(price ?? "").replace(/[^0-9.,]/g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
};

const readCart = () => {
  try {
    const raw = localStorage.getItem(LOCAL_TEST_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const clearCart = () => {
  try {
    localStorage.removeItem(LOCAL_TEST_CART_KEY);
  } catch {
    // ignore
  }
};

const render = () => {
  const items = readCart();
  cartListEl.innerHTML = "";

  if (!items.length) {
    cartListEl.innerHTML = '<div class="hint">Test-ostukorv on tühi.</div>';
    cartTotalEl.textContent = "Kokku: 0.00€";
    return;
  }

  let total = 0;
  for (const item of items) {
    const qty = Number(item.qty ?? 1);
    const price = parsePrice(item.price);
    total += qty * price;

    const row = document.createElement("div");
    row.className = "product-row";
    row.innerHTML = `
      <div>
        <div class="product-name">${item.title ?? "Toode"}</div>
        <div class="product-meta">${qty} × ${(price || 0).toFixed(2)}€</div>
      </div>
      <div class="product-meta">${(qty * price).toFixed(2)}€</div>
    `;
    cartListEl.appendChild(row);
  }

  cartTotalEl.textContent = `Kokku: ${total.toFixed(2)}€`;
};

clearBtn?.addEventListener("click", () => {
  clearCart();
  render();
});

render();
