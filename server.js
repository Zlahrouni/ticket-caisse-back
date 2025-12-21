require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const escpos = require("escpos");
const fs = require("fs");
const path = require("path");
const swaggerUi = require('swagger-ui-express');

escpos.Network = require("escpos-network");

const { printTicket, printCancelTicket } = require("./printer");

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.PRINT_API_KEY;

// ============================================
// SWAGGER SETUP
// ============================================
let swaggerDocument;
try {
  swaggerDocument = require('./swagger-output.json');
  console.log('📚 Documentation Swagger chargée');
} catch (error) {
  console.warn('⚠️  swagger-output.json non trouvé. Exécutez: node swagger.js');
}

// Servir la documentation Swagger à /api-docs
if (swaggerDocument) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'API Impression Tickets - Documentation'
  }));
  console.log('📖 Documentation disponible sur: http://localhost:3001/api-docs');
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());

// 🔓 Authentification optionnelle
const SKIP_AUTH = process.env.SKIP_AUTH === "true" || !API_KEY;

app.use((req, res, next) => {
  if (SKIP_AUTH) {
    console.log(`⚠️ Mode sans authentification - ${req.method} ${req.path}`);
    return next();
  }
  const token = req.headers.authorization;
  if (!token || token !== `Bearer ${API_KEY}`) {
    return res.status(403).json({ error: "Non autorisé" });
  }
  next();
});

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

// ✅ Fonction pour s'assurer que le dossier logs existe
function ensureLogDirectory() {
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    console.log('📁 Dossier logs créé:', logDir);
  }
  return logDir;
}

function generateTicketPreview(data, includeTimestamp = true) {
  const lines = [];
  
  // ✅ NOUVELLE LOGIQUE: Utiliser le champ mode au lieu de détecter via table
  const isTableOrder = data.mode === 'sur_place';
  const orderType = isTableOrder ? 'TABLE' : 'EMPORTER';
  
  // ✅ Logique simplifiée pour le numéro
  let orderNumber;
  if (isTableOrder) {
    orderNumber = data.table || '?';
  } else {
    orderNumber = data.numeroClient || data.clientNumber || '?';
  }
  
  lines.push('================================');
  lines.push(`        ${orderType} (${orderNumber})        `);
  lines.push('================================');
  
  // Informations de commande
  const timestamp = includeTimestamp ? 
    (data.timestamp || new Date().toLocaleTimeString("fr-FR", { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })) : 
    'HH:MM:SS';
  
  lines.push(`Commande: ${data.commandeId || "ID-INCONNU"}`);
  lines.push(`Heure: ${timestamp}`);
  lines.push(`Mode: ${data.mode || 'NON-SPECIFIE'}`);
  lines.push('--------------------------------');
  
  // Note globale de la commande si présente
  if (data.noteCommande && data.noteCommande.trim()) {
    lines.push('NOTE GLOBALE:');
    lines.push(`> ${data.noteCommande}`);
    lines.push('--------------------------------');
  }
  
  // Traitement des produits
  data.produits.forEach((item, itemIndex) => {
    let productName = item.nom;
    
    // Gestion des portions
    if (item.portionInfo) {
      let portionText = item.portionInfo;
      const portionMap = {
        ' 🔸': ' (piece)',
        ' 🔸 demi': ' (1/2)',
        'demi part': ' (1/2)',
        'à la pièce': ' (piece)',
        'demi': ' (1/2)',
        'pièce': ' (piece)'
      };
      
      for (const [key, value] of Object.entries(portionMap)) {
        portionText = portionText.replace(key, value);
      }
      productName += portionText;
    }
    
    const productLine = `${item.quantite}x ${productName}`;
    lines.push(productLine);
    
    // Gestion des menus composés
    if (item.isComposed && item.composedDetails && Array.isArray(item.composedDetails)) {
      item.composedDetails.forEach((detail) => {
        if (!detail.items || !Array.isArray(detail.items)) return;
        
        detail.items.forEach((selectedItem) => {
          const itemText = `  * ${selectedItem.nom}`;
          lines.push(itemText);
          
          if (selectedItem.note && selectedItem.note.trim()) {
            lines.push(`    NOTE: ${selectedItem.note}`);
          }
        });
      });
    }
    
    // Instructions spéciales classiques
    if (item.specialInstructions && item.specialInstructions.trim()) {
      lines.push(`  Instruction: ${item.specialInstructions}`);
    }
    
    // Espacement entre les produits
    if (itemIndex < data.produits.length - 1) {
      lines.push("------------------------");
    }
  });

  // Footer
  lines.push('================================');
  lines.push('         FIN TICKET');
  lines.push('================================');
  lines.push('');
  
  return lines.join('\n');
}

