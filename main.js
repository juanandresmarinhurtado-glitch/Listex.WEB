import * as THREE from 'three';
import { gsap } from 'gsap';
import { app, analytics, db } from './firebase.js';
import { logEvent } from "firebase/analytics";
import { doc, setDoc, updateDoc, increment, collection, onSnapshot } from "firebase/firestore";

// --- THREE.JS BACKGROUND SCENE ---
const canvas = document.querySelector('#bg-canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(30);

// Floating particles for technological feel
const particlesCount = 1500;
const positions = new Float32Array(particlesCount * 3);
for (let i = 0; i < particlesCount * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 100;
}
const particlesGeometry = new THREE.BufferGeometry();
particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particlesMaterial = new THREE.PointsMaterial({
    size: 0.1,
    color: 0x00b8b8,
    transparent: true,
    opacity: 0.8
});
const particles = new THREE.Points(particlesGeometry, particlesMaterial);
scene.add(particles);

// Dynamic Lighting
const pointLight = new THREE.PointLight(0xffffff, 1);
pointLight.position.set(5, 5, 5);
const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(pointLight, ambientLight);

// Mouse Interaction
let mouseX = 0;
let mouseY = 0;
window.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
});

function animate() {
    requestAnimationFrame(animate);
    
    particles.rotation.y += 0.001;
    particles.rotation.x += 0.0005;

    // Follow mouse smoothly
    const targetX = mouseX * 0.5;
    const targetY = -mouseY * 0.5;
    particles.position.x += (targetX - particles.position.x) * 0.05;
    particles.position.y += (targetY - particles.position.y) * 0.05;

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- GSAP ANIMATIONS ---
gsap.from('.hero-content > *', {
    duration: 1.5,
    y: 100,
    opacity: 0,
    stagger: 0.2,
    ease: 'power4.out'
});

gsap.from('.hero-image-container', {
    duration: 2,
    scale: 0.8,
    opacity: 0,
    ease: 'expo.out',
    delay: 0.5
});

// --- QUOTATION SYSTEM (MULTI-PRODUCT) ---
let quoteItems = [];

function updateQuoteUI() {
    const quoteListContainer = document.getElementById('quote-list-container');
    const itemsList = document.getElementById('quote-items-list');
    const unitPriceEl = document.getElementById('unit-price');
    const productsTotalEl = document.getElementById('products-total');
    const designCostEl = document.getElementById('design-cost');
    const grandTotalEl = document.getElementById('grand-total');

    if (quoteItems.length === 0) {
        quoteListContainer.style.display = 'none';
    } else {
        quoteListContainer.style.display = 'block';
    }

    // Render List
    itemsList.innerHTML = quoteItems.map(item => `
        <div class="quote-item-row">
            <div><strong>${item.name}</strong></div>
            <div>${item.quantity} un.</div>
            <div>${item.totalPrice}€</div>
            <button type="button" class="remove-item" onclick="removeItem(${item.id})">×</button>
        </div>
    `).join('');

    // Totals
    let itemsTotal = 0;
    let totalDesign = 0;

    quoteItems.forEach(item => {
        itemsTotal += item.totalPrice;
        totalDesign += item.designCost;
    });

    const grandTotal = itemsTotal + totalDesign;

    unitPriceEl.textContent = "Varios";
    productsTotalEl.textContent = `${itemsTotal}€`;
    designCostEl.textContent = `${totalDesign}€`;
    grandTotalEl.textContent = `${grandTotal}€`;

    // Animation
    gsap.from('.grand-total', { scale: 1.1, duration: 0.3 });
}

window.removeItem = (id) => {
    quoteItems = quoteItems.filter(item => item.id !== id);
    updateQuoteUI();
};

const addBtn = document.getElementById('add-to-quote-btn');
if (addBtn) {
    addBtn.addEventListener('click', () => {
        const productKey = document.getElementById('product-type').value;
        const quantity = parseInt(document.getElementById('quantity').value);
        const designer = document.getElementById('designer').value;

        if (!productKey || !quantity || quantity < 1) {
            alert("Por favor selecciona un producto y cantidad.");
            return;
        }

        let unitPrice = 0;
        switch(productKey) {
            case 'jersey': unitPrice = 10; break;
            case 'longsleeve': unitPrice = 12; break;
            case 'windbreaker': unitPrice = 30; break;
            case 'football': unitPrice = quantity >= 12 ? 20 : 25; break;
        }

        const designCosts = { junior: 10, senior: 30 };
        const designCost = designCosts[designer] || 0;

        const productNames = {
            jersey: "Franela Manga Corta",
            longsleeve: "Jersey Manga Larga",
            windbreaker: "Chaqueta Cortaviento",
            football: "Uniforme Fútbol (Kit)"
        };

        const newItem = {
            id: Date.now(),
            name: productNames[productKey],
            quantity: quantity,
            unitPrice: unitPrice,
            totalPrice: unitPrice * quantity,
            designCost: designCost
        };

        quoteItems.push(newItem);
        updateQuoteUI();

        // Reset inputs
        document.getElementById('product-type').value = "";
        document.getElementById('quantity').value = "";
    });
}

const quoteForm = document.getElementById('quote-form');
if (quoteForm) {
    quoteForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (quoteItems.length === 0) {
            alert("Añade al menos un producto a la cotización.");
            return;
        }

        const name = document.getElementById('name').value;
        const idNum = document.getElementById('id-num').value;

        let productDetails = quoteItems.map(item => 
            `• ${item.name}: ${item.quantity} x ${item.unitPrice}€ = ${item.totalPrice}€ (Diseño ${item.designCost}€)`
        ).join('%0A');

        let totalSuma = quoteItems.reduce((acc, item) => acc + item.totalPrice + item.designCost, 0);

        const message = `*SOLICITUD DE COTIZACIÓN - LISTEX 3D*%0A%0A` +
            `*Cliente:* ${name}%0A` +
            `*ID/RIF:* ${idNum}%0A%0A` +
            `*Pedido:*%0A${productDetails}%0A%0A` +
            `*TOTAL ESTIMADO:* ${totalSuma}€%0A%0A` +
            `_Generado automáticamente desde la plataforma Listex_`;

        // Analytics Event
        logEvent(analytics, 'generate_lead', { value: totalSuma, currency: 'EUR' });

        window.open(`https://wa.me/584244400996?text=${message}`, '_blank');
    });
}

