require('dotenv').config();
const xmlrpc = require('xmlrpc');

const url = new URL(process.env.ODOO_URL);
const host = url.hostname;
const port = url.port || (url.protocol === 'https:' ? 443 : 80);
const isSecure = url.protocol === 'https:';

const commonClient = (isSecure ? xmlrpc.createSecureClient : xmlrpc.createClient)({ host, port, path: '/xmlrpc/2/common' });
const modelsClient = (isSecure ? xmlrpc.createSecureClient : xmlrpc.createClient)({ host, port, path: '/xmlrpc/2/object' });

let uid = null;

async function authenticate() {
    return new Promise((resolve, reject) => {
        commonClient.methodCall('authenticate', [process.env.ODOO_DB, process.env.ODOO_USERNAME, process.env.ODOO_API_KEY, {}], (error, result) => {
            if (error || !result) return reject(error || "Auth failed");
            uid = result;
            resolve(uid);
        });
    });
}

async function executeKw(model, method, args, kwargs = {}) {
    return new Promise((resolve, reject) => {
        modelsClient.methodCall('execute_kw', [process.env.ODOO_DB, uid, process.env.ODOO_API_KEY, model, method, args, kwargs], (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
    });
}

async function testPartner() {
    try {
        await authenticate();
        console.log("Auth Success. UID:", uid);

        console.log("Searching for 'Cliente Web (Listex)'...");
        const records = await executeKw('res.partner', 'search', [[['name', '=', 'Cliente Web (Listex)']]], { limit: 1 });
        console.log("Search Result:", records);

        if (records.length === 0) {
            console.log("Creating new partner...");
            const newId = await executeKw('res.partner', 'create', [{
                name: 'Cliente Web (Listex)',
                comment: 'Test partner'
            }]);
            console.log("Created Partner ID:", newId);
        } else {
            console.log("Partner already exists with ID:", records[0]);
        }

        console.log("Attempting to create a sale.order (draft)...");
        const partnerId = records.length > 0 ? records[0] : null; // In real code it would be the newId
        if (partnerId) {
            const orderId = await executeKw('sale.order', 'create', [{
                partner_id: partnerId,
                state: 'draft'
            }]);
            console.log("SALE ORDER CREATED SUCCESSFULLY! ID:", orderId);
        }

    } catch (e) {
        console.error("Test Error:", e);
    }
}

testPartner();