function generateCancelTicketPreview(data, includeTimestamp = true) {
  const lines = [];
  
  const isTableOrder = data.table && data.table !== 'EMPORTER';
  const orderType = isTableOrder ? 'TABLE' : 'EMPORTER';
  const orderNumber = isTableOrder ? data.table : (data.clientNumber || data.numeroClient || '?');
  
  lines.push('================================');
  lines.push(`      ANNULE ${orderType} ${orderNumber}      `);
  lines.push('================================');
  
  const timestamp = includeTimestamp ? 
    (data.timestamp || new Date().toLocaleTimeString("fr-FR", { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })) : 
    'HH:MM:SS';
  
  lines.push(`Commande: ${data.commandeId || "ID-INCONNU"}`);
  lines.push(`Heure: ${timestamp}`);
  lines.push('COMMANDE ANNULEE');
  lines.push('--------------------------------');
  
  if (data.cancellationReason && data.cancellationReason.trim()) {
    lines.push('RAISON ANNULATION:');
    lines.push(`> ${data.cancellationReason}`);
    lines.push('--------------------------------');
  }
  
  if (data.noteCommande && data.noteCommande.trim()) {
    lines.push('NOTE GLOBALE:');
    lines.push(`> ${data.noteCommande}`);
    lines.push('--------------------------------');
  }
  
  data.produits.forEach((item, itemIndex) => {
    let productName = item.nom;
    
    if (item.portionInfo) {
      let portionText = item.portionInfo;
      const portionMap = {
        ' 🔸': ' (piece)',
        ' 🔸 demi': ' (1/2)',
        'demi part': ' (1/2)',
        'à la pièce': ' (piece)',
        'demi': ' (1/2)',
        'pièce': ' (piece)'
      };
      
      for (const [key, value] of Object.entries(portionMap)) {
        portionText = portionText.replace(key, value);
      }
      productName += ` (${portionText})`;
    }
    
    const productLine = `${item.quantite}x ${productName}`;
    lines.push(productLine);
    
    if (item.isComposed && item.composedDetails) {
      lines.push("  > Personnalisations :");
      
      item.composedDetails.forEach((detail, index) => {
        lines.push(`    ${detail.stepLabel} :`);
        
        detail.items.forEach((selectedItem) => {
          lines.push(`      * ${selectedItem.nom}`);
          
          if (selectedItem.note && selectedItem.note.trim()) {
            lines.push(`        NOTE: ${selectedItem.note}`);
          }
        });
        
        if (index < item.composedDetails.length - 1) {
          lines.push("");
        }
      });
      
      lines.push("  ........................");
    }
    
    if (item.specialInstructions && item.specialInstructions.trim()) {
      lines.push(`  Instruction: ${item.specialInstructions}`);
    }
    
    if (itemIndex < data.produits.length - 1) {
      lines.push("------------------------");
    }
  });

  lines.push('================================');
  
  if (!isTableOrder && (data.clientNumber || data.numeroClient)) {
    lines.push(`Client N°${data.clientNumber || data.numeroClient}`);
  }
  
  lines.push('      COMMANDE ANNULEE');
  lines.push('================================');
  lines.push('');
  
  return lines.join('\n');
}

