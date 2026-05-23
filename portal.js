/**
 * Listex Customer Portal - Main Logic
 */

// State
let currentUser = JSON.parse(localStorage.getItem('listex_portal_user')) || null;
let dashboardData = null;

// DOM Elements
const DOM = {
    loginView: document.getElementById('login-view'),
    dashboardView: document.getElementById('dashboard-view'),
    loginForm: document.getElementById('login-form'),
    idInput: document.getElementById('id-number'),
    userName: document.getElementById('user-name'),
    logoutBtn: document.getElementById('logout-btn'),
    ordersContainer: document.getElementById('orders-container'),
    favoritesList: document.getElementById('favorites-list'),
    toast: document.getElementById('portal-toast'),
    // Stats
    statTotalOrders: document.getElementById('stat-total-orders'),
    statTotalSpent: document.getElementById('stat-total-spent'),
    // Modal
    trackingModal: document.getElementById('tracking-modal'),
    trackingModalBody: document.getElementById('tracking-modal-body')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (currentUser) {
        showView('dashboard');
        loadDashboard();
    } else {
        showView('login');
    }
});

// View Management
function showView(viewName) {
    DOM.loginView.classList.toggle('active', viewName === 'login');
    DOM.dashboardView.classList.toggle('active', viewName === 'dashboard');
}

// Authentication
DOM.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cedula = DOM.idInput.value.trim();
    if (!cedula) return;

    setLoading(true);

    try {
        const response = await fetch('/api/portal/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cedula })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = data.partner;
            localStorage.setItem('listex_portal_user', JSON.stringify(currentUser));
            showView('dashboard');
            loadDashboard();
            showToast(`¡Bienvenido, ${currentUser.name.split(' ')[0]}!`);
        } else {
            showToast(data.error || "Error al acceder", "error");
        }
    } catch (error) {
        showToast("Error de conexión con el servidor", "error");
    } finally {
        setLoading(false);
    }
});

DOM.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('listex_portal_user');
    currentUser = null;
    showView('login');
    showToast("Sesión cerrada");
});

