/* ==========================================================================
   State & Constants
   ========================================================================== */
const API_URL = 'https://listex.odoo.com/web/content/16027/api_catalogo_listex.json';
const WHATSAPP_NUMBER = '584244329649'; // Vendedor

let allProducts = [];
let uniqueProducts = [];
let cart = []; // Note: stores exact variant objects now
let currentCategory = 'all';

function getPseudoViews(str) {
    if (!str) return 0;
    if (window.globalViews && window.globalViews[str] !== undefined) {
        return window.globalViews[str];
    }
    const baseViews = 0;
    try {
        const viewsStr = localStorage.getItem('listex_product_views');
        if (!viewsStr) return baseViews;
        const viewsObj = JSON.parse(viewsStr);
        return baseViews + (viewsObj[str] || 0);
    } catch (e) {
        return baseViews;
    }
}

function incrementViews(str) {
    if (!str) return;
    if (window.firebaseIncrementViews) {
        window.firebaseIncrementViews(str);
    }
    try {
        const viewsStr = localStorage.getItem('listex_product_views') || '{}';
        const viewsObj = JSON.parse(viewsStr);
        viewsObj[str] = (viewsObj[str] || 0) + 1;
        localStorage.setItem('listex_product_views', JSON.stringify(viewsObj));
    } catch (e) { }
}

// DOM Elements
const DOM = {
    // Buttons
    openCartBtn: document.getElementById('open-cart-btn'),
    closeCartBtn: document.getElementById('close-cart-btn'),
    checkoutBtn: document.getElementById('checkout-btn'),
    closeModalBtn: document.getElementById('close-modal-btn'),

    // Overlays & Sections
    overlay: document.getElementById('overlay'),
    cartSidebar: document.getElementById('cart-sidebar'),
    checkoutModal: document.getElementById('checkout-modal'),
    toast: document.getElementById('toast'),

    // Grids & Containers
    categoriesContainer: document.getElementById('categories-container'),
    topBannerContent: document.getElementById('top-banner-content'),
    categoryCarouselsContainer: document.getElementById('category-carousels-container'),
    searchResultsGrid: document.getElementById('search-results-grid'),
    searchResultsSection: document.getElementById('search-results-section'),

    // Cart elements
    cartBadge: document.getElementById('cart-badge'),
    cartItemsContainer: document.getElementById('cart-items'),
    cartTotal: document.getElementById('cart-total-price'),

    // Search
    searchInput: document.getElementById('search-input'),
    mobileSearchInput: document.getElementById('mobile-search-input'),

    // Form
    checkoutForm: document.getElementById('checkout-form'),
    shippingMethod: document.getElementById('shipping-method'),
    dynamicShippingFields: document.getElementById('dynamic-shipping-fields')
};

/* ==========================================================================
   Initialization & Fetching
   ========================================================================== */
async function initApp() {
    // Always set up UI interactions regardless of data loading
    setupEventListeners();

    try {
        let data;

        // Extraer datos asegurando que no haya bloqueos CORS ni CACHÉ del navegador
        const cacheBuster = `?t=${new Date().getTime()}`;
        const response = await fetch(`/api/products${cacheBuster}`);
        if (!response.ok) {
            throw new Error(`Error del Servidor: ${response.status}`);
        }
        data = await response.json();

        // Map new API structure to expected internal structure
        allProducts = data.map(p => {
            let newP = {
                id_producto: parseInt(p.id_producto || 0),
                Handle: p.nombre, // Group by exact base product name
                Nombre_Producto: p.nombre,
                Categoria_Interna_Principal: (p.categorias_web && p.categorias_web.length > 0) ? p.categorias_web[0] : (p.categoria_principal || 'General'),
                Descripcion_Producto: p.descripcion,
                URL_Imagen: p.imagen_url,
                Precio: p.precio_base, // Base price for unidad variada
                Moneda_Principal: 'EUR',
                Cantidad_Disponible: p.stock_disponible,
                Disponibilidad: p.disponibilidad,
                PermitirVentaSinStock: p.permitir_venta_sin_stock,
                _raw_tarifas: p.tarifas_multiples
            };

            // Flatten variantes array
            if (p.variantes && p.variantes.length > 0) {
                p.variantes.forEach((v, idx) => {
                    if (idx < 4) {
                        newP[`Atributo_${idx + 1}_Nombre`] = v.atributo;
                        newP[`Atributo_${idx + 1}_Valor`] = v.valor;
                    }
                });
            }
            return newP;
        });

        // Agrupar por Handle para mostrar un solo card por producto
        const grouped = {};
        allProducts.forEach(p => {
            if (!grouped[p.Handle]) {
                grouped[p.Handle] = p;
            }
        });
        uniqueProducts = Object.values(grouped);

        // Extraer categorías únicas
        const categories = [...new Set(uniqueProducts.map(p => p.Categoria_Interna_Principal).filter(c => c))];

        renderCategories(categories);
        renderSections(); // This now only renders top sections

        loadCartFromStorage();

        // Trigger routing after data is ready
        handleRouting();

        // Setup lazy loading for the main catalog
        setupLazyCatalog();

    } catch (error) {
        console.error('Error fetching products:', error);
        showToast('Error cargando los productos. Por favor, recarga la página.');
    }
}

/**
 * Optimiza las URLs de Odoo para cargar versiones redimensionadas (miniaturas).
 * Si la URL es de Odoo, intenta forzar un tamaño pequeño.
 */
function getOdooThumbnailUrl(url, size = 128) {
    if (!url || typeof url !== 'string') return url;
    
    // Si la URL es de Odoo (web/image o similar), podemos intentar inyectar parámetros de reescalado
    // Odoo soporta /web/image/model/id/field/widthxheight
    if (url.includes('web/image') || url.includes('web/content')) {
        // Si ya tiene parámetros, los respetamos o añadimos
        const separator = url.includes('?') ? '&' : '?';
        // intentamos añadir resize o similar si el proxy lo soporta, 
        // pero la forma más estándar de Odoo es cambiar la URL directamente.
        // Dado que vienen de un JSON estático, usualmente son links directos.
        // Si detectamos el patrón estándar de Odoo:
        return `${url}${separator}unique=1&width=${size}&height=${size}`;
    }
    return url;
}

/* ==========================================================================
   Rendering Carousels & Sections
   ========================================================================== */
// Global state for category filtering
let currentCategoryFilter = null;

function setupAutoScroll(containerId, intervalMs = 3000) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Clear existing interval if any (useful for re-renders)
    if (container.autoScrollInterval) {
        clearInterval(container.autoScrollInterval);
    }

    container.autoScrollInterval = setInterval(() => {
        const firstChild = container.firstElementChild;
        if (!firstChild) return;

        const scrollAmount = firstChild.offsetWidth + parseFloat(window.getComputedStyle(firstChild).marginRight || 0) + parseFloat(window.getComputedStyle(container).gap || 0);

        // Check if we reached the end
        if (container.scrollLeft + container.clientWidth >= container.scrollWidth - 5) {
            container.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        }
    }, intervalMs);
}

