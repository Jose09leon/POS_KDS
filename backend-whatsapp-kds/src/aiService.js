import dotenv from 'dotenv';
dotenv.config();

import Groq from 'groq-sdk';

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.includes('tu_clave')) {
    throw new Error('La variable GROQ_API_KEY no está definida correctamente en el archivo .env');
  }
  return new Groq({ apiKey });
}

function normalizeProductName(rawName, catalog) {
  if (!rawName || !catalog || catalog.length === 0) return null;
  const clean = rawName.toLowerCase().trim();

  // Coincidencia exacta
  const exact = catalog.find(p => p.name.toLowerCase() === clean);
  if (exact) return exact.name;

  // Coincidencia por palabras clave contenidas en el catálogo
  const match = catalog.find(p => {
    const pName = p.name.toLowerCase();
    const words = clean.split(' ').filter(w => w.length > 2);
    return words.some(w => pName.includes(w));
  });

  return match ? match.name : null;
}

export async function parseWhatsAppOrder(messageText, catalog = [], brandName = 'MI EMPRESA') {
  const cleanBrand = (brandName && brandName.trim() !== '') ? brandName.trim() : 'MI EMPRESA';
  const catalogList = catalog.map(p => `- ${p.name} ($${p.price} MXN)`).join('\n');

  const systemPrompt = `
Eres un asistente extractor de pedidos para la empresa '${cleanBrand}'.
Coteja el mensaje del cliente con este catálogo exacto:
${catalogList || 'Sin productos disponibles.'}

REGLAS ESTRICTAS:
1. Extrae únicamente los productos que pertenezcan al catálogo listado arriba.
2. Si el producto solicitado NO existe en el catálogo, marca "isValidOrder": false y en "replyMessage" explica educadamente que no cuentan con ese producto a nombre de '${cleanBrand}' y menciona los disponibles.
3. Si el mensaje es solo un saludo o duda general, marca "isValidOrder": false y responde cordialmente ofreciendo ayuda a nombre de '${cleanBrand}'.
4. JAMÁS uses la palabra "POS_KDS", "el negocio", ni incluyas URLs o enlaces en "replyMessage". Usa siempre el nombre exacto '${cleanBrand}'.

Devuelve ÚNICAMENTE un JSON con esta estructura exacta:
{
  "isValidOrder": true,
  "customerName": "Nombre del cliente",
  "items": [
    { "name": "Nombre EXACTO del catálogo", "qty": 1 }
  ],
  "replyMessage": "Mensaje de respuesta o confirmación a nombre de ${cleanBrand}"
}
`;

  try {
    const groq = getGroqClient();
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Mensaje cliente: "${messageText}"` }
      ],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      temperature: 0.0
    });

    const result = JSON.parse(chatCompletion.choices[0]?.message?.content || '{}');

    if (result.isValidOrder && Array.isArray(result.items)) {
      const validItems = [];

      for (const item of result.items) {
        const officialName = normalizeProductName(item.name, catalog);
        if (officialName) {
          validItems.push({
            ...item,
            name: officialName
          });
        }
      }

      if (validItems.length === 0) {
        result.isValidOrder = false;
        const availableProds = catalog.map(p => p.name).join(', ');
        result.replyMessage = `¡Hola! Gracias por escribir a *${cleanBrand.toUpperCase()}*. No pudimos identificar los productos. Por el momento contamos con: ${availableProds}.`;
      } else {
        result.items = validItems;
      }
    }

    return result;
  } catch (error) {
    console.error('Error en Groq IA:', error.message);
    return { 
      isValidOrder: false, 
      replyMessage: `¡Hola! Gracias por comunicarte con *${cleanBrand.toUpperCase()}*. En este momento no pudimos procesar tu solicitud, por favor reintenta tu pedido.` 
    };
  }
}