function createLogFile(data) {
  try {
    const logDir = ensureLogDirectory();
    
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-');
    const commandeId = data.commandeId || 'UNKNOWN';
    
    const filename = `${dateStr}_${timeStr}_${commandeId}.log`;
    const filepath = path.join(logDir, filename);
    
    const logContent = [
      '========================================',
      '         LOG TICKET IMPRESSION         ',
      '========================================',
      `Date: ${now.toLocaleString('fr-FR')}`,
      `Fichier: ${filename}`,
      '',
      '--- DONNÉES POST REÇUES ---',
      JSON.stringify(data, null, 2),
      '',
      '--- APERÇU TICKET GÉNÉRÉ ---',
      generateTicketPreview(data, true),
      '',
      '--- ANALYSE ---',
      `IP fournie: ${data.ip || 'NON SPÉCIFIÉE'}`,
      `Mode commande: ${data.mode || 'NON SPÉCIFIÉ'}`,
      `Type commande: ${data.mode === 'sur_place' ? 'Sur place' : data.mode === 'emporter' ? 'À emporter' : 'Inconnu'}`,
      `Numéro: ${data.mode === 'sur_place' ? (data.table || 'N/A') : (data.numeroClient || data.clientNumber || 'N/A')}`,
      `Nombre d'articles: ${data.produits ? data.produits.length : 0}`,
      `Menus composés: ${data.produits && data.produits.some(p => p.isComposed) ? 'OUI' : 'NON'}`,
      `Portions spéciales: ${data.produits && data.produits.some(p => p.portionInfo) ? 'OUI' : 'NON'}`,
      `Instructions spéciales: ${data.produits && data.produits.some(p => p.specialInstructions) ? 'OUI' : 'NON'}`,
      `Note globale: ${data.noteCommande ? 'OUI' : 'NON'}`,
      '',
      '========================================',
      '              FIN LOG                  ',
      '========================================'
    ].join('\n');
    
    fs.writeFileSync(filepath, logContent, 'utf8');
    
    return {
      filename,
      filepath,
      size: Buffer.byteLength(logContent, 'utf8')
    };
    
  } catch (error) {
    console.error('❌ Erreur création fichier log:', error);
    throw error;
  }
}

function createCancelLogFile(data) {
  try {
    const logDir = ensureLogDirectory();
    
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-');
    const commandeId = data.commandeId || 'UNKNOWN';
    
    const filename = `CANCEL_${dateStr}_${timeStr}_${commandeId}.log`;
    const filepath = path.join(logDir, filename);
    
    const logContent = [
      '========================================',
      '      LOG TICKET ANNULATION           ',
      '========================================',
      `Date: ${now.toLocaleString('fr-FR')}`,
      `Fichier: ${filename}`,
      '',
      '--- DONNÉES POST REÇUES ---',
      JSON.stringify(data, null, 2),
      '',
      '--- APERÇU TICKET ANNULATION ---',
      generateCancelTicketPreview(data, true),
      '',
      '--- ANALYSE ---',
      `IP fournie: ${data.ip || 'NON SPÉCIFIÉE'}`,
      `Type commande: ${data.table && data.table !== 'EMPORTER' ? 'Sur place' : 'À emporter'}`,
      `Nombre d'articles: ${data.produits ? data.produits.length : 0}`,
      `Raison annulation: ${data.cancellationReason || 'NON SPÉCIFIÉE'}`,
      `Menus composés: ${data.produits && data.produits.some(p => p.isComposed) ? 'OUI' : 'NON'}`,
      `Portions spéciales: ${data.produits && data.produits.some(p => p.portionInfo) ? 'OUI' : 'NON'}`,
      `Instructions spéciales: ${data.produits && data.produits.some(p => p.specialInstructions) ? 'OUI' : 'NON'}`,
      '',
      '========================================',
      '           FIN LOG ANNULATION         ',
      '========================================'
    ].join('\n');
    
    fs.writeFileSync(filepath, logContent, 'utf8');
    
    return {
      filename,
      filepath,
      size: Buffer.byteLength(logContent, 'utf8')
    };
    
  } catch (error) {
    console.error('❌ Erreur création fichier log annulation:', error);
    throw error;
  }
}

// ============================================
// ROUTES / ENDPOINTS
// ============================================

/**
 * GET /print-test
 * @tags Impression
 * @summary Test d'impression avec données factices
 * @description Envoie un ticket de test vers l'imprimante pour vérifier la connexion
 * @param {string} ip.query.required - Adresse IP de l'imprimante (ex: 192.168.1.100)
 * @returns {SuccessResponse} 200 - Test réussi
 * @returns {ErrorResponse} 400 - IP manquante
 * @returns {ErrorResponse} 500 - Erreur d'impression
 * @security bearerAuth
 * @example request - Exemple d'appel
 * GET /print-test?ip=192.168.1.100
 */