function renderCategories(categories) {
    const container = document.getElementById('categories-container');
    if (!container) return;
    container.innerHTML = '';

    categories.slice(0, 10).forEach(cat => {
        const catProduct = uniqueProducts.find(p => p.Categoria_Interna_Principal === cat && p.URL_Imagen && p.URL_Imagen !== "false");
        const imgUrl = catProduct ? catProduct.URL_Imagen : 'https://via.placeholder.com/150?text=' + encodeURIComponent(cat.charAt(0));

        const card = document.createElement('div');
        card.className = 'category-card';
        card.onclick = () => openCategoryPage(cat);

        card.innerHTML = `
            <div class="category-img-wrap">
                <img src="${imgUrl}" alt="${cat}" loading="lazy" onerror="this.src='https://via.placeholder.com/150?text=${encodeURIComponent(cat.charAt(0))}'">
            </div>
            <span class="category-name">${cat}</span>
        `;
        container.appendChild(card);
    });
}

function renderSections() {
    // 1. Ofertas de la semana (Lowest price first)
    const ofertasContainer = document.getElementById('ofertas-container');
    if (ofertasContainer) {
        ofertasContainer.innerHTML = '';
        const lowestPriceProducts = [...uniqueProducts].sort((a, b) => parseFloat(a.Precio) - parseFloat(b.Precio)).slice(0, 15);
        renderGridToContainer(lowestPriceProducts, ofertasContainer, false);
    }

    // 2. Productos Más Vistos (Horizontal auto-scroll)
    const masVistosContainer = document.getElementById('mas-vistos-container');
    if (masVistosContainer) {
        masVistosContainer.innerHTML = '';
        const mostViewedProducts = [...uniqueProducts].sort((a, b) => getPseudoViews(b.Handle) - getPseudoViews(a.Handle)).slice(0, 15);
        renderGridToContainer(mostViewedProducts, masVistosContainer, true);
        setupAutoScroll('mas-vistos-marquee', 2500);
    }

    // 3. Llegando Ahora / Más Nuevos (Horizontal auto-scroll, highest ID first)
    const masNuevosContainer = document.getElementById('mas-nuevos-container');
    if (masNuevosContainer) {
        masNuevosContainer.innerHTML = '';
        const newestProducts = [...uniqueProducts].sort((a, b) => parseInt(b.id_producto || '0') - parseInt(a.id_producto || '0')).slice(0, 15);
        renderGridToContainer(newestProducts, masNuevosContainer, true);
        setupAutoScroll('mas-nuevos-marquee', 2800);
    }

    // Setup auto scroll for ofertas
    setupAutoScroll('ofertas-container', 3000);
}

function setupLazyCatalog() {
    const catalogoSection = document.getElementById('catalogo-section');
    if (!catalogoSection) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                renderCatalogGrid();
                observer.unobserve(catalogoSection);
            }
        });
    }, { rootMargin: '200px' }); // Load 200px before reaching it

    observer.observe(catalogoSection);
}

function renderCatalogGrid() {
    const catalogContainer = document.getElementById('catalogo-container');
    if (!catalogContainer) return;

    // Remove skeletons
    catalogContainer.innerHTML = '';

    // 1. Group by category and calculate total views
    const categoryMap = {};
    uniqueProducts.forEach(p => {
        const cat = p.Categoria_Interna_Principal || 'Otros';
        if (!categoryMap[cat]) {
            categoryMap[cat] = {
                name: cat,
                products: [],
                totalViews: 0
            };
        }
        categoryMap[cat].products.push(p);
        categoryMap[cat].totalViews += getPseudoViews(p.Handle);
    });

    // 2. Sort categories by total views descending
    const sortedCategories = Object.values(categoryMap).sort((a, b) => b.totalViews - a.totalViews);

    // 3. Render each category block
    sortedCategories.forEach(catData => {
        // Create Category Header spanning all columns
        const headerRow = document.createElement('div');
        headerRow.style.gridColumn = '1 / -1';
        headerRow.style.marginTop = '1.5rem';
        headerRow.style.marginBottom = '0.5rem';
        headerRow.style.borderBottom = '1px solid #e2e8f0';
        headerRow.style.paddingBottom = '0.5rem';

        const title = document.createElement('h3');
        title.className = 'section-title';
        title.style.fontSize = '1.25rem';
        title.innerHTML = `<span style="color:var(--primary);">❯</span> ${catData.name} <span style="font-size:0.85rem;color:var(--text-muted);font-weight:normal;">(${catData.products.length})</span>`;
        headerRow.appendChild(title);

        catalogContainer.appendChild(headerRow);

        // Sort products inside this category by views descending
        catData.products.sort((a, b) => getPseudoViews(b.Handle) - getPseudoViews(a.Handle));

        // Appends the products directly to the grid below the header
        renderGridToContainer(catData.products, catalogContainer, false);
    });
}

function openCategoryPage(categoryName) {
    const homeView = document.getElementById('home-view');
    const catView = document.getElementById('category-page-view');
    const catGrid = document.getElementById('category-page-grid');
    const catTitle = document.getElementById('category-page-title');

    if (!homeView || !catView || !catGrid) return;

    // Hide home views, show category views
    homeView.classList.add('hidden');
    catView.classList.remove('hidden');

    // Set category header
    catTitle.textContent = categoryName;

    // Render products
    catGrid.innerHTML = '';
    const products = uniqueProducts.filter(p => p.Categoria_Interna_Principal === categoryName);
    renderGridToContainer(products, catGrid, false);

    // Scroll
    window.scrollTo({ top: 0, behavior: 'instant' });
}

window.closeCategoryPage = function () {
    document.getElementById('category-page-view').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'instant' });
}



function renderGridToContainer(products, container, isHorizontal = false, showBadge = false) {
    const fragment = document.createDocumentFragment();

    products.forEach((p, idx) => {
        let imgUrl = p.URL_Imagen && p.URL_Imagen !== "false" ? p.URL_Imagen : 'https://via.placeholder.com/300?text=Listex';
        const price = parseFloat(p.Precio).toFixed(2);
        const viewsCount = getPseudoViews(p.Handle);
        const badge = (showBadge && idx < 3) ? '<span class="product-badge">🔥 Más Vendido</span>' : '';

        const card = document.createElement('article');
        card.className = 'product-card vertical-card hidden-initial';

        card.innerHTML = `
            <div class="product-image-container" style="cursor:pointer" onclick="openProductDetail('${p.Handle}')">
                ${badge}
                <img src="${imgUrl}" alt="${p.Nombre_Producto}" class="product-image" loading="lazy" onerror="this.src='https://via.placeholder.com/300?text=Listex'">
            </div>
            <div class="product-info">
                <h3 class="product-name" style="cursor:pointer" onclick="openProductDetail('${p.Handle}')">${p.Nombre_Producto}</h3>
                <div class="product-views" data-view-handle="${p.Handle}">${viewsCount > 0 ? viewsCount + '+ Vistos' : ''}</div>
                <div class="product-price">$${price}</div>
                <button class="product-add-btn" onclick="openProductDetail('${p.Handle}')" aria-label="Ver y agregar">
                    <ion-icon name="cart-outline"></ion-icon> Agregar
                </button>
            </div>
        `;
        fragment.appendChild(card);
        
        // Rapid fade-in effect
        setTimeout(() => card.classList.add('fade-in'), 50 + (idx * 10));
    });

    container.appendChild(fragment);
}

