require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const escpos = require("escpos");
const fs = require("fs");
const path = require("path");

escpos.Network = require("escpos-network");

const { printTicket, printCancelTicket } = require("./printer");

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.PRINT_API_KEY;

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
  lines.push(`Mode: ${data.mode || 'NON-SPECIFIE'}`); // ✅ Debug info
  lines.push('--------------------------------');
  
  // Note globale de la commande si présente
  if (data.noteCommande && data.noteCommande.trim()) {
    lines.push('NOTE GLOBALE:');
    lines.push(`> ${data.noteCommande}`);
    lines.push('--------------------------------');
  }
  
  // ✅ Traitement des produits avec la même logique que printComposedMenuDetails
  data.produits.forEach((item, itemIndex) => {
    let productName = item.nom;
    
    // ✅ Gestion des portions (comme dans formatPortionInfo)
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
    
    // ✅ Gestion des menus composés - MÊME LOGIQUE que printComposedMenuDetails
    if (item.isComposed && item.composedDetails && Array.isArray(item.composedDetails)) {
      console.log(`🔍 PREVIEW DEBUG: Processing composed menu for ${item.nom}`);
      console.log(`🔍 PREVIEW DEBUG: Found ${item.composedDetails.length} steps`);
      
      // Parcourir toutes les étapes et afficher tous les choix avec des tirets
      item.composedDetails.forEach((detail, stepIndex) => {
        console.log(`🔍 PREVIEW DEBUG: Step ${stepIndex + 1}: ${detail.stepLabel}`);
        console.log(`🔍 PREVIEW DEBUG: Items:`, detail.items);
        
        if (!detail.items || !Array.isArray(detail.items)) {
          console.log(`❌ PREVIEW DEBUG: No items in step ${stepIndex + 1}`);
          return;
        }
        
        // Ajouter le label de l'étape (optionnel, pour plus de clarté)
        // lines.push(`    ${detail.stepLabel}:`);
        
        // Afficher chaque choix avec un tiret (exactement comme printComposedMenuDetails)
        detail.items.forEach((selectedItem, itemIndex) => {
          console.log(`🔍 PREVIEW DEBUG: Item ${itemIndex + 1}: ${selectedItem.nom}`);
          
          // ✅ MÊME FORMAT que printComposedMenuDetails
          const itemText = `  * ${selectedItem.nom}`;
          lines.push(itemText);
          
          // Note personnalisée si présente (même logique)
          if (selectedItem.note && selectedItem.note.trim()) {
            console.log(`🔍 PREVIEW DEBUG: Adding note: ${selectedItem.note}`);
            lines.push(`    NOTE: ${selectedItem.note}`);
          }
        });
      });
      
      console.log(`✅ PREVIEW DEBUG: Finished processing composed menu`);
    }
    
    // ✅ Instructions spéciales classiques
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

// ✅ Fonction pour générer un aperçu textuel du ticket d'annulation
function generateCancelTicketPreview(data, includeTimestamp = true) {
  const lines = [];
  
  // Header avec ANNULE
  const isTableOrder = data.table && data.table !== 'EMPORTER';
  const orderType = isTableOrder ? 'TABLE' : 'EMPORTER';
  const orderNumber = isTableOrder ? data.table : (data.clientNumber || data.numeroClient || '?');
  
  lines.push('================================');
  lines.push(`      ANNULE ${orderType} ${orderNumber}      `);
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
  lines.push('COMMANDE ANNULEE');
  lines.push('--------------------------------');
  
  // Raison d'annulation si présente
  if (data.cancellationReason && data.cancellationReason.trim()) {
    lines.push('RAISON ANNULATION:');
    lines.push(`> ${data.cancellationReason}`);
    lines.push('--------------------------------');
  }
  
  // Note globale de la commande si présente
  if (data.noteCommande && data.noteCommande.trim()) {
    lines.push('NOTE GLOBALE:');
    lines.push(`> ${data.noteCommande}`);
    lines.push('--------------------------------');
  }
  
  // Traitement des produits (même logique que le ticket normal)
  data.produits.forEach((item, itemIndex) => {
    // Nom du produit avec quantité et portion
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
      productName += ` (${portionText})`;
    }
    
    const productLine = `${item.quantite}x ${productName}`;
    lines.push(productLine);
    
    // Gestion des menus composés
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
  
  // Numéro client pour les commandes à emporter
  if (!isTableOrder && (data.clientNumber || data.numeroClient)) {
    lines.push(`Client N°${data.clientNumber || data.numeroClient}`);
  }
  
  lines.push('      COMMANDE ANNULEE');
  lines.push('================================');
  lines.push('');
  
  return lines.join('\n');
}

// ✅ Fonction pour créer le fichier de log normal
function createLogFile(data) {
  try {
    const logDir = ensureLogDirectory();
    
    // Générer le nom du fichier avec timestamp
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-'); // HH-MM-SS
    const commandeId = data.commandeId || 'UNKNOWN';
    
    const filename = `${dateStr}_${timeStr}_${commandeId}.log`;
    const filepath = path.join(logDir, filename);
    
    // Contenu du fichier de log
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
      // ✅ CORRECTION: Utiliser le champ mode
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
    
    // Écrire le fichier
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

// ✅ Fonction pour créer le fichier de log d'annulation
function createCancelLogFile(data) {
  try {
    const logDir = ensureLogDirectory();
    
    // Générer le nom du fichier avec timestamp
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-'); // HH-MM-SS
    const commandeId = data.commandeId || 'UNKNOWN';
    
    const filename = `CANCEL_${dateStr}_${timeStr}_${commandeId}.log`;
    const filepath = path.join(logDir, filename);
    
    // Contenu du fichier de log
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
    
    // Écrire le fichier
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

// 🧪 Test d'impression - ✅ Mis à jour avec le nouveau workflow
app.get("/print-test", (req, res) => {
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
      // ✅ Test menu composé
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
      // ✅ Test portion
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

// ✅ NOUVEAU : Aperçu du ticket sans impression
app.post("/print-preview", (req, res) => {
  const data = req.body;
  
  // Validation des données (même que print-ticket)
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
    // Ajouter une IP fake pour la simulation
    const dataWithFakeIp = {
      ...data,
      ip: "FAKE-PREVIEW"
    };
    
    // Générer l'aperçu textuel
    const preview = generateTicketPreview(dataWithFakeIp);
    
    // Analyser les fonctionnalités utilisées
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

// 🧾 Impression ticket normal - ✅ Compatible avec l'ancien ET le nouveau workflow
app.post("/print-ticket", (req, res) => {
  const ip = req.body.ip;
  const data = req.body;

  if (!ip) {
    return res.status(400).json({ error: "IP de l'imprimante manquante (champ 'ip')" });
  }
  if (!data.produits || !Array.isArray(data.produits)) {
    return res.status(400).json({ error: "Produits manquants ou invalides", received: data });
  }

  // ✅ Log détaillé pour debug (optionnel)
  console.log(`🖨️ Impression ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'} - ${data.produits.length} article(s)`);
  
  // ✅ Détection des nouvelles fonctionnalités (pour info)
  const hasComposedMenus = data.produits.some(item => item.isComposed);
  const hasPortions = data.produits.some(item => item.portionInfo);
  if (hasComposedMenus || hasPortions) {
    console.log(`  ✨ Nouveau workflow détecté: ${hasComposedMenus ? 'menus composés' : ''} ${hasPortions ? 'portions' : ''}`);
  }

  printTicket(ip, data, (err) => {
    if (err) {
      console.error(`❌ Erreur impression: ${err.message}`);
      return res.status(500).json({ error: "Erreur impression ticket", details: err.message });
    }
    
    console.log(`✅ Impression réussie: ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'}`);
    res.json({ success: true, message: "Ticket imprimé avec succès" });
  });
});

// 🧾 Impression ticket d'annulation - ✅ NOUVEAU
app.post("/cancel-ticket", (req, res) => {
  const ip = req.body.ip;
  const data = req.body;

  if (!ip) {
    return res.status(400).json({ error: "IP de l'imprimante manquante (champ 'ip')" });
  }
  if (!data.produits || !Array.isArray(data.produits)) {
    return res.status(400).json({ error: "Produits manquants ou invalides", received: data });
  }

  // Log détaillé pour debug
  console.log(`🚫 Annulation ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'} - ${data.produits.length} article(s)`);
  if (data.cancellationReason) {
    console.log(`   Raison: ${data.cancellationReason}`);
  }
  
  // Détection des nouvelles fonctionnalités
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

// ✅ Mode logging normal - impression dans fichier sans imprimante physique
app.post("/print-ticket-log", (req, res) => {
  const data = req.body;

  // Validation des données (même que print-ticket)
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
    // Log dans la console (même format que print-ticket normal)
    console.log(`📝 [LOG MODE] Impression ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'} - ${data.produits.length} article(s)`);
    
    // Détection des nouvelles fonctionnalités
    const hasComposedMenus = data.produits.some(item => item.isComposed);
    const hasPortions = data.produits.some(item => item.portionInfo);
    const hasInstructions = data.produits.some(item => item.specialInstructions);
    const hasGlobalNote = data.noteCommande && data.noteCommande.trim();
    
    if (hasComposedMenus || hasPortions) {
      console.log(`  ✨ [LOG] Nouveau workflow détecté: ${hasComposedMenus ? 'menus composés' : ''} ${hasPortions ? 'portions' : ''}`);
    }
    
    // Créer le fichier de log
    const logInfo = createLogFile(data);
    
    console.log(`✅ [LOG] Ticket enregistré dans: ${logInfo.filename} (${logInfo.size} bytes)`);
    
    // Générer l'aperçu pour la réponse
    const preview = generateTicketPreview(data, true);
    
    // Réponse similaire à print-ticket mais avec infos de logging
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

// ✅ Mode logging annulation - ✅ NOUVEAU
app.post("/cancel-ticket-log", (req, res) => {
  const data = req.body;

  // Validation des données (même que cancel-ticket)
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
    // Log dans la console
    console.log(`📝 [LOG MODE] Annulation ${data.table || 'EMPORTER'} - ${data.commandeId || 'ID?'} - ${data.produits.length} article(s)`);
    if (data.cancellationReason) {
      console.log(`   [LOG] Raison: ${data.cancellationReason}`);
    }
    
    // Détection des nouvelles fonctionnalités
    const hasComposedMenus = data.produits.some(item => item.isComposed);
    const hasPortions = data.produits.some(item => item.portionInfo);
    const hasInstructions = data.produits.some(item => item.specialInstructions);
    const hasGlobalNote = data.noteCommande && data.noteCommande.trim();
    const hasCancellationReason = data.cancellationReason && data.cancellationReason.trim();
    
    if (hasComposedMenus || hasPortions) {
      console.log(`  ✨ [LOG] Nouveau workflow détecté: ${hasComposedMenus ? 'menus composés' : ''} ${hasPortions ? 'portions' : ''}`);
    }
    
    // Créer le fichier de log d'annulation
    const logInfo = createCancelLogFile(data);
    
    console.log(`✅ [LOG] Ticket d'annulation enregistré dans: ${logInfo.filename} (${logInfo.size} bytes)`);
    
    // Générer l'aperçu pour la réponse
    const preview = generateCancelTicketPreview(data, true);
    
    // Réponse similaire à cancel-ticket mais avec infos de logging
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

// ✅ Lister les fichiers de log créés
app.get("/logs", (req, res) => {
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
      .sort((a, b) => b.created - a.created); // Plus récent en premier

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

// ✅ Lire un fichier de log spécifique
app.get("/logs/:filename", (req, res) => {
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

// 🩺 Health check
app.get("/health", (req, res) => {
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

// 🚀 Lancement du serveur
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
  
  // Créer le dossier logs au démarrage
  ensureLogDirectory();
});