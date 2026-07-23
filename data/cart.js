// In-memory cart store, keyed by a session id cookie.
// NOTE: this is fine for a demo / single-server setup. For production with
// multiple server instances, move this to Redis or a `carts` DB table.

const carts = new Map(); // sessionId -> Map(productId -> quantity)

function getCart(sessionId) {
  if (!carts.has(sessionId)) carts.set(sessionId, new Map());
  return carts.get(sessionId);
}

function addItem(sessionId, productId, qty) {
  const cart = getCart(sessionId);
  const next = (cart.get(productId) || 0) + qty;
  cart.set(productId, Math.max(0, next));
  if (cart.get(productId) === 0) cart.delete(productId);
  return cart;
}

function setItem(sessionId, productId, qty) {
  const cart = getCart(sessionId);
  if (qty <= 0) cart.delete(productId);
  else cart.set(productId, qty);
  return cart;
}

function removeItem(sessionId, productId) {
  const cart = getCart(sessionId);
  cart.delete(productId);
  return cart;
}

function clearCart(sessionId) {
  carts.set(sessionId, new Map());
}

function cartAsArray(sessionId) {
  const cart = getCart(sessionId);
  return Array.from(cart.entries()).map(([productId, quantity]) => ({ productId, quantity }));
}

module.exports = { getCart, addItem, setItem, removeItem, clearCart, cartAsArray };