function renderGrid(products, container) {
    container.innerHTML = '';
    if (products.length === 0) {
        container.innerHTML = '<p class="text-muted">No se encontraron productos.</p>';
        return;
    }
    renderGridToContainer(products, container);
}

function handleSearch(query) {
    query = query.toLowerCase().trim();

    // Elements to toggle
    const heroSection = document.querySelector('.hero-section');
    const categoriesSection = document.querySelector('.category-section');
    const ofertasSection = document.getElementById('ofertas-section');
    const masVistosSection = document.getElementById('mas-vistos-section');
    const catalogoSection = document.getElementById('catalogo-section');
    const searchResults = DOM.searchResultsSection;

    // Close category page if open during search
    if (!document.getElementById('category-page-view').classList.contains('hidden')) {
        closeCategoryPage();
    }

    if (query === '') {
        searchResults.classList.add('hidden');
        if (heroSection) heroSection.style.display = 'block';
        if (categoriesSection) categoriesSection.style.display = 'block';
        if (ofertasSection) ofertasSection.style.display = 'block';
        if (masVistosSection) masVistosSection.style.display = 'block';
        if (catalogoSection) catalogoSection.style.display = 'block';
        return;
    }

    const results = uniqueProducts.filter(p =>
        p.Nombre_Producto.toLowerCase().includes(query) ||
        (p.Categoria_Interna_Principal && p.Categoria_Interna_Principal.toLowerCase().includes(query))
    );

    if (heroSection) heroSection.style.display = 'none';
    if (categoriesSection) categoriesSection.style.display = 'none';
    if (ofertasSection) ofertasSection.style.display = 'none';
    if (masVistosSection) masVistosSection.style.display = 'none';
    if (catalogoSection) catalogoSection.style.display = 'none';

    searchResults.classList.remove('hidden');
    renderGrid(results, DOM.searchResultsGrid);
}

/* ==========================================================================
   Cart Logic
   ========================================================================== */
// Generates a unique key based on the Handle and all selected attributes
function getVariantCartKey(product) {
    const attrNames = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];
    const attrValues = ['Atributo_1_Valor', 'Atributo_2_Valor', 'Atributo_3_Valor', 'Atributo_4_Valor'];
    let keyStr = String(product.Handle);
    for (let i = 0; i < 4; i++) {
        if (product[attrNames[i]]) {
            keyStr += '|' + product[attrNames[i]] + ':' + product[attrValues[i]];
        }
    }
    return keyStr;
}

window.addToCartVariant = async function (product) {
    if (!product) return;

    const cartKey = getVariantCartKey(product);
    const existingItem = cart.find(item => item.cartKey === cartKey);

    // ==========================================
    // FASE 1: Integración Odoo XML-RPC vía Backend (Background)
    // ==========================================
    (async () => {
        try {
            let orderId = localStorage.getItem('listex_odoo_order_id');
            const internalId = parseInt(product.id_producto);

            // Si el producto no tiene un ID de Odoo válido (>0), no podemos sincronizarlo
            if (!internalId || isNaN(internalId)) {
                console.warn("Producto sin ID de Odoo válido, saltando sincronización background:", product.Handle);
                return;
            }

            if (!orderId) {
                const createRes = await fetch('/api/cart/create', { method: 'POST' });
                const createData = await createRes.json();
                if (createData.success && createData.order_id) {
                    orderId = createData.order_id;
                    localStorage.setItem('listex_odoo_order_id', orderId);
                }
            }

            if (orderId) {
                const addRes = await fetch('/api/cart/add-line', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order_id: orderId, product_id: internalId, quantity: 1 })
                });
                const addData = await addRes.json();

                // Si la orden ya no es válida en Odoo, limpiamos local y reintentamos una vez
                if (!addData.success && (addData.error?.includes('Record does not exist') || addData.error?.includes('incorrect value'))) {
                    console.log("Orden previa en Odoo no válida, reintentando con nueva orden...");
                    localStorage.removeItem('listex_odoo_order_id');
                    // Recursión limitada (un solo reintento)
                    addToCartVariant(product);
                }
            }
        } catch (error) {
            console.warn("Sincronización Odoo falló en background.", error);
        }
    })();
    // ==========================================

    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ product, quantity: 1, cartKey });
    }

    saveCartAndRender();
    showToast('Producto agregado al carrito');

    // Animar icono del carrito
    DOM.cartBadge.style.transform = 'scale(1.5)';
    setTimeout(() => DOM.cartBadge.style.transform = 'scale(1)', 300);

    // Animar botón de carrito inferior
    const bottomCartBtn = document.getElementById('bottom-cart-btn');
    if (bottomCartBtn) {
        bottomCartBtn.classList.add('cart-bounce-anim', 'active', 'cart-notif');
        // Add visual indicator if not already there
        if (!bottomCartBtn.querySelector('.badge-dot')) {
            const dot = document.createElement('div');
            dot.className = 'badge-dot';
            bottomCartBtn.appendChild(dot);
        }
        setTimeout(() => bottomCartBtn.classList.remove('cart-bounce-anim'), 500);
    }
};

function updateQuantity(cartKey, delta) {
    const item = cart.find(i => i.cartKey === cartKey);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        removeFromCart(cartKey);
        return;
    }
    saveCartAndRender();
}

window.updateQuantity = updateQuantity;

function removeFromCart(cartKey) {
    cart = cart.filter(i => i.cartKey !== cartKey);
    saveCartAndRender();
}
window.removeFromCart = removeFromCart;

function saveCartAndRender() {
    localStorage.setItem('listex_cart', JSON.stringify(cart));
    renderCart();
}

function loadCartFromStorage() {
    const saved = localStorage.getItem('listex_cart');
    if (saved) {
        cart = JSON.parse(saved);
        renderCart();
    }
}

