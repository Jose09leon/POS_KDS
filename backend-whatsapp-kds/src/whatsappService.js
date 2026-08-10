import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { parseWhatsAppOrder } from './aiService.js';
import { saveOrder, getProducts, getBrandName } from './dbService.js';

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

      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(onNewOrder), 3000);
      }
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
    const currentBrandName = (rawBrandName || 'MI EMPRESA').trim();
    const catalogNames = currentCatalog.map(p => p.name).join(', ');

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

      const newOrder = {
        id: `${Math.floor(1000 + Math.random() * 9000)}`,
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

      await sock.sendMessage(senderJid, { text: replyMsg });

    } else {
      let fallbackText = aiResponse?.replyMessage;

      if (!fallbackText) {
        fallbackText = `¡Hola ${senderName}! Gracias por escribir a *${currentBrandName}*. 🛒\n\nPor el momento contamos con los siguientes productos:\n${catalogNames}\n\n¿Te gustaría realizar un pedido con alguno de ellos?`;
      }

      await sock.sendMessage(senderJid, { text: fallbackText });
    }
  });
}