app.get("/print-test", (req, res) => {
  /* 
    #swagger.tags = ['Impression']
    #swagger.summary = 'Test d\'impression'
    #swagger.description = 'Envoie un ticket de test avec données factices pour vérifier la connexion à l\'imprimante'
    #swagger.parameters['ip'] = {
      in: 'query',
      description: 'Adresse IP de l\'imprimante thermique',
      required: true,
      type: 'string',
      example: '192.168.1.100'
    }
    #swagger.responses[200] = {
      description: 'Test d\'impression réussi',
      schema: { $ref: '#/definitions/SuccessResponse' }
    }
    #swagger.responses[400] = {
      description: 'IP manquante',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
    #swagger.responses[500] = {
      description: 'Erreur lors de l\'impression',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
  */
  const ip = req.query.ip;
  if (!ip) {
    return res.status(400).json({ error: "IP de l'imprimante manquante (paramètre ?ip=...)" });
  }

  const fakeData = {
    table: "TEST",
    commandeId: "TEST-001",
    timestamp: new Date().toISOString(),
    noteCommande: "Ceci est un test d'impression",
    produits: [
      { 
        quantite: 1, 
        nom: "Test Connexion", 
        specialInstructions: "Impression réussie 🎉" 
      },
      {
        quantite: 1,
        nom: "Burger Test",
        isComposed: true,
        composedDetails: [
          {
            stepLabel: "Viande",
            items: [{ nom: "Bœuf", note: "" }]
          },
          {
            stepLabel: "Sauce", 
            items: [{ nom: "Mayo", note: "Test note personnalisée" }]
          }
        ]
      },
      {
        quantite: 2,
        nom: "Houmous Test",
        portionInfo: "demi"
      }
    ]
  };

  printTicket(ip, fakeData, (err) => {
    if (err) {
      return res.status(500).json({ error: "Erreur impression test", details: err.message });
    }
    res.json({ success: true, message: "Impression test réussie avec nouveau workflow" });
  });
});

/**
 * POST /print-preview
 * @tags Test & Logging
 * @summary Aperçu du ticket sans impression
 * @description Génère un aperçu textuel du ticket sans l'envoyer à l'imprimante
 * @param {CommandeNormale} request.body.required - Données de la commande
 * @returns {PreviewResponse} 200 - Aperçu généré
 * @returns {ErrorResponse} 400 - Données invalides
 * @security bearerAuth
 */
app.post("/print-preview", (req, res) => {
  /* 
    #swagger.tags = ['Test & Logging']
    #swagger.summary = 'Aperçu du ticket sans impression'
    #swagger.description = 'Génère un aperçu textuel du ticket sans l\'envoyer à l\'imprimante. Utile pour vérifier le contenu avant impression.'
    #swagger.parameters['body'] = {
      in: 'body',
      description: 'Données de la commande',
      required: true,
      schema: { $ref: '#/definitions/CommandeNormale' }
    }
    #swagger.responses[200] = {
      description: 'Aperçu généré avec succès',
      schema: { $ref: '#/definitions/PreviewResponse' }
    }
    #swagger.responses[400] = {
      description: 'Données invalides',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
  */
  const data = req.body;
  
  if (!data.produits || !Array.isArray(data.produits)) {
    return res.status(400).json({ 
      error: "Produits manquants ou invalides", 
      received: data 
    });
  }

  if (data.produits.length === 0) {
    return res.status(400).json({ 
      error: "Aucun produit dans la commande" 
    });
  }

  try {
    const dataWithFakeIp = {
      ...data,
      ip: "FAKE-PREVIEW"
    };
    
    const preview = generateTicketPreview(dataWithFakeIp);
    
    const hasComposedMenus = data.produits.some(item => item.isComposed);
    const hasPortions = data.produits.some(item => item.portionInfo);
    const hasInstructions = data.produits.some(item => item.specialInstructions);
    
    console.log(`🔍 Aperçu généré: ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'} - ${data.produits.length} article(s)`);
    
    res.json({
      success: true,
      message: "Aperçu du ticket généré",
      preview: preview,
      analysis: {
        table: data.table || 'EMPORTER',
        commandeId: data.commandeId || 'Non spécifié',
        itemCount: data.produits.length,
        features: {
          composedMenus: hasComposedMenus,
          portions: hasPortions,
          specialInstructions: hasInstructions
        },
        products: data.produits.map((item, index) => ({
          index: index + 1,
          name: item.nom,
          quantity: item.quantite,
          isComposed: !!item.isComposed,
          hasPortionInfo: !!item.portionInfo,
          hasInstructions: !!item.specialInstructions,
          composedSteps: item.composedDetails ? item.composedDetails.length : 0
        }))
      }
    });
    
  } catch (error) {
    console.error("❌ Erreur génération aperçu:", error);
    res.status(500).json({ 
      error: "Erreur lors de la génération de l'aperçu", 
      details: error.message 
    });
  }
});