// Returns the applicable price for a cart item, taking into account docena/TIPO3 pricing
function getEffectivePrice(item) {
    const p = item.product;
    let price = parseFloat(p.Precio);

    // Look for "Presentación" attribute in the variant
    const attrNames = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];
    const attrValues = ['Atributo_1_Valor', 'Atributo_2_Valor', 'Atributo_3_Valor', 'Atributo_4_Valor'];

    for (let i = 0; i < 4; i++) {
        const attrName = p[attrNames[i]];
        const attrVal = p[attrValues[i]];
        if (attrName && attrVal &&
            (attrName.toLowerCase().includes('presentaci') || attrName.toLowerCase().includes('presentacion')) &&
            attrVal.toLowerCase().includes('docena')) {
            // Apply TIPO3 price for docena variants
            if (p._raw_tarifas) {
                const tipo3 = p._raw_tarifas.find(t => t.nombre_tarifa === 'TIPO3');
                if (tipo3 && tipo3.precio_fijo) {
                    price = parseFloat(tipo3.precio_fijo);
                }
            }
            break;
        }
    }

    return price;
}

function renderCart() {
    // Calcular total cantidad
    const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
    DOM.cartBadge.textContent = totalQty;
    DOM.cartBadge.style.display = totalQty > 0 ? 'flex' : 'none';

    // También actualizar el badge de la barra inferior si existe
    const bottomBadge = document.getElementById('cart-badge-bottom');
    if (bottomBadge) {
        bottomBadge.textContent = totalQty;
        bottomBadge.style.display = totalQty > 0 ? 'flex' : 'none';
    }

    // Render items
    DOM.cartItemsContainer.innerHTML = '';
    let totalPrice = 0;

    if (cart.length === 0) {
        DOM.cartItemsContainer.innerHTML = '<div class="empty-cart-msg">Tu carrito está vacío.</div>';
        DOM.checkoutBtn.classList.add('disabled');
        DOM.cartTotal.textContent = '€0.00 EUR';
        return;
    }

    DOM.checkoutBtn.classList.remove('disabled');

    cart.forEach(item => {
        const p = item.product;
        let imgUrl = p.URL_Imagen && p.URL_Imagen !== "false" ? p.URL_Imagen : 'https://via.placeholder.com/80';

        const actualPrice = getEffectivePrice(item);

        const itemTotal = (actualPrice * item.quantity);
        totalPrice += itemTotal;

        // Formato visual para los atributos
        const attrNames = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];
        const attrValues = ['Atributo_1_Valor', 'Atributo_2_Valor', 'Atributo_3_Valor', 'Atributo_4_Valor'];
        let attributesHtml = '';
        for (let i = 0; i < 4; i++) {
            if (p[attrNames[i]]) {
                attributesHtml += `<span class="cart-item-attr">${p[attrNames[i]]}: <strong>${p[attrValues[i]]}</strong></span> `;
            }
        }

        const div = document.createElement('div');
        div.className = 'cart-item';
        div.innerHTML = `
               <img src="${imgUrl}" alt="${p.Nombre_Producto}" class="cart-item-img" onerror="this.src='https://via.placeholder.com/80'">
               <div class="cart-item-details">
                   <div class="cart-item-title">${p.Nombre_Producto}</div>
                   <div class="cart-item-attributes" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">${attributesHtml}</div>
                   <div class="cart-item-price">€${parseFloat(actualPrice).toFixed(2)} EUR c/u</div>
                   <div class="cart-item-actions">
                       <div class="quantity-control">
                           <button class="qty-btn" onclick="updateQuantity('${item.cartKey}', -1)"><ion-icon name="remove-outline"></ion-icon></button>
                           <span>${item.quantity}</span>
                           <button class="qty-btn" onclick="updateQuantity('${item.cartKey}', 1)"><ion-icon name="add-outline"></ion-icon></button>
                       </div>
                       <button class="remove-item-btn" onclick="removeFromCart('${item.cartKey}')"><ion-icon name="trash-outline"></ion-icon></button>
                   </div>
               </div>
           `;

        DOM.cartItemsContainer.appendChild(div);
    });

    DOM.cartTotal.textContent = `€${totalPrice.toFixed(2)} EUR`;
}

/* ==========================================================================
   UI Interactions & Listeners
   ========================================================================== */
