import initSqlJs from 'sql.js';
import fs from 'fs';

let db;
const DB_FILE = './pos_kds_system.db';

function saveToFile() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_FILE, buffer);
}

function getLocalDateISO() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  const localDate = new Date(now.getTime() - offsetMs);
  return localDate.toISOString().replace('Z', '');
}

export async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const filebuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      category TEXT,
      price REAL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      source TEXT,
      total REAL,
      status TEXT,
      created_at TEXT
    );
  `);

  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const res = db.exec(`SELECT value FROM settings WHERE key = 'brand_name'`);
  if (res.length === 0 || res[0].values.length === 0) {
    db.run(`INSERT INTO settings (key, value) VALUES ('brand_name', 'MI EMPRESA')`);
  }

  saveToFile();
  console.log('🗄️ Base de datos SQLite (WebAssembly/JS) conectada correctamente');
}

export async function getBrandName() {
  const res = db.exec(`SELECT value FROM settings WHERE key = 'brand_name'`);
  if (res.length > 0 && res[0].values.length > 0) {
    return res[0].values[0][0];
  }
  return 'MI EMPRESA';
}

export async function setBrandNameInDB(name) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('brand_name', ?)`, [name]);
  saveToFile();
  return name;
}

export async function getProducts() {
  const res = db.exec('SELECT * FROM products');
  if (res.length === 0) return [];
  const columns = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    columns.forEach((col, idx) => obj[col] = row[idx]);
    return obj;
  });
}

export async function addProduct(product) {
  const { id, name, category, price } = product;
  db.run(
    `INSERT OR REPLACE INTO products (id, name, category, price) VALUES (?, ?, ?, ?)`,
    [id, name, category, price]
  );
  saveToFile();
  return await getProducts();
}

export async function deleteProduct(id) {
  db.run(`DELETE FROM products WHERE id = ?`, [id]);
  saveToFile();
  return await getProducts();
}

export async function saveOrder(orderData) {
  const { id, customerName, source, status, items, total } = orderData;
  const createdAt = getLocalDateISO();

  db.run(
    `INSERT INTO orders (id, customer_name, source, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [String(id), customerName, source, total, status, createdAt]
  );

  for (const item of items) {
    db.run(
      `INSERT INTO order_items (order_id, product_name, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)`,
      [String(id), item.name, item.qty, item.unitPrice, item.subtotal]
    );
  }

  saveToFile();
  return { ...orderData, createdAt };
}

export async function getOrderById(orderId) {
  if (!orderId) return null;
  const cleanId = String(orderId).trim().replace('#', '');

  const resOrder = db.exec(`SELECT * FROM orders WHERE TRIM(id) = TRIM('${cleanId}')`);
  if (resOrder.length === 0 || resOrder[0].values.length === 0) return null;

  const cols = resOrder[0].columns;
  const row = resOrder[0].values[0];
  const order = {};
  cols.forEach((col, idx) => order[col] = row[idx]);

  const resItems = db.exec(`SELECT product_name as name, quantity as qty, unit_price as unitPrice, subtotal FROM order_items WHERE order_id = '${order.id}'`);
  let items = [];
  if (resItems.length > 0) {
    const itemCols = resItems[0].columns;
    items = resItems[0].values.map(r => {
      const it = {};
      itemCols.forEach((col, idx) => it[col] = r[idx]);
      return it;
    });
  }

  return { ...order, items };
}

export async function getAllOrdersFromDB() {
  const res = db.exec(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 50`);
  if (res.length === 0) return [];
  const columns = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    columns.forEach((col, idx) => obj[col] = row[idx]);
    return obj;
  });
}

export async function getSalesReportByDate(dateStr) {
  const resOrders = db.exec(`SELECT * FROM orders WHERE SUBSTR(created_at, 1, 10) = '${dateStr}' ORDER BY created_at DESC`);
  let orders = [];
  if (resOrders.length > 0) {
    const cols = resOrders[0].columns;
    orders = resOrders[0].values.map(row => {
      const obj = {};
      cols.forEach((col, idx) => obj[col] = row[idx]);
      return obj;
    });
  }

  const resSum = db.exec(`SELECT COUNT(*) as totalOrders, COALESCE(SUM(total), 0) as totalSales FROM orders WHERE SUBSTR(created_at, 1, 10) = '${dateStr}'`);
  let totalOrders = 0;
  let totalSales = 0;
  if (resSum.length > 0 && resSum[0].values.length > 0) {
    totalOrders = resSum[0].values[0][0];
    totalSales = resSum[0].values[0][1];
  }

  return {
    date: dateStr,
    totalSales,
    totalOrders,
    orders
  };
}