/**
 * POST /print-ticket
 * @tags Impression
 * @summary Impression d'un ticket de commande
 * @description Imprime un ticket de commande sur l'imprimante thermique
 * @param {OldWorkflowTicket} request.body.required - Données de la commande
 * @returns {SuccessResponse} 200 - Ticket imprimé
 * @returns {ErrorResponse} 400 - Données invalides
 * @returns {ErrorResponse} 500 - Erreur d'impression
 * @security bearerAuth
 */
app.post("/print-ticket", (req, res) => {
  /* 
    #swagger.tags = ['Impression']
    #swagger.summary = 'Imprimer un ticket de commande'
    #swagger.description = 'Imprime un ticket de commande sur l\'imprimante thermique. Utilise l\'ancien format avec "items" au lieu de "produits".'
    #swagger.parameters['body'] = {
      in: 'body',
      description: 'Données de la commande',
      required: true,
      schema: { $ref: '#/definitions/OldWorkflowTicket' }
    }
    #swagger.responses[200] = {
      description: 'Ticket imprimé avec succès',
      schema: { $ref: '#/definitions/SuccessResponse' }
    }
    #swagger.responses[400] = {
      description: 'Données invalides ou IP manquante',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
    #swagger.responses[500] = {
      description: 'Erreur lors de l\'impression',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
  */
  const data = req.body;

  if (!data.ip) {
    return res.status(400).json({ error: "IP de l'imprimante manquante" });
  }

  if (!data.items || !Array.isArray(data.items)) {
    return res.status(400).json({ error: "Items manquants ou invalides" });
  }

  printTicket(data.ip, data, (err) => {
    if (err) {
      return res.status(500).json({ error: "Erreur impression ticket", details: err.message });
    }
    res.json({ success: true, message: "Ticket imprimé avec succès" });
  });
});

/**
 * POST /cancel-ticket
 * @tags Impression
 * @summary Impression d'un ticket d'annulation
 * @description Imprime un ticket d'annulation de commande
 * @param {CancelTicket} request.body.required - Données de la commande annulée
 * @returns {SuccessResponse} 200 - Ticket d'annulation imprimé
 * @returns {ErrorResponse} 400 - Données invalides
 * @returns {ErrorResponse} 500 - Erreur d'impression
 * @security bearerAuth
 */
app.post("/cancel-ticket", (req, res) => {
  /* 
    #swagger.tags = ['Impression']
    #swagger.summary = 'Imprimer un ticket d\'annulation'
    #swagger.description = 'Imprime un ticket d\'annulation de commande sur l\'imprimante thermique'
    #swagger.parameters['body'] = {
      in: 'body',
      description: 'Données de la commande annulée',
      required: true,
      schema: { $ref: '#/definitions/CommandeAnnulation' }
    }
    #swagger.responses[200] = {
      description: 'Ticket d\'annulation imprimé',
      schema: { $ref: '#/definitions/SuccessResponse' }
    }
    #swagger.responses[400] = {
      description: 'Données invalides ou IP manquante',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
    #swagger.responses[500] = {
      description: 'Erreur lors de l\'impression',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
  */
  const ip = req.body.ip;
  const data = req.body;

  if (!ip) {
    return res.status(400).json({ error: "IP de l'imprimante manquante (champ 'ip')" });
  }
  if (!data.produits || !Array.isArray(data.produits)) {
    return res.status(400).json({ error: "Produits manquants ou invalides", received: data });
  }

  console.log(`🚫 Annulation ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'} - ${data.produits.length} article(s)`);
  if (data.cancellationReason) {
    console.log(`   Raison: ${data.cancellationReason}`);
  }
  
  const hasComposedMenus = data.produits.some(item => item.isComposed);
  const hasPortions = data.produits.some(item => item.portionInfo);
  if (hasComposedMenus || hasPortions) {
    console.log(`  ✨ Nouveau workflow détecté: ${hasComposedMenus ? 'menus composés' : ''} ${hasPortions ? 'portions' : ''}`);
  }

  printCancelTicket(ip, data, (err) => {
    if (err) {
      console.error(`❌ Erreur impression annulation: ${err.message}`);
      return res.status(500).json({ error: "Erreur impression ticket d'annulation", details: err.message });
    }
    
    console.log(`✅ Ticket d'annulation imprimé: ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'}`);
    res.json({ success: true, message: "Ticket d'annulation imprimé avec succès" });
  });
});