function setupEventListeners() {
    // Definir funciones de apertura y cierre directamente para asegurar que existan
    const openCart = function (e) {
        if (e) e.preventDefault();
        const sidebar = document.getElementById('cart-sidebar');
        const overlay = document.getElementById('overlay');
        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('active');
    };

    const closeCart = function (e) {
        if (e) e.preventDefault();
        const sidebar = document.getElementById('cart-sidebar');
        const overlay = document.getElementById('overlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
    };

    const openCheckoutModal = function (e) {
        if (e) e.preventDefault();
        const modal = document.getElementById('checkout-modal');
        const overlay = document.getElementById('overlay');
        if (modal) modal.classList.add('active');
        if (overlay) overlay.classList.add('active');
    };

    window.openCart = openCart;
    window.closeCart = closeCart;
    window.openCheckoutModal = openCheckoutModal;

    window.closeAllModals = function (e) {
        if (e) e.preventDefault();
        closeCart();
        closeProductDetail();
        const modal = document.getElementById('checkout-modal');
        const overlay = document.getElementById('overlay');
        if (modal) modal.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    };

    window.closeProductDetail = function (e) {
        if (e) e.preventDefault();
        const modal = document.getElementById('product-detail-modal');
        if (modal) modal.classList.remove('active');
    };

    // Vincular eventos robustamente
    const btnOpenCart = document.getElementById('open-cart-btn');
    if (btnOpenCart) btnOpenCart.onclick = openCart;

    const btnCloseCart = document.getElementById('close-cart-btn');
    if (btnCloseCart) btnCloseCart.onclick = closeCart;

    const overlayEl = document.getElementById('overlay');
    if (overlayEl) overlayEl.onclick = closeAllModals;

    const btnCheckout = document.getElementById('checkout-btn');
    if (btnCheckout) {
        btnCheckout.onclick = (e) => {
            if (cart.length > 0) {
                closeCart(e);
                openCheckoutModal(e);
            }
        };
    }

    const btnCloseModal = document.getElementById('close-modal-btn');
    if (btnCloseModal) btnCloseModal.onclick = closeAllModals;

    const btnCloseDetail = document.getElementById('close-detail-btn');
    if (btnCloseDetail) btnCloseDetail.onclick = closeProductDetail;

    const btnBackDetail = document.getElementById('back-detail-btn');
    if (btnBackDetail) btnBackDetail.onclick = closeProductDetail;

    const btnShareDetail = document.getElementById('detail-share-btn');
    if (btnShareDetail) btnShareDetail.onclick = shareProduct;

    const detailModal = document.getElementById('product-detail-modal');
    if (detailModal) {
        detailModal.onclick = (e) => {
            if (e.target === detailModal) closeProductDetail(e);
        };
        // Swipe to close functionality
        initSwipeToClose(detailModal);
    }

    // Shipping Method change (Dynamic Fields Preview)
    if (DOM.shippingMethod) {
        DOM.shippingMethod.onchange = function () {
            DOM.dynamicShippingFields.innerHTML = '';
            const method = this.value;

            if (method === 'MRW' || method === 'ZOOM') {
                DOM.dynamicShippingFields.classList.remove('hidden');
                DOM.dynamicShippingFields.innerHTML = `
                    <div class="form-row">
                        <div class="form-group">
                            <label for="ship-estado">Estado *</label>
                            <input type="text" id="ship-estado" required placeholder="Ej: Carabobo">
                        </div>
                        <div class="form-group">
                            <label for="ship-ciudad">Ciudad *</label>
                            <input type="text" id="ship-ciudad" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="ship-agencia">Agencia Destino *</label>
                        <input type="text" id="ship-agencia" required placeholder="Ej: Agencia 123">
                    </div>
                `;
            } else if (method === 'TRANSPORTADORAS_PRIVADAS') {
                DOM.dynamicShippingFields.classList.remove('hidden');
                DOM.dynamicShippingFields.innerHTML = `
                    <div class="form-group">
                        <label for="ship-trans-name">Nombre de Transportadora *</label>
                        <input type="text" id="ship-trans-name" required>
                    </div>
                `;
            } else if (method === 'DELIVERY') {
                DOM.dynamicShippingFields.classList.remove('hidden');
                DOM.dynamicShippingFields.innerHTML = `
                    <div class="form-group">
                        <label for="ship-delivery-address">Dirección Exacta de Delivery *</label>
                        <input type="text" id="ship-delivery-address" required>
                    </div>
                `;
            } else if (method === 'RETIRO_TIENDA') {
                DOM.dynamicShippingFields.classList.remove('hidden');
                DOM.dynamicShippingFields.innerHTML = `
                    <div class="shipping-info-alert">
                        <ion-icon name="location-outline"></ion-icon>
                        <strong>Dirección de Fábrica:</strong><br>
                        Sector 13 de septiembre, calle martin tovar, Paralelo a Av las ferias, llegando a plaza de toros, Santa rosa, Valencia. Edo Carabobo.
                    </div>
                `;
            } else {
                DOM.dynamicShippingFields.classList.add('hidden');
            }
        };
    }

    // Search Listeners
    let searchTimeout;
    const handleSearchInput = (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => handleSearch(e.target.value), 300);
    };
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', handleSearchInput);

    const mobileSearchInput = document.getElementById('mobile-search-input');
    if (mobileSearchInput) mobileSearchInput.addEventListener('input', handleSearchInput);

    // Search Listeners (continued) - handleShippingFields removido (redundancia)

    // Form Submit
    const checkoutForm = document.getElementById('checkout-form');
    if (checkoutForm) checkoutForm.addEventListener('submit', handleCheckoutSubmit);
}

function closeProductDetail() {
    document.getElementById('product-detail-modal').classList.remove('active');
    // Clear hash when closing modal
    if (window.location.hash.includes('producto/')) {
        history.replaceState(null, null, window.location.pathname);
    }
}

/* ==========================================================================
   Product Detail Logic
   ========================================================================== */
let currentDetailHandle = null;
let currentDetailVariants = [];
let selectedAttributes = {}; // { "Color": "Rojo", "Talla": "M" }
let currentMatchingVariant = null;

function getAttrValue(variant, attrName) {
    const attrNames = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];
    const attrValues = ['Atributo_1_Valor', 'Atributo_2_Valor', 'Atributo_3_Valor', 'Atributo_4_Valor'];
    for (let i = 0; i < 4; i++) {
        if (variant[attrNames[i]] === attrName) {
            return variant[attrValues[i]];
        }
    }
    return "";
}

window.openProductDetail = function (handle) {
    currentDetailHandle = handle;
    incrementViews(handle); // Registrar visita real
    if (window.firebaseLogViewItem) window.firebaseLogViewItem(handle);
    currentDetailVariants = allProducts.filter(p => String(p.Handle) === String(handle));

    if (currentDetailVariants.length === 0) return;

    // Initialize selected attributes based on the first variant
    const firstVariant = currentDetailVariants.find(v => parseFloat(v.Cantidad_Disponible) > 0 || v.PermitirVentaSinStock === true) || currentDetailVariants[0];
    selectedAttributes = {};
    const attrNames = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];

    attrNames.forEach(n => {
        if (firstVariant[n]) {
            selectedAttributes[firstVariant[n]] = getAttrValue(firstVariant, firstVariant[n]);
        }
    });

    applyVariantRules();
    updateVariantUI();

    // Update URL hash
    window.location.hash = `producto/${handle}`;

    // Open modal
    document.getElementById('product-detail-modal').classList.add('active');
};

function shareProduct() {
    if (!currentMatchingVariant) return;

    const shareData = {
        title: currentMatchingVariant.Nombre_Producto,
        text: `¡Mira este producto en Listex: ${currentMatchingVariant.Nombre_Producto}!`,
        url: window.location.href
    };

    if (navigator.share) {
        navigator.share(shareData).catch(err => {
            console.error('Error sharing:', err);
        });
    } else {
        // Fallback: Copy to clipboard
        navigator.clipboard.writeText(window.location.href)
            .then(() => showToast("Enlace de producto copiado al portapapeles."))
            .catch(err => console.error('Could not copy text: ', err));
    }
}

function handleRouting() {
    const hash = window.location.hash;
    if (hash.startsWith('#producto/')) {
        const encodedHandle = hash.replace('#producto/', '');
        const handle = decodeURIComponent(encodedHandle);
        if (handle) {
            // Give a small delay to ensure catalog is loaded if it's the first load
            if (allProducts.length > 0) {
                window.openProductDetail(handle);
            } else {
                setTimeout(() => handleRouting(), 500);
            }
        }
    }
}

function applyVariantRules() {
    const presentacionKey = Object.keys(selectedAttributes).find(k => k.toLowerCase().includes('presentación') || k.toLowerCase().includes('presentacion'));
    const colorKey = Object.keys(selectedAttributes).find(k => k.toLowerCase().includes('color') || k.toLowerCase().includes('estampado'));
    const tallaKey = Object.keys(selectedAttributes).find(k => k.toLowerCase().includes('talla'));

    if (presentacionKey && selectedAttributes[presentacionKey]) {
        const presValue = selectedAttributes[presentacionKey].toLowerCase();

        if (presValue.includes('docena')) {
            // Rule: "si se selecciona docena cerrada, se debe ocultar todos los colores y talla y mostar solamente la opcion surtio o variado"
            if (colorKey) selectedAttributes[colorKey] = "Surtido";
            if (tallaKey) selectedAttributes[tallaKey] = "Surtido";
        } else if (presValue.includes('unidad')) {
            // Rule: "si se selecciona unidad variada se debe ocultar el valor surtido"
            if (colorKey && selectedAttributes[colorKey].toLowerCase().includes('surtido')) {
                // Find a non-surtido color to auto-select
                const allPossibleColors = [...new Set(currentDetailVariants.map(v => getAttrValue(v, colorKey)))];
                const validColors = allPossibleColors.filter(c => c && !c.toLowerCase().includes('surtido'));
                if (validColors.length > 0) selectedAttributes[colorKey] = validColors[0];
            }
        }
    }

    // Find matching variant
    currentMatchingVariant = currentDetailVariants.find(v => {
        for (const [attrName, expectedValue] of Object.entries(selectedAttributes)) {
            if (getAttrValue(v, attrName) !== expectedValue) return false;
        }
        return true;
    });

    if (!currentMatchingVariant) currentMatchingVariant = currentDetailVariants[0];
}