async function loadDashboard() {
    if (!currentUser) return;

    DOM.ordersContainer.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Sincronizando con Odoo...</p></div>`;
    DOM.userName.textContent = `Hola, ${currentUser.name.split(' ')[0]}`;

    try {
        const response = await fetch(`/api/portal/dashboard/${currentUser.id}`);
        const data = await response.json();

        if (data.success) {
            dashboardData = data;
            renderDashboard();
        } else {
            DOM.ordersContainer.innerHTML = `
                <div class="loading-state">
                    <ion-icon name="alert-circle-outline" style="font-size: 3rem; color: #ef4444; margin-bottom: 1rem"></ion-icon>
                    <p>${data.error || "No se pudieron cargar tus datos"}</p>
                    <button class="btn-portal btn-primary" onclick="loadDashboard()" style="margin-top: 1rem; max-width: 200px; margin: 1rem auto">Reintentar</button>
                </div>
            `;
            showToast(data.error || "Error de sincronización", "error");
        }
    } catch (error) {
        DOM.ordersContainer.innerHTML = `
            <div class="loading-state">
                <ion-icon name="cloud-offline-outline" style="font-size: 3rem; color: #ef4444; margin-bottom: 1rem"></ion-icon>
                <p>Error de conexión con el servidor.</p>
                <button class="btn-portal btn-primary" onclick="loadDashboard()" style="margin-top: 1rem; max-width: 200px; margin: 1rem auto">Reintentar</button>
            </div>
        `;
        showToast("Error al cargar el historial", "error");
    }
}

function renderDashboard() {
    // 1. Stats
    DOM.statTotalOrders.textContent = dashboardData.summary.total_orders;
    DOM.statTotalSpent.textContent = formatCurrency(dashboardData.summary.total_spent);

    // 2. Favorites
    DOM.favoritesList.innerHTML = dashboardData.top_products.length > 0 
        ? dashboardData.top_products.map((p, i) => `
            <li class="fav-item">
                <div class="fav-rank">${i + 1}</div>
                <div class="fav-name">${p.name}</div>
            </li>
        `).join('')
        : '<p class="empty-msg">Aún no tienes compras frecuentes.</p>';

    // 3. Orders Table
    if (dashboardData.orders.length === 0) {
        DOM.ordersContainer.innerHTML = `
            <div class="loading-state">
                <ion-icon name="receipt-outline" style="font-size: 3rem; opacity: 0.2; margin-bottom: 1rem"></ion-icon>
                <p>No tienes pedidos registrados todavía.</p>
                <a href="index.html" class="btn-portal btn-primary" style="margin-top: 1.5rem; max-width: 200px; margin-left: auto; margin-right: auto;">Ir a la Tienda</a>
            </div>
        `;
        return;
    }

    let tableHTML = `
        <table class="orders-table">
            <thead>
                <tr>
                    <th>Referencia</th>
                    <th>Fecha</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th>Acción</th>
                </tr>
            </thead>
            <tbody>
    `;

    dashboardData.orders.forEach(order => {
        const statusClass = getStatusClass(order.status);
        tableHTML += `
            <tr>
                <td><strong>${order.ref}</strong></td>
                <td>${formatDate(order.date)}</td>
                <td><strong>${formatCurrency(order.total)}</strong></td>
                <td><span class="status-badge ${statusClass}">${order.status}</span></td>
                <td>
                    <button class="btn-details" onclick="viewOrderDetail('${order.id}')">Ver Detalle</button>
                </td>
            </tr>
        `;
    });

    tableHTML += '</tbody></table>';
    DOM.ordersContainer.innerHTML = tableHTML;
}

// Logic for Tracking (Trampolín JS)
window.viewOrderDetail = function(orderId) {
    const order = dashboardData.orders.find(o => o.id == orderId);
    if (!order) return;

    let content = `
        <div class="tracking-info">
            <p style="margin-bottom: 0.5rem; color: var(--portal-text-muted)">Pedido: <strong>${order.ref}</strong></p>
            <p>Estado: <span class="status-badge ${getStatusClass(order.status)}">${order.status}</span></p>
    `;

    if (order.status === "Pedido entregado en agencia" && order.tracking) {
        content += `
            <div class="guia-box">
                <p style="font-size: 0.8rem; text-transform: uppercase; margin-bottom: 0.5rem">Número de Guía</p>
                <div class="guia-number">${order.tracking}</div>
            </div>
            <p class="tracking-instructions">
                Haz clic abajo para copiar la guía. Se abrirá la página de la agencia donde deberás pegarla para ver el estatus real.
            </p>
            <button class="btn-portal btn-primary" onclick="handleTrackingAction('${order.tracking}')">
                <ion-icon name="copy-outline"></ion-icon>
                <span>Rastrear Envío</span>
            </button>
        `;
    } else {
        content += `
            <div class="loading-state" style="padding: 2rem 0">
                <ion-icon name="time-outline" style="font-size: 2.5rem; opacity: 0.2; margin-bottom: 1rem"></ion-icon>
                <p>Tu pedido está en proceso. Pronto verás aquí tu número de seguimiento.</p>
            </div>
        `;
    }

    content += `</div>`;
    DOM.trackingModalBody.innerHTML = content;
    DOM.trackingModal.classList.add('active');
};

window.handleTrackingAction = async function(rawTracking) {
    const agency = rawTracking.toUpperCase().includes('MRW') ? 'MRW' : 
                   rawTracking.toUpperCase().includes('ZOOM') ? 'ZOOM' : null;
    
    // Limpiar el número de guía (solo dígitos)
    const cleanNumber = rawTracking.replace(/[^0-9]/g, '');
    
    const trackingUrls = {
        'MRW': 'https://mrwve.com/',
        'ZOOM': 'https://zoom.red/personas/rastreo-de-envios/'
    };

    try {
        await navigator.clipboard.writeText(cleanNumber);
        alert(`¡Número ${cleanNumber} copiado!\n\nSerás redirigido a la web de ${agency || 'la agencia'}. Por favor, PEGA el número en la sección de rastreo.`);
    } catch (err) {
        alert(`No pudimos copiar automáticamente. Por favor anota tu número: ${cleanNumber}\n\nSerás redirigido a la web de ${agency || 'la agencia'}.`);
    }

    if (agency && trackingUrls[agency]) {
        window.open(trackingUrls[agency], '_blank');
    } else {
        // Genérico si no se identifica
        window.open('https://www.google.com/search?q=rastreo+envio', '_blank');
    }
};

window.closeTrackingModal = function() {
    DOM.trackingModal.classList.remove('active');
};

// Utils
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getStatusClass(status) {
    if (status.includes("validación")) return "status-validando";
    if (status.includes("confirmado")) return "status-confirmado";
    if (status.includes("empacado")) return "status-empacado";
    if (status.includes("entregado")) return "status-entregado";
    if (status.includes("cancelado")) return "status-cancelado";
    return "";
}

function showToast(msg, type = "info") {
    DOM.toast.textContent = msg;
    DOM.toast.style.background = type === "error" ? "#ef4444" : "var(--portal-primary)";
    DOM.toast.classList.add('active');
    setTimeout(() => DOM.toast.classList.remove('active'), 3000);
}

function setLoading(isLoading) {
    const btn = document.getElementById('login-btn');
    if (isLoading) {
        btn.classList.add('disabled');
        btn.innerHTML = `<div class="spinner" style="width: 20px; height: 20px; margin: 0"></div>`;
    } else {
        btn.classList.remove('disabled');
        btn.innerHTML = `<span>Acceder</span><ion-icon name="arrow-forward-outline"></ion-icon>`;
    }
}
