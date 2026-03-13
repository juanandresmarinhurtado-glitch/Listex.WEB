const fs = require('fs');
const https = require('https');

https.get('https://listex.odoo.com/web/content/16098', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const products = JSON.parse(data);
        console.log(`Loaded ${products.length} products`);

        let allProducts = products;

        // Mock DOM
        const mockDoc = {
            getElementById: (id) => ({
                classList: { add: () => { }, remove: () => { } },
                innerHTML: '',
                textContent: '',
                appendChild: () => { },
                children: []
            })
        };
        global.document = mockDoc;

        // Simulating the code
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

        function updateDetailPrice() { }
        function updateDetailStock() { }

        function applyVariantRules() {
            const presentacionKey = Object.keys(selectedAttributes).find(k => k.toLowerCase().includes('presentación') || k.toLowerCase().includes('presentacion'));
            const colorKey = Object.keys(selectedAttributes).find(k => k.toLowerCase().includes('color') || k.toLowerCase().includes('estampado'));
            const tallaKey = Object.keys(selectedAttributes).find(k => k.toLowerCase().includes('talla'));

            if (presentacionKey && selectedAttributes[presentacionKey]) {
                const presValue = selectedAttributes[presentacionKey].toLowerCase();

                if (presValue.includes('docena')) {
                    if (colorKey) selectedAttributes[colorKey] = "Surtido";
                    if (tallaKey) selectedAttributes[tallaKey] = "Surtido";
                } else if (presValue.includes('unidad')) {
                    if (colorKey && selectedAttributes[colorKey].toLowerCase().includes('surtido')) {
                        const allPossibleColors = [...new Set(currentDetailVariants.map(v => getAttrValue(v, colorKey)))];
                        const validColors = allPossibleColors.filter(c => c && !c.toLowerCase().includes('surtido'));
                        if (validColors.length > 0) selectedAttributes[colorKey] = validColors[0];
                    }
                }
            }

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

            const colorKey = Object.keys(selectedAttributes).find(k => k.toLowerCase().includes('color') || k.toLowerCase().includes('estampado'));
            const currentColorValue = colorKey ? selectedAttributes[colorKey] : null;

            let variantsForImages = currentDetailVariants;
            if (currentColorValue) {
                variantsForImages = currentDetailVariants.filter(v => getAttrValue(v, colorKey) === currentColorValue);
            }

            const seenUrls = new Set();
            const uniqueImages = [];
            variantsForImages.forEach(v => {
                const url = v.URL_Imagen && v.URL_Imagen !== "false" ? v.URL_Imagen : null;
                if (url && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    uniqueImages.push(url);
                }
            });

            const allAttrNames = new Set();
            const attrNamesMap = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];
            currentDetailVariants.forEach(v => {
                attrNamesMap.forEach(n => { if (v[n]) allAttrNames.add(v[n]); });
            });

            const presentacionKey = Array.from(allAttrNames).find(k => k.toLowerCase().includes('presentación') || k.toLowerCase().includes('presentacion'));
            const isDocenaSelected = presentacionKey && selectedAttributes[presentacionKey] && selectedAttributes[presentacionKey].toLowerCase().includes('docena');
            const isUnidadSelected = presentacionKey && selectedAttributes[presentacionKey] && selectedAttributes[presentacionKey].toLowerCase().includes('unidad');

            allAttrNames.forEach(attrName => {
                let possibleValues = new Set();
                currentDetailVariants.forEach(v => {
                    const val = getAttrValue(v, attrName);
                    if (val) possibleValues.add(val);
                });

                let valuesArray = Array.from(possibleValues);

                if (isDocenaSelected && attrName !== presentacionKey) {
                    valuesArray = valuesArray.filter(val => val.toLowerCase().includes('surtido') || val.toLowerCase().includes('variado'));
                    if (valuesArray.length === 0) return;
                }

                if (isUnidadSelected && (attrName.toLowerCase().includes('color') || attrName.toLowerCase().includes('estampado'))) {
                    valuesArray = valuesArray.filter(val => !val.toLowerCase().includes('surtido') && !val.toLowerCase().includes('variado'));
                }
            });
            console.log("updateVariantUI succeeded");
        }

        function openProductDetail(handle) {
            currentDetailHandle = handle;
            currentDetailVariants = allProducts.filter(p => String(p.Handle) === String(handle));

            if (currentDetailVariants.length === 0) return;

            const firstVariant = currentDetailVariants.find(v => parseFloat(v.Cantidad_Disponible) > 0) || currentDetailVariants[0];
            selectedAttributes = {};
            const attrNames = ['Atributo_1_Nombre', 'Atributo_2_Nombre', 'Atributo_3_Nombre', 'Atributo_4_Nombre'];

            attrNames.forEach(n => {
                if (firstVariant[n]) {
                    selectedAttributes[firstVariant[n]] = getAttrValue(firstVariant, firstVariant[n]);
                }
            });

            applyVariantRules();
            updateVariantUI();
        }

        try {
            // Try to open first product
            openProductDetail(allProducts[0].Handle);
            console.log("Success testing first product.");
        } catch (e) {
            console.error("ERROR testing first product:", e);
        }
    });
});
