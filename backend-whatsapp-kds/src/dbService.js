import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

function getLocalDateISO() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  const localDate = new Date(now.getTime() - offsetMs);
  return localDate.toISOString().replace('Z', '');
}

export async function initDB() {
  db = await open({
    filename: './pos_kds_system.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      category TEXT,
      price REAL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      source TEXT,
      total REAL,
      status TEXT,
      created_at TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT,
      product_name TEXT,
      quantity INTEGER,
      unit_price REAL,
      subtotal REAL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const brand = await db.get(`SELECT value FROM settings WHERE key = 'brand_name'`);
  if (!brand) {
    await db.run(`INSERT INTO settings (key, value) VALUES ('brand_name', 'MI EMPRESA')`);
  }

  console.log('🗄️ Base de datos SQLite conectada correctamente (pos_kds_system.db)');
}

export async function getBrandName() {
  const row = await db.get(`SELECT value FROM settings WHERE key = 'brand_name'`);
  return row ? row.value : 'MI EMPRESA';
}

export async function setBrandNameInDB(name) {
  await db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('brand_name', ?)`, [name]);
  return name;
}

export async function getProducts() {
  return await db.all('SELECT * FROM products');
}

export async function addProduct(product) {
  const { id, name, category, price } = product;
  await db.run(
    `INSERT OR REPLACE INTO products (id, name, category, price) VALUES (?, ?, ?, ?)`,
    [id, name, category, price]
  );
  return await getProducts();
}

export async function deleteProduct(id) {
  await db.run(`DELETE FROM products WHERE id = ?`, [id]);
  return await getProducts();
}

export async function saveOrder(orderData) {
  const { id, customerName, source, status, items, total } = orderData;
  const createdAt = getLocalDateISO();

  await db.run(
    `INSERT INTO orders (id, customer_name, source, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [String(id), customerName, source, total, status, createdAt]
  );

  for (const item of items) {
    await db.run(
      `INSERT INTO order_items (order_id, product_name, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)`,
      [String(id), item.name, item.qty, item.unitPrice, item.subtotal]
    );
  }

  return { ...orderData, createdAt };
}

export async function getOrderById(orderId) {
  if (!orderId) return null;
  const cleanId = String(orderId).trim().replace('#', '');

  const order = await db.get(`SELECT * FROM orders WHERE TRIM(id) = TRIM(?)`, [cleanId]);
  if (!order) return null;

  const items = await db.all(
    `SELECT product_name as name, quantity as qty, unit_price as unitPrice, subtotal FROM order_items WHERE order_id = ?`,
    [order.id]
  );

  return {
    ...order,
    items
  };
}

export async function getAllOrdersFromDB() {
  return await db.all(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 50`);
}

export async function getSalesReportByDate(dateStr) {
  const orders = await db.all(
    `SELECT * FROM orders WHERE SUBSTR(created_at, 1, 10) = ? ORDER BY created_at DESC`,
    [dateStr]
  );

  const summary = await db.get(
    `SELECT COUNT(*) as totalOrders, COALESCE(SUM(total), 0) as totalSales FROM orders WHERE SUBSTR(created_at, 1, 10) = ?`,
    [dateStr]
  );

  return {
    date: dateStr,
    totalSales: summary.totalSales,
    totalOrders: summary.totalOrders,
    orders
  };
}