function updateVariantUI() {
    if (!currentMatchingVariant) return;

    document.getElementById('detail-category').textContent = currentMatchingVariant.Categoria_Interna_Principal || 'General';
    document.getElementById('detail-title').textContent = currentMatchingVariant.Nombre_Producto;
    document.getElementById('detail-description').textContent = currentMatchingVariant.Descripcion_Producto || 'Sin descripción disponible.';

    updateDetailPrice(currentMatchingVariant);
    updateDetailStock(currentMatchingVariant);

    // ----------------------------------------------------------------------
    // Filter Valid Variants based on rules
    // ----------------------------------------------------------------------
    const allAttrNames = new Set();
    const attrNamesMap = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];
    currentDetailVariants.forEach(v => {
        attrNamesMap.forEach(n => { if (v[n]) allAttrNames.add(v[n]); });
    });

    const presentacionKey = Array.from(allAttrNames).find(k => k.toLowerCase().includes('presentación') || k.toLowerCase().includes('presentacion'));
    const isDocenaSelected = presentacionKey && selectedAttributes[presentacionKey] && selectedAttributes[presentacionKey].toLowerCase().includes('docena');
    const isUnidadSelected = presentacionKey && selectedAttributes[presentacionKey] && selectedAttributes[presentacionKey].toLowerCase().includes('unidad');

    // Build the list of valid variants
    let validVariants = currentDetailVariants.filter(v => {
        let isValid = true;
        allAttrNames.forEach(attrName => {
            const val = getAttrValue(v, attrName);
            if (!val) return;

            if (isDocenaSelected && attrName !== presentacionKey) {
                if (!val.toLowerCase().includes('surtido') && !val.toLowerCase().includes('variado')) {
                    isValid = false;
                }
            }
            if (isUnidadSelected && (attrName.toLowerCase().includes('color') || attrName.toLowerCase().includes('estampado'))) {
                if (val.toLowerCase().includes('surtido') || val.toLowerCase().includes('variado')) {
                    isValid = false;
                }
            }
        });
        return isValid;
    });

    // ----------------------------------------------------------------------
    // Thumbnail Logic: Show exactly one valid variant image per visual attribute
    // ----------------------------------------------------------------------
    const seenVisualAttributes = new Set();
    const uniqueImagesData = []; // Store both url and the variant it belongs to

    // Helper to find the visual attribute value (Color/Estampado) for a given variant
    function getVisualAttrValue(variant) {
        for (let i = 1; i <= 4; i++) {
            const nameKey = `Atributo_${i}_Nombre`;
            if (variant[nameKey]) {
                const lower = variant[nameKey].toLowerCase();
                if (lower.includes('color') || lower.includes('estampado')) {
                    return getAttrValue(variant, variant[nameKey]);
                }
            }
        }
        return 'default'; // fallback if no visual attribute exists
    }

    validVariants.forEach(v => {
        const visualValue = getVisualAttrValue(v);
        const url = v.URL_Imagen && v.URL_Imagen !== "false" ? v.URL_Imagen : null;

        // We want exactly one thumbnail per visual attribute (Color/Estampado).
        // Ignore Talla redundancies by grouping on visualValue.
        if (url && !seenVisualAttributes.has(visualValue)) {
            seenVisualAttributes.add(visualValue);
            uniqueImagesData.push({ url, variant: v });
        }
    });

    const thumbContainer = document.getElementById('detail-thumbnails');
    thumbContainer.innerHTML = '';

    const hasVisualAttribute = Array.from(allAttrNames).some(k => {
        const lower = k.toLowerCase();
        return !lower.includes('talla') && !lower.includes('presentaci');
    });

    if (uniqueImagesData.length > 0) {
        // Ensure the main image matches the currently selected variant if it has one, otherwise default to first valid
        let mainImgUrl = currentMatchingVariant && currentMatchingVariant.URL_Imagen && currentMatchingVariant.URL_Imagen !== "false" ? currentMatchingVariant.URL_Imagen : uniqueImagesData[0].url;

        // If the current matching variant's image is NOT in the valid set (e.g. Docena hides colors), explicitly fall back to the first valid one
        const currentVisualVal = getVisualAttrValue(currentMatchingVariant);
        if (!seenVisualAttributes.has(currentVisualVal)) {
            mainImgUrl = uniqueImagesData[0].url;
        }

        document.getElementById('detail-image').src = mainImgUrl;

        if (uniqueImagesData.length > 1 && hasVisualAttribute) {
            thumbContainer.style.display = 'flex';
            uniqueImagesData.forEach((imgData, idx) => {
                const thumb = document.createElement('img');
                const isSelectedImg = imgData.url === mainImgUrl;
                thumb.className = 'detail-thumbnail' + (isSelectedImg ? ' active' : '');
                
                // Usar miniatura optimizada de 128px para los cuadritos
                thumb.src = getOdooThumbnailUrl(imgData.url, 128);
                thumb.loading = "lazy";
                thumb.decoding = "async";
                
                thumb.onerror = function () { this.src = 'https://via.placeholder.com/60?text=Img'; };

                thumb.onclick = () => {
                    // Update main image
                    document.getElementById('detail-image').src = imgData.url;
                    thumbContainer.querySelectorAll('.detail-thumbnail').forEach(t => t.classList.remove('active'));
                    thumb.classList.add('active');

                    // Auto-select attributes based on this image's variant
                    const attrNamesIter = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];
                    attrNamesIter.forEach(n => {
                        if (imgData.variant[n]) {
                            const attrName = imgData.variant[n];
                            if (!attrName.toLowerCase().includes('talla')) {
                                selectedAttributes[attrName] = getAttrValue(imgData.variant, attrName);
                            }
                        }
                    });

                    applyVariantRules();
                    updateVariantUI();
                };
                thumbContainer.appendChild(thumb);
            });
        } else {
            thumbContainer.style.display = 'none';
        }
    } else {
        document.getElementById('detail-image').src = 'https://via.placeholder.com/500?text=Listex';
        thumbContainer.style.display = 'none';
    }

    // ----------------------------------------------------------------------
    // Attributes UI
    // ----------------------------------------------------------------------
    const attrContainer = document.getElementById('detail-attributes');
    attrContainer.innerHTML = '';

    allAttrNames.forEach(attrName => {
        let possibleValues = new Set();
        validVariants.forEach(v => {
            const val = getAttrValue(v, attrName);
            if (val) possibleValues.add(val);
        });

        let valuesArray = Array.from(possibleValues);

        // Hide rules based on presentation
        if (isDocenaSelected && attrName !== presentacionKey) {
            valuesArray = valuesArray.filter(val => val.toLowerCase().includes('surtido') || val.toLowerCase().includes('variado'));
            if (valuesArray.length === 0) return; // Hide this attribute entirely if no surtido option
        }

        if (isUnidadSelected && (attrName.toLowerCase().includes('color') || attrName.toLowerCase().includes('estampado'))) {
            valuesArray = valuesArray.filter(val => !val.toLowerCase().includes('surtido') && !val.toLowerCase().includes('variado'));
        }

        if (valuesArray.length === 0) return;

        const group = document.createElement('div');
        group.className = 'attr-group';
        group.innerHTML = `<span class="attr-group-label">${attrName}</span>`;
        const pillsContainer = document.createElement('div');
        pillsContainer.className = 'attr-pills';

        valuesArray.forEach(val => {
            const pill = document.createElement('button');
            const isActive = selectedAttributes[attrName] === val;
            pill.className = 'attr-pill' + (isActive ? ' active' : '');
            pill.textContent = val;

            // Check stock logic roughly
            const variantsWithThisVal = currentDetailVariants.filter(v => getAttrValue(v, attrName) === val);
            const isInStock = variantsWithThisVal.some(v => parseFloat(v.Cantidad_Disponible) > 0 || v.PermitirVentaSinStock === true);
            if (!isInStock) pill.classList.add('out-of-stock');

            pill.onclick = () => {
                selectedAttributes[attrName] = val;
                applyVariantRules();
                updateVariantUI();
            };

            pillsContainer.appendChild(pill);
        });

        group.appendChild(pillsContainer);
        attrContainer.appendChild(group);
    });

    if (attrContainer.children.length === 0) {
        attrContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">Este producto no tiene variantes seleccionables bajo esta configuración.</p>';
    }

    // Connect Add to Cart
    document.getElementById('detail-add-btn').onclick = () => {
        if (currentMatchingVariant) window.addToCartVariant(currentMatchingVariant);
    };
}

