import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
const API_URL = `http://${window.location.hostname}:4000`;

export default function App() {
  const [currentView, setCurrentView] = useState('cold-room');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ticketToPrint, setTicketToPrint] = useState(null);
  const [socketInstance, setSocketInstance] = useState(null);

  const [brandName, setBrandName] = useState(() => {
    return localStorage.getItem('cf_brand_name') || 'NOMBRE DE TU EMPRESA';
  });
  const [brandLogo, setBrandLogo] = useState(() => {
    return localStorage.getItem('cf_brand_logo') || '';
  });

  const safeFetch = async (url, options = {}) => {
    const response = await fetch(url, options);
    const rawText = await response.text();

    if (!response.ok) {
      let msg = `Error ${response.status}`;
      try {
        const parsed = JSON.parse(rawText);
        if (parsed.error) msg = parsed.error;
      } catch (e) {}
      throw new Error(msg);
    }

    if (!rawText || rawText.trim() === '') return null;

    try {
      return JSON.parse(rawText);
    } catch (e) {
      return null;
    }
  };

  const handleSaveBrand = (newName, newLogoBase64) => {
    setBrandName(newName);
    setBrandLogo(newLogoBase64);
    localStorage.setItem('cf_brand_name', newName);
    localStorage.setItem('cf_brand_logo', newLogoBase64);

    safeFetch(`${API_URL}/api/settings/brand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName: newName, name: newName })
    }).catch(err => console.error("Error guardando marca en backend:", err));
  };

  useEffect(() => {
    // 1. Cargar la marca directamente desde SQLite al cargar cualquier navegador
    safeFetch(`${API_URL}/api/settings/brand`)
      .then(data => {
        if (data && (data.brandName || data.name)) {
          const val = data.brandName || data.name;
          setBrandName(val);
        }
      })
      .catch(err => console.error("Error consultando marca del backend:", err));

    safeFetch(`${API_URL}/api/products`)
      .then(data => {
        if (Array.isArray(data)) setProducts(data);
      })
      .catch(err => console.error("Error al cargar productos:", err));

    const savedOrders = localStorage.getItem('cf_orders');
    if (savedOrders) setOrders(JSON.parse(savedOrders));

    const loggedIn = localStorage.getItem('cf_admin_logged') === 'true';
    if (loggedIn) setIsAuthenticated(true);

    const newSocket = io(API_URL, {
      transports: ['websocket', 'polling']
    });

    // 2. Escuchar actualización de marca en tiempo real desde otro dispositivo
    newSocket.on('brand_updated', (data) => {
      if (data && data.brandName) setBrandName(data.brandName);
    });

    // 3. Escuchar cambios de estado en tiempo real transmitidos por otros navegadores
    newSocket.on('order_status_updated', ({ orderId, newStatus }) => {
      setOrders((prevOrders) => {
        let updated;
        if (newStatus === 'Completado') {
          updated = prevOrders.filter(ord => ord.id !== orderId);
        } else {
          updated = prevOrders.map(ord => 
            ord.id === orderId ? { ...ord, status: newStatus } : ord
          );
        }
        localStorage.setItem('cf_orders', JSON.stringify(updated));
        return updated;
      });
    });

    newSocket.on('catalog_updated', (updatedCatalog) => {
      if (Array.isArray(updatedCatalog)) setProducts(updatedCatalog);
    });

    newSocket.on('new_order', (incomingOrder) => {
      setOrders((prevOrders) => {
        const updated = [incomingOrder, ...prevOrders];
        localStorage.setItem('cf_orders', JSON.stringify(updated));
        return updated;
      });
    });

    setSocketInstance(newSocket);
    return () => newSocket.disconnect();
  }, []);

  const saveOrders = (newOrders) => {
    setOrders(newOrders);
    localStorage.setItem('cf_orders', JSON.stringify(newOrders));
  };

  const handleAdvanceStatus = (orderToAdvance) => {
    let nextStatus = '';

    if (orderToAdvance.status === 'Nuevo') {
      nextStatus = 'En Preparación';
    } else if (orderToAdvance.status === 'En Preparación') {
      nextStatus = 'Completado';
      setTicketToPrint({
        ...orderToAdvance,
        completedAt: new Date().toLocaleString('es-MX')
      });
    }

    if (nextStatus && socketInstance) {
      // Emite el evento a Socket.IO para sincronizar todas las pantallas conectadas
      socketInstance.emit('update_order_status', {
        orderId: orderToAdvance.id,
        newStatus: nextStatus
      });
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('cf_admin_logged');
    setCurrentView('cold-room');
  };

  return (
    <div style={{ backgroundColor: '#121212', color: '#ffffff', fontFamily: 'monospace, sans-serif', minHeight: '100vh', padding: '10px', boxSizing: 'border-box' }}>
      <div style={{
        backgroundColor: '#000000',
        border: '3px solid #333333',
        borderRadius: '8px',
        width: '100%',
        margin: '0',
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
        boxSizing: 'border-box'
      }}>
        
        {/* Header Superior */}
        <div style={{ backgroundColor: '#1e1e1e', borderBottom: '2px solid #333', padding: '10px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {brandLogo && (
              <img 
                src={brandLogo} 
                alt="Logo Empresa" 
                style={{ height: '36px', width: 'auto', maxHeight: '36px', objectFit: 'contain', borderRadius: '4px' }} 
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            <span style={{ fontWeight: 'bold', fontSize: '20px', color: '#00e676', letterSpacing: '1px' }}>
              {brandName}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setCurrentView('cold-room')} style={{ backgroundColor: currentView === 'cold-room' ? '#2979ff' : '#333', color: '#fff', border: 'none', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
              Pantalla KDS
            </button>
            <button onClick={() => setCurrentView('admin-panel')} style={{ backgroundColor: currentView === 'admin-panel' ? '#2979ff' : '#333', color: '#fff', border: 'none', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
              {isAuthenticated ? '🔒 Panel Admin' : '🔑 Login Admin'}
            </button>
            {isAuthenticated && (
              <button onClick={handleLogout} style={{ backgroundColor: '#d32f2f', color: '#fff', border: 'none', padding: '8px 12px', fontWeight: 'bold', cursor: 'pointer' }}>
                Salir
              </button>
            )}
          </div>
        </div>

        {/* Contenido Principal */}
        <div style={{ padding: '10px' }}>
          {currentView === 'cold-room' ? (
            <KDSGrid orders={orders} onAdvanceStatus={handleAdvanceStatus} />
          ) : (
            !isAuthenticated ? (
              <LoginView onLoginSuccess={() => setIsAuthenticated(true)} />
            ) : (
              <AdminDashboardView 
                products={products} 
                onSaveProducts={setProducts} 
                brandName={brandName}
                brandLogo={brandLogo}
                onSaveBrand={handleSaveBrand}
                onReprintTicket={(order) => setTicketToPrint(order)}
              />
            )
          )}
        </div>
      </div>

      {ticketToPrint && (
        <TicketModal ticket={ticketToPrint} brandName={brandName} brandLogo={brandLogo} onClose={() => setTicketToPrint(null)} />
      )}
    </div>
  );
}

function LoginView({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === 'admin' && password === 'admin123') {
      localStorage.setItem('cf_admin_logged', 'true');
      onLoginSuccess();
    } else {
      setErrorMsg('Usuario o contraseña incorrectos');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '50px 0' }}>
      <div style={{ backgroundColor: '#1e1e1e', border: '1px solid #333', padding: '30px', width: '320px', borderRadius: '6px' }}>
        <h3 style={{ color: '#00e5ff', marginTop: 0, textAlign: 'center' }}>ACCESO ADMINISTRADOR</h3>
        {errorMsg && <div style={{ backgroundColor: '#d32f2f', color: '#fff', padding: '8px', fontSize: '12px', marginBottom: '15px', textAlign: 'center' }}>{errorMsg}</div>}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '5px' }}>Usuario:</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" style={{ width: '100%', backgroundColor: '#000', border: '1px solid #444', color: '#fff', padding: '10px', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '5px' }}>Contraseña:</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', backgroundColor: '#000', border: '1px solid #444', color: '#fff', padding: '10px', boxSizing: 'border-box' }} />
          </div>
          <button type="submit" style={{ backgroundColor: '#00c853', color: '#000', border: 'none', padding: '12px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>
            INGRESAR
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminDashboardView({ products, onSaveProducts, brandName, brandLogo, onSaveBrand, onReprintTicket }) {
  const [activeTab, setActiveTab] = useState('manual-order');
  
  const getTodayString = () => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offsetMs).toISOString().split('T')[0];
  };

  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const [reportData, setReportData] = useState({ totalSales: 0, totalOrders: 0, orders: [] });
  const [isLoadingReport, setIsLoadingReport] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [orderSource, setOrderSource] = useState('Llamada');
  const [selectedQuantities, setSelectedQuantities] = useState({});
  const [isSending, setIsSending] = useState(false);
  const [orderSuccessMsg, setOrderSuccessMsg] = useState('');

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');

  const [inputBrandName, setInputBrandName] = useState(brandName);
  const [logoPreview, setLogoPreview] = useState(brandLogo);
  const [brandSavedMsg, setBrandSavedMsg] = useState('');

  const [searchOrderId, setSearchOrderId] = useState('');
  const [foundOrder, setFoundOrder] = useState(null);
  const [searchError, setSearchError] = useState('');

  const safeFetch = async (url, options = {}) => {
    const response = await fetch(url, options);
    const rawText = await response.text();

    if (!response.ok) {
      let msg = `Error ${response.status}`;
      try {
        const parsed = JSON.parse(rawText);
        if (parsed.error) msg = parsed.error;
      } catch (e) {}
      throw new Error(msg);
    }

    if (!rawText || rawText.trim() === '') return null;

    try {
      return JSON.parse(rawText);
    } catch (e) {
      return null;
    }
  };

  const fetchProductsFromDB = () => {
    safeFetch(`${API_URL}/api/products`)
      .then(data => { if (Array.isArray(data)) onSaveProducts(data); })
      .catch(err => console.error("Error consultando productos:", err));
  };

  useEffect(() => { fetchProductsFromDB(); }, []);

  const fetchReport = (dateStr) => {
    if (!dateStr) return;
    setIsLoadingReport(true);
    safeFetch(`${API_URL}/api/reports/daily?date=${dateStr}`)
      .then(data => {
        if (data) {
          setReportData({ totalSales: data.totalSales || 0, totalOrders: data.totalOrders || 0, orders: data.orders || [] });
        }
      })
      .catch(err => setReportData({ totalSales: 0, totalOrders: 0, orders: [] }))
      .finally(() => setIsLoadingReport(false));
  };

  useEffect(() => {
    if (activeTab === 'sales') fetchReport(selectedDate);
  }, [activeTab]);

  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setSelectedDate(newDate);
    fetchReport(newDate);
  };

  const handleSearchOrder = (e) => {
    e.preventDefault();
    setSearchError('');
    setFoundOrder(null);

    const cleanId = searchOrderId.trim().replace('#', '');
    if (!cleanId) return;

    safeFetch(`${API_URL}/api/orders/${cleanId}`)
      .then(data => {
        if (!data) throw new Error("Pedido no encontrado");
        setFoundOrder(data);
      })
      .catch(err => setSearchError(`❌ No se encontró ningún pedido con el Folio/Orden #${cleanId}`));
  };

  const handleQuantityChange = (prodId, value) => {
    const qty = Math.max(0, parseInt(value) || 0);
    setSelectedQuantities(prev => ({ ...prev, [prodId]: qty }));
  };

  const handleIncrement = (prodId) => setSelectedQuantities(prev => ({ ...prev, [prodId]: (prev[prodId] || 0) + 1 }));
  const handleDecrement = (prodId) => setSelectedQuantities(prev => ({ ...prev, [prodId]: Math.max(0, (prev[prodId] || 0) - 1) }));

  const calculateManualTotal = () => {
    let total = 0;
    products.forEach(p => { total += (selectedQuantities[p.id] || 0) * p.price; });
    return total;
  };

  const handleSendManualOrder = async (e) => {
    e.preventDefault();
    if (!customerName.trim()) return alert("Ingresa el nombre del cliente.");

    const itemsToOrder = [];
    products.forEach(p => {
      const qty = selectedQuantities[p.id] || 0;
      if (qty > 0) itemsToOrder.push({ name: p.name, qty, unitPrice: p.price, subtotal: qty * p.price });
    });

    if (itemsToOrder.length === 0) return alert("Selecciona al menos un producto.");

    setIsSending(true);
    try {
      await safeFetch(`${API_URL}/api/whatsapp/incoming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName: customerName.trim(),
          messageText: `Pedido Manual`,
          manualOrder: { customerName: customerName.trim().toUpperCase(), source: orderSource, items: itemsToOrder, total: calculateManualTotal() }
        })
      });

      setOrderSuccessMsg('✅ ¡Pedido enviado con éxito al KDS!');
      setCustomerName('');
      setSelectedQuantities({});
      setTimeout(() => setOrderSuccessMsg(''), 4000);
    } catch (error) {
      alert("Error: " + error.message);
    } finally {
      setIsSending(false);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const updated = await safeFetch(`${API_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: `p-${Date.now()}`, name: name.trim(), category: category.trim() || 'General', price: parseFloat(price) || 0 })
      });
      
      if (Array.isArray(updated)) {
        onSaveProducts(updated);
      } else {
        fetchProductsFromDB();
      }
      setName(''); setCategory(''); setPrice('');
    } catch (err) { alert("Error: " + err.message); }
  };

  const handleDeleteProduct = async (id) => {
    try {
      const updated = await safeFetch(`${API_URL}/api/products/${id}`, { method: 'DELETE' });
      if (Array.isArray(updated)) {
        onSaveProducts(updated);
      } else {
        fetchProductsFromDB();
      }
    } catch (err) { alert("Error: " + err.message); }
  };

  const handleImageFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setLogoPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSaveBrandSettings = async (e) => {
    e.preventDefault();
    const finalName = inputBrandName.trim() || 'MI EMPRESA';
    
    onSaveBrand(finalName, logoPreview);

    try {
      await safeFetch(`${API_URL}/api/settings/brand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName: finalName, name: finalName })
      });
      setBrandSavedMsg('✅ Identidad guardada en SQLite con éxito.');
    } catch (err) {
      setBrandSavedMsg(`❌ Error guardando en servidor: ${err.message}`);
    }
    
    setTimeout(() => setBrandSavedMsg(''), 4000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
      <div style={{ display: 'flex', gap: '10px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
        <button onClick={() => setActiveTab('manual-order')} style={{ backgroundColor: activeTab === 'manual-order' ? '#00e5ff' : '#222', color: activeTab === 'manual-order' ? '#000' : '#fff', border: 'none', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
          📞 Tomar Pedido Manual
        </button>
        <button onClick={() => setActiveTab('sales')} style={{ backgroundColor: activeTab === 'sales' ? '#00e5ff' : '#222', color: activeTab === 'sales' ? '#000' : '#fff', border: 'none', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
          📊 Ventas Diarias
        </button>
        <button onClick={() => setActiveTab('search-order')} style={{ backgroundColor: activeTab === 'search-order' ? '#00e5ff' : '#222', color: activeTab === 'search-order' ? '#000' : '#fff', border: 'none', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
          🔍 Consultar Pedido por Orden #
        </button>
        <button onClick={() => { setActiveTab('catalog'); fetchProductsFromDB(); }} style={{ backgroundColor: activeTab === 'catalog' ? '#00e5ff' : '#222', color: activeTab === 'catalog' ? '#000' : '#fff', border: 'none', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
          📦 Catálogo de Productos
        </button>
        <button onClick={() => setActiveTab('brand')} style={{ backgroundColor: activeTab === 'brand' ? '#00e5ff' : '#222', color: activeTab === 'brand' ? '#000' : '#fff', border: 'none', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
          ⚙️ Logotipo & Marca
        </button>
      </div>

      {activeTab === 'manual-order' && (
        <div style={{ backgroundColor: '#1e1e1e', padding: '15px', border: '1px solid #333' }}>
          <h3 style={{ color: '#00e5ff', marginTop: 0, marginBottom: '15px' }}>Registrar Pedido Manual (Llamada / Mostrador)</h3>

          {orderSuccessMsg && <div style={{ backgroundColor: '#00c853', color: '#000', padding: '10px', fontWeight: 'bold', marginBottom: '15px', textAlign: 'center' }}>{orderSuccessMsg}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '5px' }}>Nombre del Cliente:</label>
              <input type="text" placeholder="Ej. Pedro Sánchez" value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={{ width: '100%', backgroundColor: '#000', border: '1px solid #555', color: '#fff', padding: '10px', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '5px' }}>Vía de Recepción:</label>
              <select value={orderSource} onChange={(e) => setOrderSource(e.target.value)} style={{ width: '100%', backgroundColor: '#000', border: '1px solid #555', color: '#fff', padding: '10px', fontSize: '14px', boxSizing: 'border-box' }}>
                <option value="Llamada">Llamada Telefónica</option>
                <option value="Mostrador / Local">Mostrador / Local</option>
                <option value="WhatsApp Manual">WhatsApp Manual</option>
              </select>
            </div>
          </div>

          <h4 style={{ color: '#ffea00', marginBottom: '10px' }}>Seleccionar Cantidad por Producto:</h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px', marginBottom: '20px' }}>
            {products.map(p => {
              const currentQty = selectedQuantities[p.id] || 0;
              return (
                <div key={p.id} style={{ backgroundColor: '#000', border: '1px solid #444', padding: '12px', borderRadius: '4px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{p.name}</div>
                  <div style={{ color: '#00e676', fontSize: '13px', marginBottom: '10px' }}>${p.price.toFixed(2)} MXN</div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button type="button" onClick={() => handleDecrement(p.id)} style={{ width: '40px', height: '40px', backgroundColor: '#d32f2f', color: '#fff', border: 'none', fontSize: '20px', fontWeight: 'bold', cursor: 'pointer' }}>-</button>
                    <input type="number" min="0" value={currentQty === 0 ? '' : currentQty} onChange={(e) => handleQuantityChange(p.id, e.target.value)} placeholder="0" style={{ flex: 1, height: '40px', textAlign: 'center', backgroundColor: '#222', border: '1px solid #555', color: '#fff', fontSize: '18px', fontWeight: 'bold' }} />
                    <button type="button" onClick={() => handleIncrement(p.id)} style={{ width: '40px', height: '40px', backgroundColor: '#00c853', color: '#000', border: 'none', fontSize: '20px', fontWeight: 'bold', cursor: 'pointer' }}>+</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px solid #333', paddingTop: '15px' }}>
            <div>
              <span style={{ fontSize: '13px', color: '#aaa' }}>TOTAL CALCULADO:</span>
              <div style={{ fontSize: '28px', fontWeight: '900', color: '#00e676' }}>${calculateManualTotal().toFixed(2)} MXN</div>
            </div>
            <button onClick={handleSendManualOrder} disabled={isSending} style={{ backgroundColor: '#00c853', color: '#000000', border: 'none', padding: '12px 24px', fontWeight: '900', fontSize: '16px', cursor: 'pointer', borderRadius: '4px' }}>
              {isSending ? 'ENVIANDO...' : '🚀 ENVIAR PEDIDO A KDS'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'sales' && (
        <div style={{ backgroundColor: '#1e1e1e', padding: '15px', border: '1px solid #333' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ color: '#00e5ff', margin: 0 }}>Filtro de Transacciones por Fecha</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isLoadingReport && <span style={{ fontSize: '12px', color: '#ffea00' }}>⚡ Cargando...</span>}
              <input type="date" value={selectedDate} onChange={handleDateChange} onInput={handleDateChange} style={{ backgroundColor: '#000', color: '#fff', border: '1px solid #555', padding: '6px 10px', cursor: 'pointer' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
            <div style={{ backgroundColor: '#000', padding: '12px', border: '1px solid #00c853' }}>
              <span style={{ fontSize: '12px', color: '#aaa' }}>Total Vendido ($)</span>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#00e676' }}>${Number(reportData.totalSales || 0).toFixed(2)} MXN</div>
            </div>
            <div style={{ backgroundColor: '#000', padding: '12px', border: '1px solid #2979ff' }}>
              <span style={{ fontSize: '12px', color: '#aaa' }}>Pedidos Transaccionados</span>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2979ff' }}>{reportData.totalOrders || 0} Pedidos</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'search-order' && (
        <div style={{ backgroundColor: '#1e1e1e', padding: '20px', border: '1px solid #333', maxWidth: '600px' }}>
          <h3 style={{ color: '#00e5ff', marginTop: 0, marginBottom: '15px' }}>🔍 Buscar Pedido por Folio / Orden #</h3>
          
          <form onSubmit={handleSearchOrder} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <input 
              type="text" 
              placeholder="Ej. 1313 o 5932" 
              value={searchOrderId} 
              onChange={(e) => setSearchOrderId(e.target.value)}
              style={{ flex: 1, backgroundColor: '#000', border: '1px solid #555', color: '#fff', padding: '10px', fontSize: '16px' }}
            />
            <button type="submit" style={{ backgroundColor: '#2979ff', color: '#fff', border: 'none', padding: '10px 20px', fontWeight: 'bold', cursor: 'pointer' }}>
              BUSCAR
            </button>
          </form>

          {searchError && (
            <div style={{ backgroundColor: '#d32f2f', color: '#fff', padding: '10px', fontSize: '14px', marginBottom: '15px' }}>
              {searchError}
            </div>
          )}

          {foundOrder && (
            <div style={{ backgroundColor: '#000', border: '2px solid #00e676', padding: '15px', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '10px' }}>
                <div>
                  <div style={{ color: '#ffea00', fontWeight: 'bold', fontSize: '18px' }}>Orden# {foundOrder.id}</div>
                  <div style={{ color: '#00e5ff', fontSize: '14px' }}>CLIENTE: {foundOrder.customer_name}</div>
                  <div style={{ color: '#aaa', fontSize: '12px' }}>Vía: {foundOrder.source}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#aaa', fontSize: '11px' }}>{foundOrder.created_at}</div>
                  <div style={{ color: '#00e676', fontWeight: 'bold', fontSize: '20px', marginTop: '4px' }}>${Number(foundOrder.total).toFixed(2)} MXN</div>
                </div>
              </div>

              <div style={{ marginBottom: '15px' }}>
                <div style={{ color: '#aaa', fontSize: '12px', marginBottom: '5px' }}>DESGLOSE DE PRODUCTOS:</div>
                {foundOrder.items.map((it, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '4px 0', borderBottom: '1px dashed #222' }}>
                    <span>{it.qty}x {it.name} (${Number(it.unitPrice).toFixed(2)})</span>
                    <span style={{ color: '#00e676' }}>${Number(it.subtotal).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => onReprintTicket({ id: foundOrder.id, customerName: foundOrder.customer_name, source: foundOrder.source, total: foundOrder.total, items: foundOrder.items, completedAt: foundOrder.created_at })}
                style={{ width: '100%', backgroundColor: '#00c853', color: '#000', border: 'none', padding: '10px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                🖨️ REIMPRIMIR TICKET DE ESTA ORDEN
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'catalog' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '15px' }}>
          <div style={{ backgroundColor: '#1e1e1e', padding: '15px', border: '1px solid #333' }}>
            <h3 style={{ color: '#ffea00', marginTop: 0 }}>+ Agregar Producto</h3>
            <form onSubmit={handleAddProduct} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input type="text" placeholder="Nombre del producto" value={name} onChange={(e) => setName(e.target.value)} style={{ backgroundColor: '#000', border: '1px solid #444', color: '#fff', padding: '8px' }} />
              <input type="text" placeholder="Categoría" value={category} onChange={(e) => setCategory(e.target.value)} style={{ backgroundColor: '#000', border: '1px solid #444', color: '#fff', padding: '8px' }} />
              <input type="number" placeholder="Precio" value={price} onChange={(e) => setPrice(e.target.value)} style={{ backgroundColor: '#000', border: '1px solid #444', color: '#fff', padding: '8px' }} />
              <button type="submit" style={{ backgroundColor: '#2979ff', color: '#fff', border: 'none', padding: '10px', fontWeight: 'bold', cursor: 'pointer' }}>Guardar Producto</button>
            </form>
          </div>

          <div style={{ backgroundColor: '#1e1e1e', padding: '15px', border: '1px solid #333' }}>
            <h3 style={{ color: '#00e5ff', marginTop: 0 }}>Lista de Productos en SQLite</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {products.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: '#000', padding: '8px 12px', border: '1px solid #333' }}>
                  <span>{p.name} <span style={{ color: '#777' }}>({p.category})</span></span>
                  <div>
                    <span style={{ color: '#00e676', marginRight: '15px' }}>${Number(p.price).toFixed(2)}</span>
                    <button onClick={() => handleDeleteProduct(p.id)} style={{ backgroundColor: '#ff1744', color: '#fff', border: 'none', padding: '2px 8px', cursor: 'pointer', fontWeight: 'bold' }}>X</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'brand' && (
        <div style={{ backgroundColor: '#1e1e1e', padding: '20px', border: '1px solid #333', maxWidth: '600px' }}>
          <h3 style={{ color: '#00e5ff', marginTop: 0, marginBottom: '15px' }}>⚙️ Personalización de Nombre y Logotipo</h3>
          
          {brandSavedMsg && <div style={{ backgroundColor: '#00c853', color: '#000', padding: '8px', fontWeight: 'bold', marginBottom: '15px' }}>{brandSavedMsg}</div>}

          <form onSubmit={handleSaveBrandSettings} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '5px' }}>Nombre Comercial de la Empresa:</label>
              <input type="text" value={inputBrandName} onChange={(e) => setInputBrandName(e.target.value)} placeholder="Ej. MI NEGOCIO" style={{ width: '100%', backgroundColor: '#000', border: '1px solid #555', color: '#fff', padding: '10px', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '5px' }}>Seleccionar Archivo de Logotipo (.png, .jpg, .jpeg, .webp):</label>
              <input type="file" accept="image/*" onChange={handleImageFileChange} style={{ width: '100%', backgroundColor: '#000', border: '1px solid #555', color: '#fff', padding: '8px', fontSize: '12px', boxSizing: 'border-box', cursor: 'pointer' }} />
            </div>

            {logoPreview && (
              <div>
                <span style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '5px' }}>Imagen Seleccionada:</span>
                <div style={{ backgroundColor: '#000', padding: '10px', display: 'inline-flex', alignItems: 'center', gap: '15px', border: '1px solid #333', borderRadius: '4px' }}>
                  <img src={logoPreview} alt="Vista Previa" style={{ height: '48px', width: 'auto', objectFit: 'contain' }} />
                  <button type="button" onClick={() => setLogoPreview('')} style={{ backgroundColor: '#d32f2f', color: '#fff', border: 'none', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 'bold' }}>Quitar Logo</button>
                </div>
              </div>
            )}

            <button type="submit" style={{ backgroundColor: '#00c853', color: '#000', border: 'none', padding: '12px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>
              💾 GUARDAR CAMBIOS DE MARCA
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function KDSGrid({ orders, onAdvanceStatus }) {
  const totalSlotsCount = Math.max(8, orders.length);
  const slots = Array.from({ length: totalSlotsCount });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gridAutoRows: '280px',
      gap: '8px',
      width: '100%',
      maxHeight: '80vh',
      overflowY: 'auto',
      paddingRight: '4px',
      boxSizing: 'border-box'
    }}>
      {slots.map((_, index) => {
        const order = orders[index];
        if (order) return <KDSTicket key={order.id} order={order} slotNumber={index + 1} onAdvance={() => onAdvanceStatus(order)} />;
        return <div key={index} style={{ backgroundColor: '#555555', border: '1px solid #666666', borderRadius: '2px', minHeight: '280px' }} />;
      })}
    </div>
  );
}

function KDSTicket({ order, slotNumber, onAdvance }) {
  const isPreparing = order.status === 'En Preparación';

  return (
    <div style={{ backgroundColor: '#000000', border: isPreparing ? '2px solid #ffea00' : '1px solid #444444', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', boxSizing: 'border-box' }}>
      <div>
        <div style={{ backgroundColor: isPreparing ? '#ffea00' : '#00e676', color: '#000', padding: '4px 8px', fontWeight: 'bold', fontSize: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{slotNumber < 10 ? `0${slotNumber}` : slotNumber}</span>
          <span style={{ fontSize: '11px', textTransform: 'uppercase' }}>[ {order.status.toUpperCase()} ]</span>
          <span>{order.minutes}</span>
        </div>

        <div style={{ padding: '8px', borderBottom: '1px solid #222' }}>
          <div style={{ color: '#ffea00', fontWeight: 'bold', fontSize: '13px' }}>Orden# {order.id}</div>
          <div style={{ color: '#00e5ff', fontWeight: 'bold', fontSize: '14px', textTransform: 'uppercase' }}>CLIENTE: {order.customerName}</div>
          <div style={{ color: '#00e5ff', fontSize: '11px' }}>Vía: {order.source}</div>
        </div>

        <div style={{ padding: '8px', fontSize: '13px', lineHeight: '1.4' }}>
          {order.items.map((item, idx) => (
            <div key={idx} style={{ color: '#ffffff', fontWeight: 'bold' }}>
              {item.qty} {item.name}
            </div>
          ))}
          <div style={{ color: '#aaaaaa', fontSize: '11px', marginTop: '6px' }}>Fin de Comanda</div>
        </div>
      </div>

      <div style={{ padding: '6px', borderTop: '1px solid #222' }}>
        <button onClick={onAdvance} style={{ width: '100%', backgroundColor: isPreparing ? '#ffea00' : '#00c853', color: '#000', border: 'none', padding: '10px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
          {isPreparing ? 'LISTO' : 'EN PREPARACIÓN'}
        </button>
      </div>
    </div>
  );
}

function TicketModal({ ticket, brandName, brandLogo, onClose }) {
  const handlePrint = () => window.print();
  const total = ticket.total || ticket.items.reduce((acc, item) => acc + ((item.unitPrice || 0) * item.qty), 0);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
      <div style={{ backgroundColor: '#ffffff', color: '#000000', padding: '20px', width: '320px', fontFamily: 'monospace', boxShadow: '0 0 20px rgba(255,255,255,0.2)', borderRadius: '4px' }}>
        <div style={{ textAlign: 'center', borderBottom: '2px dashed #000', paddingBottom: '10px', marginBottom: '10px' }}>
          {brandLogo && <img src={brandLogo} alt="Logo" style={{ maxHeight: '45px', width: 'auto', marginBottom: '6px', objectFit: 'contain' }} />}
          <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: '900' }}>{brandName || 'MI EMPRESA'}</h2>
          <p style={{ margin: 0, fontSize: '12px' }}>Punto de Venta & Despacho</p>
          <p style={{ margin: '4px 0 0 0', fontSize: '11px' }}>--------------------------------</p>
        </div>

        <div style={{ fontSize: '12px', lineHeight: '1.5', marginBottom: '10px' }}>
          <div><strong>FOLIO / ORDEN:</strong> #{ticket.id}</div>
          <div><strong>FECHA/HORA:</strong> {ticket.completedAt}</div>
          <div><strong>CLIENTE:</strong> {ticket.customerName}</div>
          <div><strong>ORIGEN:</strong> {ticket.source}</div>
          <div><strong>ESTADO:</strong> EMPACADO / LISTO</div>
        </div>

        <div style={{ borderBottom: '1px dashed #000', margin: '10px 0' }} />

        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '6px' }}>CANT. DESCRIPCIÓN</div>
          {ticket.items.map((item, idx) => (
            <div key={idx} style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>{item.qty} x {item.name}</span>
              {item.subtotal && <span>${item.subtotal.toFixed(2)}</span>}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '2px dashed #000', borderBottom: '2px dashed #000', padding: '8px 0', margin: '10px 0', display: 'flex', justifyContent: 'space-between', fontWeight: '900', fontSize: '16px' }}>
          <span>TOTAL:</span>
          <span>${Number(total).toFixed(2)} MXN</span>
        </div>

        <div style={{ textAlign: 'center', fontSize: '11px', marginTop: '10px' }}>
          <p style={{ margin: 0, fontWeight: 'bold' }}>*** PEDIDO VERIFICADO ***</p>
          <p style={{ margin: '4px 0 0 0' }}>¡Gracias por su preferencia!</p>
        </div>

        <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
          <button onClick={handlePrint} style={{ flex: 1, backgroundColor: '#00c853', color: '#fff', border: 'none', padding: '10px', fontWeight: 'bold', cursor: 'pointer' }}>🖨️ IMPRIMIR</button>
          <button onClick={onClose} style={{ flex: 1, backgroundColor: '#d32f2f', color: '#fff', border: 'none', padding: '10px', fontWeight: 'bold', cursor: 'pointer' }}>CERRAR</button>
        </div>
      </div>
    </div>
  );
}
