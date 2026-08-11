import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { parseWhatsAppOrder } from './aiService.js';
import { saveOrder, getProducts, getBrandName, getNextOrderId } from './dbService.js';

export async function connectToWhatsApp(onNewOrder) {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    retryRequestOptions: { maxRetries: 5 }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log('⚠️ Sesión desvinculada desde el teléfono. Limpiando credenciales revocadas...');
        try {
          if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
          }
        } catch (err) {
          console.error("Error al borrar la carpeta de sesión:", err);
        }
      }

      console.log('🔄 Reintentando conexión con WhatsApp...');
      setTimeout(() => connectToWhatsApp(onNewOrder), 3000);

    } else if (connection === 'open') {
      console.log('✅ ¡WhatsApp vinculado y conectado exitosamente!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg || !msg.message || msg.key.fromMe || msg.key.remoteJid.endsWith('@g.us')) return;

    const senderJid = msg.key.remoteJid;
    const senderName = msg.pushName || 'Cliente';
    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (!messageText.trim()) return;

    const currentCatalog = await getProducts();
    const rawBrandName = await getBrandName();
    
    const currentBrandName = (rawBrandName && String(rawBrandName).trim() !== '') 
      ? String(rawBrandName).trim() 
      : 'MI EMPRESA';
      
    const catalogNames = currentCatalog.map(p => `• ${p.name} ($${p.price.toFixed(2)} MXN)`).join('\n');

    const aiResponse = await parseWhatsAppOrder(messageText, currentCatalog, currentBrandName);

    if (aiResponse && aiResponse.isValidOrder && aiResponse.items && aiResponse.items.length > 0) {
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
        customerName: senderName.toUpperCase(),
        source: 'WhatsApp IA',
        minutes: '0:01',
        status: 'Nuevo',
        items: itemsWithPrices,
        total: orderTotal
      };

      await saveOrder(newOrder);
      onNewOrder(newOrder);

      const itemsText = itemsWithPrices.map(i => `• ${i.qty}x ${i.name} - $${i.subtotal.toFixed(2)}`).join('\n');
      
      const replyMsg = `🛒 *${currentBrandName.toUpperCase()}*\n\n¡Hola ${senderName}! Tu pedido ha sido recibido:\n\n${itemsText}\n\n*TOTAL A PAGAR:* $${orderTotal.toFixed(2)} MXN\n*Folio de Pedido:* #${newOrder.id}\n\n¡Estamos preparando tu pedido!`;

      await sock.sendMessage(senderJid, { text: replyMsg, linkPreview: null });

    } else {
      let customWelcome = `Hola ${senderName}, en *${currentBrandName.toUpperCase()}* estamos para ayudarte.\n\nContamos con la siguiente variedad de productos:\n${catalogNames || 'Por el momento no hay productos registrados.'}\n\n¿En qué podemos asistirte hoy?`;

      if (aiResponse && aiResponse.replyMessage && !aiResponse.replyMessage.includes('POS_KDS')) {
        customWelcome = aiResponse.replyMessage;
      }

      customWelcome = customWelcome.replace(/POS_KDS/gi, currentBrandName.toUpperCase())
                                   .replace(/MI EMPRESA/gi, currentBrandName.toUpperCase());

      await sock.sendMessage(senderJid, { text: customWelcome, linkPreview: null });
    }
  });
}