function updateDetailPrice(product) {
    let price = parseFloat(product.Precio);

    // Check if Docena is selected to apply TIPO3 price
    const presentacionKey = Object.keys(selectedAttributes).find(k => k.toLowerCase().includes('presentación') || k.toLowerCase().includes('presentacion'));
    if (presentacionKey && selectedAttributes[presentacionKey] && selectedAttributes[presentacionKey].toLowerCase().includes('docena')) {
        if (product._raw_tarifas) {
            const tipo3 = product._raw_tarifas.find(t => t.nombre_tarifa === 'TIPO3');
            if (tipo3 && tipo3.precio_fijo) {
                price = parseFloat(tipo3.precio_fijo);
            }
        }
    }

    document.getElementById('detail-price').textContent = `€${price.toFixed(2)} EUR`;
}

function updateDetailStock(product) {
    const stockEl = document.getElementById('detail-stock');
    const addBtn = document.getElementById('detail-add-btn');

    // According to Odoo, "in stock" means we can sell it either because it has >0 qty OR it has "continue selling when out of stock" enabled
    const canSell = parseFloat(product.Cantidad_Disponible) > 0 || product.PermitirVentaSinStock === true;
    const qty = parseFloat(product.Cantidad_Disponible);

    if (canSell) {
        if (qty > 0) {
            stockEl.textContent = `✅ En stock (${qty} disponibles)`;
        } else {
            stockEl.textContent = `✅ En stock (Bajo pedido)`;
        }
        stockEl.className = 'detail-stock in-stock';
        if (addBtn) addBtn.classList.remove('disabled');
    } else {
        stockEl.textContent = '⚠️ Agotado temporalmente';
        stockEl.className = 'detail-stock out-of-stock';
        if (addBtn) addBtn.classList.add('disabled');
    }
}

let toastTimeout;
function showToast(msg) {
    DOM.toast.textContent = msg;
    DOM.toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        DOM.toast.classList.remove('visible');
    }, 3000);
}

// Removiendo duplicado (movido a setupEventListeners)

