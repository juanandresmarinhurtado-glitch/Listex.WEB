require('dotenv').config();
const express = require('express');
const cors = require('cors');
const xmlrpc = require('xmlrpc');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Servir la página web (archivos estáticos) alojada un nivel arriba (spatial-aurora)
app.use(express.static(path.join(__dirname, '..')));

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USERNAME = process.env.ODOO_USERNAME;
const ODOO_API_KEY = process.env.ODOO_API_KEY;
const PORT = process.env.PORT || 3000;

// Diagnóstico de Arranque: Verificar qué credenciales están cargadas
console.log(`[START] ODOO_URL: ${ODOO_URL}`);
console.log(`[START] API_KEY (últimos 8 chars): ...${ODOO_API_KEY ? ODOO_API_KEY.slice(-8) : 'UNDEFINED'}`);

// Helper para crear el cliente XML-RPC correcto analizando la URL
function getClientConfig(endpoint) {
    const url = new URL(ODOO_URL);
    const host = url.hostname;
    const port = url.port || (url.protocol === 'https:' ? 443 : 80);
    const isSecure = url.protocol === 'https:';

    const clientOptions = { host, port, path: endpoint };
    return isSecure ? xmlrpc.createSecureClient(clientOptions) : xmlrpc.createClient(clientOptions);
}

const commonClient = getClientConfig('/xmlrpc/2/common');
const modelsClient = getClientConfig('/xmlrpc/2/object');

let uid = null;

// Función de Autenticación en Odoo
function authenticate() {
    return new Promise((resolve, reject) => {
        // No cacheamos el UID permanentemente aquí para forzar validación si hay problemas de sesión
        console.log(`[AUTH] Intentando autenticar: DB=${ODOO_DB}, User=${ODOO_USERNAME}`);
        commonClient.methodCall('authenticate', [ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {}], (error, result) => {
            if (error || result === false) {
                console.error("[AUTH ERROR] Credenciales rechazadas por Odoo o error RPC:", error);
                return reject(error || new Error("Fallo de autenticación (Credenciales INVÁLIDAS)"));
            }
            uid = result;
            console.log("[AUTH SUCCESS] UID asignado:", uid);
            resolve(uid);
        });
    });
}

// Función genérica para ejecutar métodos en Odoo
function executeKw(model, method, args, kwargs = {}) {
    return new Promise((resolve, reject) => {
        console.log(`[Odoo CALL] ${model}.${method}`, JSON.stringify(args).substring(0, 100));
        modelsClient.methodCall('execute_kw', [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs], (error, result) => {
            if (error) {
                console.error(`[Odoo ERROR] [${model}.${method}]:`, error);
                return reject(error);
            }
            resolve(result);
        });
    });
}

// Endpoint de Diagnóstico: Verificar si las variables están cargadas y la conexión vive
app.get('/api/health', async (req, res) => {
    try {
        await authenticate();
        const partnerCount = await executeKw('res.partner', 'search_count', [[]]);
        res.json({
            status: "OK",
            message: "Conectado a Odoo correctamente",
            uid: uid,
            partners_found: partnerCount,
            env: {
                url: ODOO_URL,
                db: ODOO_DB,
                user: ODOO_USERNAME,
                apiKeySet: !!ODOO_API_KEY
            }
        });
    } catch (error) {
        res.status(500).json({
            status: "ERROR",
            error: error.message,
            env_debug: {
                url: ODOO_URL,
                db: ODOO_DB,
                user: ODOO_USERNAME,
                apiKeySet: !!ODOO_API_KEY
            }
        });
    }
});

// Obtener o crear un Partner Genérico Web
async function getWebPartnerId() {
    const records = await executeKw('res.partner', 'search', [[['name', '=', 'Cliente Web (Listex)']]], { limit: 1 });
    if (records && records.length > 0) {
        return records[0];
    }
    // Si no existe, crearlo
    const newPartnerId = await executeKw('res.partner', 'create', [{
        name: 'Cliente Web (Listex)',
        comment: 'Cliente genérico usado dinámicamente desde el carrito de la web.'
    }]);
    return newPartnerId;
}

// =========================================================================
// RUTAS DE LA API (Consumidas por app.js en el frontend)
// =========================================================================