/**
 * POST /print-ticket-log
 * @tags Test & Logging
 * @summary Mode logging pour test sans imprimante
 * @description Enregistre le ticket dans un fichier log sans l'imprimer
 * @param {CommandeNormale} request.body.required - Données de la commande
 * @returns {LogResponse} 200 - Ticket enregistré dans les logs
 * @returns {ErrorResponse} 400 - Données invalides
 * @security bearerAuth
 */
app.post("/print-ticket-log", (req, res) => {
  /* 
    #swagger.tags = ['Test & Logging']
    #swagger.summary = 'Mode logging - Test sans imprimante'
    #swagger.description = 'Enregistre le ticket dans un fichier log au lieu de l\'imprimer. Idéal pour tester sans matériel physique.'
    #swagger.parameters['body'] = {
      in: 'body',
      description: 'Données de la commande',
      required: true,
      schema: { $ref: '#/definitions/CommandeNormale' }
    }
    #swagger.responses[200] = {
      description: 'Ticket enregistré dans les logs',
      schema: { $ref: '#/definitions/LogResponse' }
    }
    #swagger.responses[400] = {
      description: 'Données invalides',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
  */
  const data = req.body;

  if (!data.produits || !Array.isArray(data.produits)) {
    return res.status(400).json({ 
      error: "Produits manquants ou invalides", 
      received: data 
    });
  }

  if (data.produits.length === 0) {
    return res.status(400).json({ 
      error: "Aucun produit dans la commande" 
    });
  }

  try {
    console.log(`📝 [LOG MODE] Impression ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'} - ${data.produits.length} article(s)`);
    
    const hasComposedMenus = data.produits.some(item => item.isComposed);
    const hasPortions = data.produits.some(item => item.portionInfo);
    const hasInstructions = data.produits.some(item => item.specialInstructions);
    const hasGlobalNote = data.noteCommande && data.noteCommande.trim();
    
    if (hasComposedMenus || hasPortions) {
      console.log(`  ✨ [LOG] Nouveau workflow détecté: ${hasComposedMenus ? 'menus composés' : ''} ${hasPortions ? 'portions' : ''}`);
    }
    
    const logInfo = createLogFile(data);
    
    console.log(`✅ [LOG] Ticket enregistré dans: ${logInfo.filename} (${logInfo.size} bytes)`);
    
    const preview = generateTicketPreview(data, true);
    
    res.json({
      success: true,
      message: "Ticket enregistré dans les logs (mode test)",
      logFile: {
        filename: logInfo.filename,
        path: logInfo.filepath,
        size: logInfo.size,
        created: new Date().toISOString()
      },
      preview: preview,
      analysis: {
        table: data.table || 'EMPORTER',
        commandeId: data.commandeId || 'Non spécifié',
        itemCount: data.produits.length,
        features: {
          composedMenus: hasComposedMenus,
          portions: hasPortions,
          specialInstructions: hasInstructions,
          globalNote: hasGlobalNote
        }
      }
    });
    
  } catch (error) {
    console.error("❌ [LOG] Erreur création fichier log:", error);
    res.status(500).json({ 
      error: "Erreur lors de la création du fichier log", 
      details: error.message 
    });
  }
});

/**
 * POST /cancel-ticket-log
 * @tags Test & Logging
 * @summary Mode logging pour annulation sans imprimante
 * @description Enregistre le ticket d'annulation dans un fichier log
 * @param {CancelTicket} request.body.required - Données de la commande annulée
 * @returns {LogResponse} 200 - Ticket d'annulation enregistré
 * @returns {ErrorResponse} 400 - Données invalides
 * @security bearerAuth
 */