async function handleCheckoutSubmit(e) {
    e.preventDefault();
    if (cart && cart.length > 0) {
        let totalValue = 0;
        cart.forEach(item => {
            if (typeof getEffectivePrice === 'function') {
                totalValue += getEffectivePrice(item) * item.quantity;
            }
        });
        if (window.firebaseLogCheckout) window.firebaseLogCheckout(totalValue);
    }

    if (cart.length === 0) {
        showToast("Tu carrito está vacío.");
        return;
    }

    // Gather Data
    const customer = {
        fname: document.getElementById('fname').value,
        lname: document.getElementById('lname').value,
        cedula: document.getElementById('cedula').value,
        phone: document.getElementById('phone').value,
        email: document.getElementById('email') ? document.getElementById('email').value : '',
        shippingMethod: DOM.shippingMethod.value
    };

    let shippingDetails = '';
    if (customer.shippingMethod === 'MRW' || customer.shippingMethod === 'ZOOM') {
        const estado = document.getElementById('ship-estado') ? document.getElementById('ship-estado').value : '';
        const ciudad = document.getElementById('ship-ciudad') ? document.getElementById('ship-ciudad').value : '';
        const agencia = document.getElementById('ship-agencia') ? document.getElementById('ship-agencia').value : '';
        shippingDetails = `Envío vía ${customer.shippingMethod}:\nEstado: ${estado}\nCiudad: ${ciudad}\nAgencia: ${agencia}`;
    } else if (customer.shippingMethod === 'TRANSPORTADORAS_PRIVADAS') {
        const transName = document.getElementById('ship-trans-name') ? document.getElementById('ship-trans-name').value : '';
        shippingDetails = `Transportadora Privada: ${transName}`;
    } else if (customer.shippingMethod === 'DELIVERY') {
        const address = document.getElementById('ship-delivery-address') ? document.getElementById('ship-delivery-address').value : '';
        shippingDetails = `Delivery (Gran Valencia): ${address}`;
    } else if (customer.shippingMethod === 'RETIRO_TIENDA') {
        shippingDetails = 'Retiro en Fábrica (Sector 13 de septiembre, calle martin tovar, Paralelo a Av las ferias, llegando a plaza de toros, Santa rosa, Valencia. Edo Carabobo)';
    }

    // FASE 2: Confirmar en Odoo vía Backend
    const checkoutBtn = document.getElementById('checkout-btn') || document.querySelector('button[type="submit"]');
    if (checkoutBtn) {
        checkoutBtn.textContent = 'Procesando...';
        checkoutBtn.classList.add('disabled');
    }

    let orderId = localStorage.getItem('listex_odoo_order_id');
    try {

        // Build cart items for re-sync (ensures all items exist and have correct price)
        const cartItems = cart.map(item => ({
            product_id: parseInt(item.product.id_producto),
            product_name: item.product.Nombre_Producto,
            quantity: item.quantity,
            price: getEffectivePrice(item)
        })).filter(item => !isNaN(item.product_id) && item.product_id > 0);

        if (cartItems.length === 0) {
            throw new Error("No hay productos válidos para sincronizar con Odoo.");
        }

        // Si no hay orderId previo, intentamos crear uno al vuelo
        if (!orderId) {
            const createRes = await fetch('/api/cart/create', { method: 'POST' });
            const createData = await createRes.json();
            if (createData.success && createData.order_id) {
                orderId = createData.order_id;
            } else {
                throw new Error("No se pudo crear el pedido en Odoo para sincronizar.");
            }
        }

        const checkoutRes = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_id: orderId,
                cart_items: cartItems,
                customer_data: {
                    fname: customer.fname,
                    lname: customer.lname,
                    cedula: customer.cedula,
                    email: customer.email,
                    phone: customer.phone,
                    shipping_method: customer.shippingMethod,
                    agency: shippingDetails
                }
            })
        });

        const checkoutData = await checkoutRes.json();

        if (!checkoutData.success) {
            throw new Error(checkoutData.error || "Fallo el procesamiento en el servidor Odoo.");
        }

        // Éxito: Limpiar la sesión Odoo local
        localStorage.removeItem('listex_odoo_order_id');
        console.log("Odoo sync completed successfully. Order:", orderId);

    } catch (error) {
        console.error("Error enviando cotización a Odoo:", error);
        // Si hay error, avisamos al usuario pero permitimos que vea el mensaje de WhatsApp 
        // para que no se pierda la venta, aunque no esté en Odoo.
        showToast("Advertencia: No se pudo guardar el pedido en Odoo. Procediendo solo por WhatsApp.");
    }

    if (checkoutBtn) {
        checkoutBtn.textContent = 'Proceder al Pago';
        checkoutBtn.classList.remove('disabled');
    }

    // Format WhatsApp Message
    // Usamos el ID del pedido que acabamos de procesar
    const orderIdToPrint = orderId || localStorage.getItem('listex_odoo_order_id') || 'S/N';
    
    let msgLines = [];
    msgLines.push('¡Hola Listex! 🌟 Quisiera realizar un pedido al mayor.');
    msgLines.push('');
    msgLines.push('*DATOS DEL CLIENTE*');
    msgLines.push(`📋 Referencia de la orden: #${orderIdToPrint}`);
    msgLines.push(`👤 Nombre: ${customer.fname} ${customer.lname}`);
    msgLines.push(`🆔 Cédula: ${customer.cedula}`);
    msgLines.push(`📱 Teléfono: ${customer.phone}`);
    msgLines.push('');
    msgLines.push('*MÉTODO DE ENTREGA*');
    msgLines.push(shippingDetails);
    msgLines.push('');
    msgLines.push('*PEDIDO*');

    let total = 0;
    cart.forEach((item, index) => {
        let attrText = '';
        const attrNames = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];
        const attrValues = ['Atributo_1_Valor', 'Atributo_2_Valor', 'Atributo_3_Valor', 'Atributo_4_Valor'];
        for (let i = 0; i < 4; i++) {
            if (item.product[attrNames[i]]) {
                attrText += ` [${item.product[attrNames[i]]}: ${item.product[attrValues[i]]}]`;
            }
        }
        // Use the same effective price shown on screen (handles docena/TIPO3 pricing)
        const pPrice = getEffectivePrice(item);
        const subtotal = pPrice * item.quantity;
        total += subtotal;
        msgLines.push(`${index + 1}. ${item.product.Nombre_Producto}${attrText}`);
        msgLines.push(`   Cant: ${item.quantity} x $${pPrice.toFixed(2)} = $${subtotal.toFixed(2)} USD`);
    });

    msgLines.push('');
    msgLines.push(`*TOTAL ESTIMADO:* $${total.toFixed(2)} USD`);

    const plainMessage = msgLines.join('\n');
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(plainMessage)}`;
    window.open(url, '_blank');

    // Limpiar carrito local
    cart = [];
    saveCartAndRender();
    if (typeof closeAllModals === 'function') closeAllModals();
    showToast("Cotización enviada con éxito.");
}

/* ==========================================================================
   Auto-Scroll Logic (3 Seconds Interval)
   ========================================================================== */
function initAutoScroll() {
    // Scroll every 3 seconds
    setInterval(() => {
        const carousels = document.querySelectorAll('.marquee-wrapper');
        carousels.forEach(carousel => {
            // Calculate dynamic scroll amount based on its first child's width + gap
            const marqueeContent = carousel.querySelector('.marquee-content');
            if (!marqueeContent || marqueeContent.children.length === 0) return;

            const firstItem = marqueeContent.children[0];
            // Get item width + the gap defined in CSS (1.5rem = 24px)
            const itemWidth = firstItem.offsetWidth;
            const scrollAmount = itemWidth + 24;

            // Total scrollable width
            const maxScroll = carousel.scrollWidth - carousel.clientWidth;

            if (carousel.scrollLeft >= maxScroll - 10) {
                // If we reached the end, snap back to the start smoothly
                carousel.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                // Scroll right smoothly
                carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
            }
        });
    }, 3000);
}

/* ==========================================================================
   Gestures: Swipe to Close
   ========================================================================== */
function initSwipeToClose(element) {
    let touchstartX = 0;
    let touchendX = 0;
    let touchstartY = 0;
    let touchendY = 0;

    element.addEventListener('touchstart', e => {
        touchstartX = e.changedTouches[0].screenX;
        touchstartY = e.changedTouches[0].screenY;
    }, { passive: true });

    element.addEventListener('touchend', e => {
        touchendX = e.changedTouches[0].screenX;
        touchendY = e.changedTouches[0].screenY;
        handleGesture();
    }, { passive: true });

    function handleGesture() {
        const deltaX = touchendX - touchstartX;
        const deltaY = Math.abs(touchendY - touchstartY);

        // If swipe right (more than 100px) and vertical movement is small
        if (deltaX > 100 && deltaY < 80) {
            closeProductDetail();
        }
    }
}

// Iniciar app
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    initAutoScroll();
    window.addEventListener('hashchange', handleRouting);
});

