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
  getBrandName 
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

// Configuración de marca en SQLite
app.get('/api/settings/brand', async (req, res) => {
  try {
    const brandName = await getBrandName();
    return res.json({ brandName });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/brand', async (req, res) => {
  try {
    const { brandName } = req.body;
    await setBrandNameInDB(brandName);
    return res.json({ status: 'success', brandName });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Búsqueda de órdenes en SQLite
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await getAllOrdersFromDB();
    return res.json(orders);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔎 Buscando orden en SQLite con ID: ${id}`);
    const order = await getOrderById(id);
    
    if (!order) {
      console.log(`❌ Orden #${id} no existe en SQLite.`);
      return res.status(404).json({ error: 'Pedido no encontrado en la base de datos' });
    }
    
    console.log(`✅ Orden #${id} encontrada exitosamente.`);
    return res.json(order);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Catálogo
app.get('/api/products', async (req, res) => {
  try {
    const products = await getProducts();
    return res.json(products);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const newProduct = req.body;
    const updatedProducts = await addProduct(newProduct);
    io.emit('catalog_updated', updatedProducts);
    return res.json(updatedProducts);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updatedProducts = await deleteProduct(id);
    io.emit('catalog_updated', updatedProducts);
    return res.json(updatedProducts);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Reportes
app.get('/api/reports/daily', async (req, res) => {
  try {
    const dateQuery = req.query.date || new Date().toISOString().split('T')[0];
    const report = await getSalesReportByDate(dateQuery);
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint de recepción para pedidos manuales
app.post('/api/whatsapp/incoming', async (req, res) => {
  try {
    const { senderName, messageText, manualOrder } = req.body || {};

    if (manualOrder) {
      const newOrder = {
        id: `${Math.floor(1000 + Math.random() * 9000)}`,
        customerName: manualOrder.customerName || 'CLIENTE MOSTRADOR',
        source: manualOrder.source || 'Llamada',
        minutes: '0:01',
        status: 'Nuevo',
        items: manualOrder.items,
        total: manualOrder.total
      };

      await saveOrder(newOrder);
      emitNewOrder(newOrder);
      return res.json({ status: 'success', order: newOrder });
    }

    if (!messageText) return res.status(400).json({ error: 'Falta messageText' });

    const currentCatalog = await getProducts();
    const currentBrandName = await getBrandName();
    const aiResponse = await parseWhatsAppOrder(messageText, currentCatalog, currentBrandName);

    if (!aiResponse || !aiResponse.isValidOrder || !aiResponse.items || aiResponse.items.length === 0) {
      return res.json({ status: 'ignored', botReply: aiResponse?.replyMessage });
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

    const newOrder = {
      id: `${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: (senderName || aiResponse.customerName || 'CLIENTE').toUpperCase(),
      source: 'WhatsApp IA',
      minutes: '0:01',
      status: 'Nuevo',
      items: itemsWithPrices,
      total: orderTotal
    };

    await saveOrder(newOrder);
    emitNewOrder(newOrder);

    return res.json({ status: 'success', order: newOrder, botReply: aiResponse.replyMessage });
  } catch (err) {
    console.error('❌ Error en Endpoint Entrante:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, async () => {
  console.log(`✅ Servidor API Backend corriendo en http://localhost:${PORT}`);
  await initDB();
  connectToWhatsApp(emitNewOrder);
});