// --- START OVERLAY LOGIC ---
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const appElement = document.getElementById('app');
const music = document.getElementById('bg-music');
const musicIcon = document.getElementById('music-icon');

let isPlaying = false;

startBtn.addEventListener('click', () => {
    // Hide overlay
    startOverlay.style.opacity = '0';
    setTimeout(() => {
        startOverlay.style.display = 'none';
        appElement.style.opacity = '1';
        appElement.style.transition = 'opacity 1s ease';
    }, 1000);

    // Play music
    music.play().then(() => {
        isPlaying = true;
        musicIcon.textContent = '🔊';
    });

    // Animate hero entry again for effect
    gsap.from('.hero-content > *', {
        duration: 2,
        x: -50,
        opacity: 0,
        stagger: 0.3,
        ease: 'power4.out'
    });
});

// --- MUSIC TOGGLE LOGIC ---
const musicToggle = document.getElementById('music-toggle');

musicToggle.addEventListener('click', () => {
    if (isPlaying) {
        music.pause();
        musicIcon.textContent = '🔇';
    } else {
        music.play();
        musicIcon.textContent = '🔊';
    }
    isPlaying = !isPlaying;
});

// --- PRODUCT DETAILS INTERACTIVE SHOWCASE ---
const detailSection = document.getElementById('product-detail');
const detailTitle = document.getElementById('detail-title');
const detailPrice = document.getElementById('detail-price-msg');
const detailVideo = document.getElementById('detail-video');

const productData = {
    jersey: {
        title: "CARACTERÍSTICAS DE LA FRANELA DRY FIT PREMIUM - LISTEX",
        price: "Desde 10€",
        video: "/video-2-hd.mp4"
    },
    longsleeve: {
        title: "CARACTERÍSTICAS DEL JERSEY MANGA LARGA HD - LISTEX",
        price: "Desde 12€",
        video: "/sueter-manga-larga.mov"
    },
    windbreaker: {
        title: "CARACTERÍSTICAS DE LA CHAQUETA NOVA REPEL PRO - LISTEX",
        price: "Desde 30€",
        video: "/chaquetas-detail.mov"
    },
    football: {
        title: "CARACTERÍSTICAS DE UNIFORMES DE FÚTBOL PREMIUM - LISTEX",
        price: "Desde 20€",
        video: "/uniformes-futbol.mov"
    }
};