app.post("/cancel-ticket-log", (req, res) => {
  /* 
    #swagger.tags = ['Test & Logging']
    #swagger.summary = 'Mode logging - Annulation sans imprimante'
    #swagger.description = 'Enregistre le ticket d\'annulation dans un fichier log au lieu de l\'imprimer'
    #swagger.parameters['body'] = {
      in: 'body',
      description: 'Données de la commande annulée',
      required: true,
      schema: { $ref: '#/definitions/CommandeAnnulation' }
    }
    #swagger.responses[200] = {
      description: 'Ticket d\'annulation enregistré',
      schema: { $ref: '#/definitions/LogResponse' }
    }
    #swagger.responses[400] = {
      description: 'Données invalides',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
  */
  const data = req.body;

  if (!data.produits || !Array.isArray(data.produits)) {
    return res.status(400).json({ 
      error: "Produits manquants ou invalides", 
      received: data 
    });
  }

  if (data.produits.length === 0) {
    return res.status(400).json({ 
      error: "Aucun produit dans la commande" 
    });
  }

  try {
    console.log(`📝 [LOG MODE] Annulation ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'} - ${data.produits.length} article(s)`);
    if (data.cancellationReason) {
      console.log(`   [LOG] Raison: ${data.cancellationReason}`);
    }
    
    const hasComposedMenus = data.produits.some(item => item.isComposed);
    const hasPortions = data.produits.some(item => item.portionInfo);
    const hasInstructions = data.produits.some(item => item.specialInstructions);
    const hasGlobalNote = data.noteCommande && data.noteCommande.trim();
    const hasCancellationReason = data.cancellationReason && data.cancellationReason.trim();
    
    if (hasComposedMenus || hasPortions) {
      console.log(`  ✨ [LOG] Nouveau workflow détecté: ${hasComposedMenus ? 'menus composés' : ''} ${hasPortions ? 'portions' : ''}`);
    }
    
    const logInfo = createCancelLogFile(data);
    
    console.log(`✅ [LOG] Ticket d'annulation enregistré dans: ${logInfo.filename} (${logInfo.size} bytes)`);
    
    const preview = generateCancelTicketPreview(data, true);
    
    res.json({
      success: true,
      message: "Ticket d'annulation enregistré dans les logs (mode test)",
      logFile: {
        filename: logInfo.filename,
        path: logInfo.filepath,
        size: logInfo.size,
        created: new Date().toISOString()
      },
      preview: preview,
      analysis: {
        table: data.table || 'EMPORTER',
        commandeId: data.commandeId || 'Non spécifié',
        itemCount: data.produits.length,
        cancellationReason: data.cancellationReason || 'Non spécifiée',
        features: {
          composedMenus: hasComposedMenus,
          portions: hasPortions,
          specialInstructions: hasInstructions,
          globalNote: hasGlobalNote,
          cancellationReason: hasCancellationReason
        }
      }
    });
    
  } catch (error) {
    console.error("❌ [LOG] Erreur création fichier log d'annulation:", error);
    res.status(500).json({ 
      error: "Erreur lors de la création du fichier log d'annulation", 
      details: error.message 
    });
  }
});

/**
 * GET /logs
 * @tags Logs
 * @summary Liste de tous les fichiers de log
 * @description Récupère la liste de tous les fichiers de log créés
 * @returns {LogListResponse} 200 - Liste des logs
 * @returns {ErrorResponse} 500 - Erreur lecture logs
 * @security bearerAuth
 */
app.get("/logs", (req, res) => {
  /* 
    #swagger.tags = ['Logs']
    #swagger.summary = 'Liste de tous les logs'
    #swagger.description = 'Récupère la liste de tous les fichiers de log créés, triés par date (plus récent en premier)'
    #swagger.responses[200] = {
      description: 'Liste des logs récupérée',
      schema: { $ref: '#/definitions/LogListResponse' }
    }
    #swagger.responses[500] = {
      description: 'Erreur lors de la lecture des logs',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
  */
  try {
    const logDir = ensureLogDirectory();
    const files = fs.readdirSync(logDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const filepath = path.join(logDir, file);
        const stats = fs.statSync(filepath);
        return {
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          type: file.startsWith('CANCEL_') ? 'annulation' : 'normal'
        };
      })
      .sort((a, b) => b.created - a.created);

    res.json({
      success: true,
      count: files.length,
      logDirectory: logDir,
      files: files
    });
    
  } catch (error) {
    console.error("❌ Erreur lecture logs:", error);
    res.status(500).json({ 
      error: "Erreur lecture des logs", 
      details: error.message 
    });
  }
});

