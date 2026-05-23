import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import { getFirestore, onSnapshot, collection, doc, setDoc, increment } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js';

const firebaseConfig = {
  apiKey: "AIzaSyA8EmR7AKLUhaZ3_Wh4zpqjmcEQBRQxGL0",
  authDomain: "listex-web.firebaseapp.com",
  projectId: "listex-web",
  storageBucket: "listex-web.firebasestorage.app",
  messagingSenderId: "55599345584",
  appId: "1:55599345584:web:2630f7103548bc5a6fb075",
  measurementId: "G-PTRG18T97D"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let analytics = null;
try {
    analytics = getAnalytics(app);
} catch(e) {
    console.warn("Analytics blocked or failed to initialize", e);
}

window.globalViews = {};

onSnapshot(collection(db, 'products'), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
        const handle = change.doc.id;
        const data = change.doc.data();
        const views = data.views || 0;
        
        window.globalViews[handle] = views;
        
        const elements = document.querySelectorAll(`[data-view-handle="${handle}"]`);
        elements.forEach(el => {
            el.innerHTML = views + "+ Vistos";
        });
    });
}, (error) => {
    console.error("Firestore onSnapshot error:", error);
});

window.firebaseIncrementViews = async function(handle) {
    if (!handle) return;
    try {
        const docRef = doc(db, 'products', handle);
        await setDoc(docRef, { views: increment(1) }, { merge: true });
    } catch (e) {
        console.error("Error incrementing views:", e);
    }
};

window.firebaseLogViewItem = function(handle) {
    if (!handle || !analytics) return;
    try {
        logEvent(analytics, 'view_item', { item_id: handle });
    } catch(e) {}
};

window.firebaseLogCheckout = function(totalValue) {
    if (!analytics) return;
    try {
        logEvent(analytics, 'generate_lead', { currency: 'USD', value: parseFloat(totalValue) });
    } catch(e) {}
};
