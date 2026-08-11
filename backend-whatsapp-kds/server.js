import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { parseWhatsAppOrder } from './src/aiService.js';
import { connectToWhatsApp } from './src/whatsappService.js';
import { 
  initDB, 
  getProducts, 
  addProduct, 
  deleteProduct, 
  saveOrder, 
  getSalesReportByDate, 
  getOrderById, 
  getAllOrdersFromDB, 
  setBrandNameInDB, 
  getBrandName,
  getNextOrderId 
} from './src/dbService.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'DELETE'] }
});

app.use(cors());
app.use(express.json());

const emitNewOrder = (newOrder) => io.emit('new_order', newOrder);

// Manejo de eventos en tiempo real con Socket.IO
io.on('connection', (socket) => {
  socket.on('update_order_status', (data) => {
    const { orderId, newStatus } = data;
    io.emit('order_status_updated', { orderId, newStatus });
  });
});

// Configuración de marca en SQLite
app.get('/api/settings/brand', async (req, res) => {
  try {
    const brandName = await getBrandName();
    const finalBrand = (brandName && brandName.trim() !== '') ? brandName.trim() : 'MI EMPRESA';
    return res.status(200).json({ brandName: finalBrand, name: finalBrand });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/brand', async (req, res) => {
  try {
    const { brandName, name } = req.body;
    const nameToSave = (brandName || name || '').trim();

    if (!nameToSave) {
      return res.status(400).json({ error: 'Nombre de marca requerido' });
    }

    await setBrandNameInDB(nameToSave);
    io.emit('brand_updated', { brandName: nameToSave });

    return res.status(200).json({ status: 'success', brandName: nameToSave, name: nameToSave });
  } catch (error) {
    console.error("Error al guardar marca:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Búsqueda de órdenes en SQLite
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await getAllOrdersFromDB();
    return res.status(200).json(Array.isArray(orders) ? orders : []);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await getOrderById(id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    return res.status(200).json(order);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Catálogo de Productos
app.get('/api/products', async (req, res) => {
  try {
    const products = await getProducts();
    return res.status(200).json(Array.isArray(products) ? products : []);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, category, price, id } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Nombre y precio son requeridos' });
    }

    const productData = {
      id: id || Date.now().toString(),
      name,
      category: category || 'General',
      price: parseFloat(price)
    };

    const updatedProducts = await addProduct(productData);
    const resultList = Array.isArray(updatedProducts) ? updatedProducts : await getProducts();

    io.emit('catalog_updated', resultList);
    return res.status(200).json(resultList);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updatedProducts = await deleteProduct(id);
    const resultList = Array.isArray(updatedProducts) ? updatedProducts : await getProducts();

    io.emit('catalog_updated', resultList);
    return res.status(200).json(resultList);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Reportes
app.get('/api/reports/daily', async (req, res) => {
  try {
    const dateQuery = req.query.date || new Date().toISOString().split('T')[0];
    const report = await getSalesReportByDate(dateQuery);
    return res.status(200).json(report || { date: dateQuery, totalSales: 0, totalOrders: 0, orders: [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint de recepción para pedidos manuales / WhatsApp
app.post('/api/whatsapp/incoming', async (req, res) => {
  try {
    const { senderName, messageText, manualOrder } = req.body || {};

    if (manualOrder) {
      const nextId = await getNextOrderId();

      const newOrder = {
        id: nextId,
        customerName: manualOrder.customerName || 'CLIENTE MOSTRADOR',
        source: manualOrder.source || 'Llamada',
        minutes: '0:01',
        status: 'Nuevo',
        items: manualOrder.items,
        total: manualOrder.total
      };

      await saveOrder(newOrder);
      emitNewOrder(newOrder);
      return res.status(200).json({ status: 'success', order: newOrder });
    }

    if (!messageText) return res.status(400).json({ error: 'Falta messageText' });

    const currentCatalog = await getProducts();
    const currentBrandName = await getBrandName();
    const aiResponse = await parseWhatsAppOrder(messageText, currentCatalog, currentBrandName);

    if (!aiResponse || !aiResponse.isValidOrder || !aiResponse.items || aiResponse.items.length === 0) {
      return res.status(200).json({ status: 'ignored', botReply: aiResponse?.replyMessage });
    }

    let orderTotal = 0;
    const itemsWithPrices = aiResponse.items.map(item => {
      const prodMatch = currentCatalog.find(p => p.name.toLowerCase() === item.name.toLowerCase());
      const unitPrice = prodMatch ? prodMatch.price : 15.00;
      const subtotal = unitPrice * item.qty;
      orderTotal += subtotal;

      return {
        name: prodMatch ? prodMatch.name : item.name,
        qty: item.qty,
        unitPrice,
        subtotal
      };
    });

    const nextId = await getNextOrderId();

    const newOrder = {
      id: nextId,
      customerName: (senderName || aiResponse.customerName || 'CLIENTE').toUpperCase(),
      source: 'WhatsApp IA',
      minutes: '0:01',
      status: 'Nuevo',
      items: itemsWithPrices,
      total: orderTotal
    };

    await saveOrder(newOrder);
    emitNewOrder(newOrder);

    return res.status(200).json({ status: 'success', order: newOrder, botReply: aiResponse.replyMessage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ Servidor API Backend corriendo en http://0.0.0.0:${PORT}`);
  await initDB();
  connectToWhatsApp(emitNewOrder);
});