/**
 * GET /logs/:filename
 * @tags Logs
 * @summary Contenu d'un fichier de log spécifique
 * @description Récupère le contenu complet d'un fichier de log
 * @param {string} filename.path.required - Nom du fichier log
 * @returns {object} 200 - Contenu du log
 * @returns {ErrorResponse} 404 - Fichier introuvable
 * @security bearerAuth
 */
app.get("/logs/:filename", (req, res) => {
  /* 
    #swagger.tags = ['Logs']
    #swagger.summary = 'Contenu d\'un log spécifique'
    #swagger.description = 'Récupère le contenu complet d\'un fichier de log par son nom'
    #swagger.parameters['filename'] = {
      in: 'path',
      description: 'Nom du fichier log (ex: 2024-12-07_14-30-00_CMD_001.log)',
      required: true,
      type: 'string'
    }
    #swagger.responses[200] = {
      description: 'Contenu du log',
      schema: {
        success: true,
        filename: '2024-12-07_14-30-00_CMD_001.log',
        size: 2048,
        created: '2024-12-07T14:30:00Z',
        modified: '2024-12-07T14:30:00Z',
        type: 'normal',
        content: '========================================'
      }
    }
    #swagger.responses[404] = {
      description: 'Fichier de log introuvable',
      schema: { $ref: '#/definitions/ErrorResponse' }
    }
  */
  try {
    const filename = req.params.filename;
    const logDir = ensureLogDirectory();
    const filepath = path.join(logDir, filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: "Fichier de log introuvable" });
    }
    
    const content = fs.readFileSync(filepath, 'utf8');
    const stats = fs.statSync(filepath);
    
    res.json({
      success: true,
      filename: filename,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      type: filename.startsWith('CANCEL_') ? 'annulation' : 'normal',
      content: content
    });
    
  } catch (error) {
    console.error("❌ Erreur lecture fichier log:", error);
    res.status(500).json({ 
      error: "Erreur lecture du fichier log", 
      details: error.message 
    });
  }
});

/**
 * GET /health
 * @tags Santé
 * @summary Health check du serveur
 * @description Vérifie que le serveur est opérationnel
 * @returns {object} 200 - État du serveur
 */
app.get("/health", (req, res) => {
  /* 
    #swagger.tags = ['Santé']
    #swagger.summary = 'Health check'
    #swagger.description = 'Vérifie que le serveur est opérationnel et liste les endpoints disponibles'
    #swagger.responses[200] = {
      description: 'Serveur opérationnel',
      schema: {
        status: 'ok',
        time: '2024-12-07T14:30:00Z',
        modes: {
          print: '/print-ticket',
          cancel: '/cancel-ticket',
          test: '/print-test',
          preview: '/print-preview',
          log: '/print-ticket-log',
          cancelLog: '/cancel-ticket-log'
        }
      }
    }
  */
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(),
    modes: {
      print: "/print-ticket",
      cancel: "/cancel-ticket",
      test: "/print-test",
      preview: "/print-preview", 
      log: "/print-ticket-log",
      cancelLog: "/cancel-ticket-log"
    }
  });
});

// ============================================
// DÉMARRAGE DU SERVEUR
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🖨️ Serveur prêt sur le port ${PORT}`);
  console.log(`✨ Support: ancien workflow + nouveau workflow (menus composés, portions)`);
  console.log(`🔍 Endpoints disponibles:`);
  console.log(`   POST /print-ticket       - Impression normale`);
  console.log(`   POST /cancel-ticket      - Impression annulation`);
  console.log(`   POST /print-ticket-log   - Mode logging (test)`);
  console.log(`   POST /cancel-ticket-log  - Mode logging annulation`);
  console.log(`   POST /print-preview      - Aperçu sans impression`);
  console.log(`   GET  /logs              - Liste des logs`);
  console.log(`   GET  /logs/:filename    - Contenu d'un log`);
  console.log(`   GET  /health            - Health check`);
  if (swaggerDocument) {
    console.log(`   GET  /api-docs          - Documentation Swagger UI`);
  }
  
  ensureLogDirectory();
});