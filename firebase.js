// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA8EmR7AKLUhaZ3_Wh4zpqjmcEQBRQxGL0",
  authDomain: "listex-web.firebaseapp.com",
  projectId: "listex-web",
  storageBucket: "listex-web.firebasestorage.app",
  messagingSenderId: "55599345584",
  appId: "1:55599345584:web:2630f7103548bc5a6fb075",
  measurementId: "G-PTRG18T97D"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { app, analytics, db };