// FASE 1: Crear el Presupuesto al agregar el primer producto
app.post('/api/cart/create', async (req, res) => {
    console.log("[POST] /api/cart/create");
    try {
        await authenticate();
        const partnerId = await getWebPartnerId();

        const orderId = await executeKw('sale.order', 'create', [{
            partner_id: partnerId,
            state: 'draft'
        }]);

        console.log(`[SUCCESS] Pedido creado: ${orderId}`);
        res.json({ success: true, order_id: orderId });
    } catch (error) {
        console.error("[ERROR] /api/cart/create:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/cart/add-line', async (req, res) => {
    const { order_id, product_id, quantity } = req.body;
    console.log(`[POST] /api/cart/add-line: Order=${order_id}, Prod=${product_id}, Qty=${quantity}`);
    try {
        if (!order_id || !product_id || !quantity) {
            return res.status(400).json({ success: false, error: "Datos insuficientes (order_id, product_id, quantity)" });
        }

        await authenticate();

        const parsedOrderId = parseInt(order_id);
        const parsedProductId = parseInt(product_id);
        const parsedQty = parseFloat(quantity);

        const lineData = {
            order_id: parsedOrderId,
            product_id: parsedProductId,
            product_uom_qty: parsedQty
        };

        // If a price_unit is provided, override Odoo's default list price
        if (price_unit !== undefined && price_unit !== null) {
            lineData.price_unit = parseFloat(price_unit);
        }

        const lineId = await executeKw('sale.order.line', 'create', [lineData]);

        res.json({ success: true, line_id: lineId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FASE 2: Confirmar pedido y actualizar datos reales del cliente
app.post('/api/checkout', async (req, res) => {
    const { order_id, cart_items, customer_data } = req.body;
    console.log(`[POST] /api/checkout: Order=${order_id}, Items=${cart_items ? cart_items.length : 0}`);
    try {
        if (!order_id || !customer_data) {
            console.warn("[WARN] /api/checkout: Faltan order_id o customer_data");
            return res.status(400).json({ success: false, error: "Faltan datos de pedido o cliente" });
        }

        await authenticate();
        const parsedOrderId = parseInt(order_id);
        console.log(`[CHECKOUT] Iniciando procesamiento para orden: ${parsedOrderId}`);

        // 1. Crear el Contacto Real en Odoo con los datos del formulario web
        const realPartnerId = await executeKw('res.partner', 'create', [{
            name: `${customer_data.fname || ''} ${customer_data.lname || ''}`.trim(),
            vat: customer_data.cedula || '',
            email: customer_data.email || '',
            phone: customer_data.phone || '',
            street: customer_data.address || '',
            city: customer_data.state || '',
            comment: `Cédula: ${customer_data.cedula || ''}\nMétodo de Envío: ${customer_data.shipping_method}\nAgencia/Dirección: ${customer_data.agency || ''}`
        }]);

        // 2. Escribir (Asignar) este cliente real al Presupuesto existente y añadir notas
        // IMPORTANTE: Asignamos el partner ANTES de sincronizar líneas para evitar que Odoo recalcule precios y sobreescriba nuestro price_unit
        await executeKw('sale.order', 'write', [[parsedOrderId], {
            partner_id: realPartnerId,
            client_order_ref: `ENVÍO: ${customer_data.shipping_method} | ${customer_data.agency || ''}`.substring(0, 100),
            note: `**DATOS COMPLETOS DE FACTURACIÓN**\nCédula: ${customer_data.cedula || ''}\nMétodo: ${customer_data.shipping_method}\nAgencia/Dirección: ${customer_data.agency || ''}`,
            state: 'sent'
        }]);

        // 3. Re-sync cart lines (DESPUÉS de asignar partner para que price_unit persista)
        if (cart_items && cart_items.length > 0) {
            let existingLines = [];
            try {
                existingLines = await executeKw('sale.order.line', 'search_read',
                    [[['order_id', '=', parsedOrderId]]],
                    { fields: ['id', 'product_id', 'price_unit', 'product_uom_qty'] }
                );
            } catch (e) {
                console.warn('Could not fetch existing order lines:', e.message);
            }

            const existingByProduct = {};
            existingLines.forEach(l => {
                if (l.product_id) existingByProduct[l.product_id[0]] = l;
            });

            for (const item of cart_items) {
                const pId = parseInt(item.product_id);
                if (!pId || isNaN(pId)) continue;
                const effectivePrice = (item.price != null && !isNaN(item.price)) ? parseFloat(item.price) : null;

                if (existingByProduct[pId]) {
                    if (effectivePrice !== null) {
                        const currentPrice = parseFloat(existingByProduct[pId].price_unit);
                        if (Math.abs(currentPrice - effectivePrice) > 0.001) {
                            await executeKw('sale.order.line', 'write', [[existingByProduct[pId].id], { price_unit: effectivePrice }]);
                            console.log(`Updated price for product ${pId}: ${currentPrice} -> ${effectivePrice}`);
                        }
                    }
                } else {
                    const lineData = { order_id: parsedOrderId, product_id: pId, product_uom_qty: parseFloat(item.quantity) };
                    if (effectivePrice !== null) lineData.price_unit = effectivePrice;
                    await executeKw('sale.order.line', 'create', [lineData]);
                }
            }
        }

        // 3. Intentar disparar notificación Odoo (ignorar si falla)
        try {
            await executeKw('sale.order', 'action_quotation_send', [[parsedOrderId]]);
        } catch (e) { /* Ignorar si falla por requerir wizard interactiva */ }

        res.json({ success: true, message: "Cotización enviada exitosamente", order_id: parsedOrderId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// RUTA CATÁLOGO (Proxy para evitar bloqueos CORS temporales)
// =========================================================================
app.get('/api/products', async (req, res) => {
    console.log("[GET] /api/products (Catalog Proxy)");
    try {
        const cacheBuster = `?t=${new Date().getTime()}`;
        const catalogUrl = 'https://listex.odoo.com/web/content/16027/api_catalogo_listex.json';

        const response = await fetch(catalogUrl + cacheBuster);
        if (!response.ok) {
            console.error(`[ERROR] Fallo fetch catálogo Odoo: ${response.status}`);
            throw new Error(`Error HTTP: ${response.status}`);
        }
        const data = await response.json();
        console.log(`[SUCCESS] Catálogo cargado: ${data.length} productos`);
        res.json(data);
    } catch (error) {
        console.error("Error al obtener catálogo desde Odoo JSON:", error);
        res.status(500).json({ success: false, error: "No se pudo cargar el catálogo" });
    }
});

// =========================================================================
// PORTAL DE CLIENTES
// =========================================================================

// Endpoint de Login del Portal: Busca Partner por VAT (Cédula)
app.post('/api/portal/login', async (req, res) => {
    const { cedula } = req.body;
    console.log(`[PORTAL] Login attempt for VAT: ${cedula}`);
    try {
        if (!cedula) return res.status(400).json({ error: "Cédula requerida" });

        await authenticate();
        // Buscar partner por vat usando ilike para ser flexible
        const partners = await executeKw('res.partner', 'search_read', 
            [[['vat', 'ilike', cedula]]], 
            { fields: ['id', 'name', 'vat', 'email', 'phone', 'comment'], limit: 1 }
        );

        if (!partners || partners.length === 0) {
            console.log(`[PORTAL] Customer not found for VAT: ${cedula}`);
            return res.status(404).json({ success: false, error: "Cliente no encontrado. Por favor verifica los datos o contacta a soporte." });
        }

        const partner = partners[0];
        console.log(`[PORTAL] Login success: ${partner.name} (ID: ${partner.id})`);
        res.json({ success: true, partner });
    } catch (error) {
        console.error("[PORTAL ERROR] Login:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint Dashboard del Portal: Historial, Estados y Estadísticas
app.get('/api/portal/dashboard/:partner_id', async (req, res) => {
    const partnerId = parseInt(req.params.partner_id);
    console.log(`[PORTAL] Fetching dashboard for Partner ID: ${partnerId}`);
    try {
        await authenticate();

        // 1. Obtener el VAT del partner actual para buscar otros contactos con la misma cédula
        const currentPartnerData = await executeKw('res.partner', 'read', [[partnerId], ['vat']]);
        const vat = currentPartnerData[0].vat;
        
        if (!vat) {
             return res.status(400).json({ success: false, error: "El contacto no tiene cédula registrada." });
        }

        // 2. Buscar TODOS los partners que compartan esa misma cédula
        const allRelatedPartners = await executeKw('res.partner', 'search_read', 
            [[['vat', '=', vat]]], 
            { fields: ['id', 'commercial_partner_id'] }
        );

        const allPartnerIds = allRelatedPartners.map(p => p.id);
        const allCommercialIds = [...new Set(allRelatedPartners.map(p => p.commercial_partner_id ? p.commercial_partner_id[0] : p.id))];

        console.log(`[PORTAL] Aggregating orders for VAT ${vat}. Partners found: ${allPartnerIds.length}`);

        // 3. Obtener Órdenes de Venta para cualquiera de esos partners o sus hijos
        const orders = await executeKw('sale.order', 'search_read',
            [['|', ['partner_id', 'in', allPartnerIds], ['partner_id', 'child_of', allCommercialIds]]],
            { 
                fields: ['name', 'date_order', 'state', 'amount_total', 'x_studio_numero_de_guia', 'picking_ids', 'company_id'],
                order: 'date_order desc'
            }
        );
        
        console.log(`[PORTAL] Found ${orders ? orders.length : 0} orders total.`);

        // 4. Obtener TODAS las líneas y pickings en bloque para evitar N+1 queries
        let topProducts = [];
        const allPickingIds = [];
        const orderIds = orders.map(o => {
            if (o.picking_ids) allPickingIds.push(...o.picking_ids);
            return o.id;
        });

        // 2a. Estadísticas de Productos
        if (orderIds.length > 0) {
            const lines = await executeKw('sale.order.line', 'search_read',
                [[['order_id', 'in', orderIds]]],
                { fields: ['product_id', 'product_uom_qty'] }
            );

            const productCounts = {};
            lines.forEach(line => {
                if (!line.product_id) return;
                const pId = line.product_id[0];
                const pName = line.product_id[1];
                if (!productCounts[pId]) productCounts[pId] = { id: pId, name: pName, qty: 0 };
                productCounts[pId].qty += line.product_uom_qty;
            });
            topProducts = Object.values(productCounts).sort((a, b) => b.qty - a.qty).slice(0, 5);
        }

        // 2b. Datos de Inventario (Despachos) en bloque
        let allPickings = [];
        if (allPickingIds.length > 0) {
            allPickings = await executeKw('stock.picking', 'search_read',
                [[['id', 'in', allPickingIds]]],
                { fields: ['state', 'origin', 'sale_id'] } // Eliminado campo inexistente
            );
        }
        
        // Mapear pickings a sus órdenes para acceso rápido (usando el ID numérico de la orden)
        const pickingsByOrderId = {};
        allPickings.forEach(p => {
            const sId = p.sale_id ? p.sale_id[0] : null;
            if (sId) {
                if (!pickingsByOrderId[sId]) pickingsByOrderId[sId] = [];
                pickingsByOrderId[sId].push(p);
            } else if (p.origin) {
                const foundOrder = orders.find(o => o.name === p.origin);
                if (foundOrder) {
                    if (!pickingsByOrderId[foundOrder.id]) pickingsByOrderId[foundOrder.id] = [];
                    pickingsByOrderId[foundOrder.id].push(p);
                }
            }
        });

        // 3. Procesar Estados con lógica personalizada (Prioridad por datos reales)
        const enrichedOrders = orders.map(order => {
            let listexStatus = "Indefinido";
            let trackingNumber = order.x_studio_numero_de_guia || ""; // Usar campo de la orden

            // Buscar pickings asociados
            const pings = pickingsByOrderId[order.id] || [];
            const anyPickingDone = pings.some(p => p.state === 'done');

            // --- REGLAS DE MAPEO (Prioridad de arriba hacia abajo) ---
            
            if (trackingNumber) {
                // 1. Si hay número de guía, el paquete está en la agencia (Prioridad Máxima)
                listexStatus = "Pedido entregado en agencia";
            } else if (anyPickingDone) {
                // 2. Si el picking está 'done' pero no hay guía aún
                listexStatus = "Pedido empacado";
            } else if (order.state === 'sale' || order.state === 'done') {
                // 3. Si la orden está confirmada pero no hay despacho completado
                listexStatus = "Pago confirmado";
            } else if (order.state === 'draft' || order.state === 'sent') {
                // 4. Si es presupuesto/cotización
                listexStatus = "Esperando validación del pago";
            } else if (order.state === 'cancel') {
                // 5. Si fue cancelado (y no tiene guía, de lo contrario habría caído en la regla 1)
                listexStatus = "Pedido cancelado";
            }

            return {
                id: order.id,
                ref: order.name,
                date: order.date_order,
                total: order.amount_total,
                status: listexStatus,
                tracking: trackingNumber
            };
        });

        res.json({
            success: true,
            summary: {
                total_orders: orders.length,
                total_spent: enrichedOrders.reduce((sum, o) => sum + o.total, 0)
            },
            orders: enrichedOrders,
            top_products: topProducts
        });

    } catch (error) {
        console.error("[PORTAL ERROR] Dashboard API Failure:", error);
        res.status(500).json({ success: false, error: "Error de sincronización con Odoo: " + error.message });
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Backend Listex Odoo escuchando en el puerto ${PORT}`);
});