async function initProductGrid() {
    const grid = document.getElementById('dynamic-product-grid');
    if (!grid) return;
    
    // Default fallback data
    let baseProducts = [
        { id: 'jersey', img: '/jersey.png', name: 'Franela Manga Corta', desc: 'Tela Dry Fit especial para sublimación. Máxima absorción y profundidad de color.', price: 'Desde 10€', views: 0 },
        { id: 'longsleeve', img: '/longsleeve.png', name: 'Jersey Manga Larga', desc: 'Suéter deportivo en tela Dry Fit. Confección industrial para alto rendimiento.', price: 'Desde 12€', views: 0 },
        { id: 'windbreaker', img: '/windbreaker.png', name: 'Chaqueta Cortatiento', desc: 'Tela Nova Repel sublimada a gran formato. Protección y estilo personalizado.', price: 'Desde 30€', views: 0 },
        { id: 'football', img: '/football.png', name: 'Uniformes de Fútbol', desc: 'Kits completos (camisa, short y medias) con tecnología Dry Fit de alta durabilidad.', price: 'Desde 20€', views: 0 }
    ];

    // Escuchar cambios en tiempo real
    onSnapshot(collection(db, "products"), (snapshot) => {
        const viewData = {};
        snapshot.forEach((doc) => {
            viewData[doc.id] = doc.data().views || 0;
        });
        
        // Clonar array para no mutar el original en cada actualización
        let products = JSON.parse(JSON.stringify(baseProducts));
        
        products.forEach(p => {
            if (viewData[p.id] !== undefined) {
                p.views = viewData[p.id];
            }
        });
        
        // Sort descending (most viewed first)
        products.sort((a, b) => b.views - a.views);

        // Renderizar de nuevo
        grid.innerHTML = products.map(p => `
            <div class="product-card glass" data-product="${p.id}">
                <div class="product-img">
                    <img src="${p.img}" alt="${p.name}">
                </div>
                <h3>${p.name}</h3>
                <p class="product-desc">${p.desc}</p>
                <p class="price-tag">${p.price}</p>
                <button class="view-more-btn">Ver Más</button>
            </div>
        `).join('');

        // Volver a adjuntar los eventos a las nuevas tarjetas
        attachProductCardListeners();
    }, (error) => {
        console.error("Firebase real-time error:", error);
    });
}

function attachProductCardListeners() {
    const productCards = document.querySelectorAll('.product-card');
    productCards.forEach(card => {
        card.addEventListener('click', async () => {
            const type = card.dataset.product;
            const data = productData[type];

            // Firebase tracking
            try {
                logEvent(analytics, 'view_item', { item_id: type });
                const docRef = doc(db, 'products', type);
                await updateDoc(docRef, {
                    views: increment(1)
                }).catch(async (e) => {
                    if (e.code === 'not-found') {
                        await setDoc(docRef, { views: 1 });
                    }
                });
            } catch(e) { console.error(e); }

            if (data) {
                detailTitle.textContent = data.title;
                detailPrice.textContent = data.price;
                
                detailVideo.pause();
                const newSource = `
                    <source src="${data.video}" type="video/mp4">
                    <source src="${data.video}" type="video/quicktime">
                `;
                detailVideo.innerHTML = newSource;
                detailVideo.load();
                detailVideo.play().catch(e => console.log("Detail video autoplay blocked or failed:", e));
                
                detailSection.style.display = 'block';
                
                gsap.fromTo(detailSection, 
                    { opacity: 0, y: 50 }, 
                    { opacity: 1, y: 0, duration: 1, ease: "power4.out" }
                );

                gsap.from(".feature-item", {
                    opacity: 0,
                    x: -30,
                    stagger: 0.15,
                    duration: 0.8,
                    ease: "power2.out",
                    overwrite: true
                });

                gsap.from("#detail-title", {
                    opacity: 0,
                    scale: 0.95,
                    duration: 1,
                    delay: 0.2,
                    ease: "elastic.out(1, 0.5)"
                });

                detailSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });
}

// Initialize dynamic grid
initProductGrid();
