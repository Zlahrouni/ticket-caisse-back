const escpos = require("escpos");
escpos.Network = require("escpos-network");

function getDevice(ip) {
  try {
    return new escpos.Network(ip);
  } catch (err) {
    console.error("❌ Erreur réseau :", err);
    return null;
  }
}

function getStatus(callback) {
  const isNetwork = process.env.USE_NETWORK === "true";
  try {
    const device = isNetwork
      ? new escpos.Network(process.env.PRINTER_IP)
      : new escpos.USB();

    device.open((err) => {
      if (err) {
        return callback(null, { connected: false, mode: isNetwork ? "NETWORK" : "USB" });
      }
      device.close();
      callback(null, { connected: true, mode: isNetwork ? "NETWORK" : "USB" });
    });
  } catch {
    callback(null, { connected: false, mode: isNetwork ? "NETWORK" : "USB" });
  }
}


// Fonction pour découper le texte avec gestion de la césure française
function wrapText(text, maxWidth = 32) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    
    if (testLine.length <= maxWidth) {
      currentLine = testLine;
    } else {
      // Si la ligne actuelle n'est pas vide, on la sauvegarde
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      
      // Si le mot seul est trop long, on le coupe avec un tiret
      if (word.length > maxWidth) {
        let remainingWord = word;
        while (remainingWord.length > 0) {
          if (remainingWord.length <= maxWidth) {
            currentLine = remainingWord;
            break;
          } else {
            // Couper le mot en laissant de la place pour le tiret
            const cutPosition = maxWidth - 1;
            lines.push(remainingWord.substring(0, cutPosition) + '-');
            remainingWord = remainingWord.substring(cutPosition);
          }
        }
      } else {
        currentLine = word;
      }
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines;
}

function sanitizeText(str) {
  if (!str) return "";
  
  return String(str)
    // remplacer caractères non supportés
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "Oe")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "Ae")

    // normaliser accents
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

    // autres caractères rarement pris en charge
    .replace(/€/g, "EUR")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[«»]/g, '"')
    .replace(/[’]/g, "'");

}


// ✅ Fonction pour formater l'affichage des portions
function formatPortionInfo(item) {
  if (!item.portionInfo) return '';
  
  // Mapping des portions pour un affichage plus clair
  const portionMap = {
    ' 🔸': ' (piece)',
    ' 🔸 demi': ' (1/2)',
    'demi part': ' (1/2)',
    'à la pièce': ' (piece)',
    'demi': ' (1/2)',
    'pièce': ' (piece)'
  };
  
  let portionText = item.portionInfo;
  for (const [key, value] of Object.entries(portionMap)) {
    portionText = portionText.replace(key, value);
  }
  
  return portionText;
}

// ✅ Fonction pour imprimer les détails des menus composés - VERSION SIMPLIFIÉE
function printComposedMenuDetails(printer, item) {
  console.log(`🔍 DEBUG: Checking composed menu for ${item.nom}`);
  console.log(`🔍 DEBUG: isComposed = ${item.isComposed}`);
  console.log(`🔍 DEBUG: composedDetails =`, item.composedDetails);
  
  if (!item.isComposed || !item.composedDetails || !Array.isArray(item.composedDetails)) {
    console.log(`❌ DEBUG: Not a composed menu or no details`);
    return;
  }
  
  console.log(`✅ DEBUG: Processing ${item.composedDetails.length} steps`);
  
  // Parcourir toutes les étapes et afficher tous les choix avec des tirets
  item.composedDetails.forEach((detail, stepIndex) => {
    console.log(`🔍 DEBUG: Step ${stepIndex + 1}: ${detail.stepLabel}`);
    console.log(`🔍 DEBUG: Items:`, detail.items);
    
    if (!detail.items || !Array.isArray(detail.items)) {
      console.log(`❌ DEBUG: No items in step ${stepIndex + 1}`);
      return;
    }
    
    // Afficher chaque choix avec un tiret
    detail.items.forEach((selectedItem, itemIndex) => {
      console.log(`🔍 DEBUG: Item ${itemIndex + 1}: ${selectedItem.nom}`);
      
      const itemText = `  * ${sanitizeText(selectedItem.nom)}`;
      
      printer
        .style("normal")
        .size(1, 1)
        .text(itemText);
      
      // Note personnalisée si présente
      if (selectedItem.note && selectedItem.note.trim()) {
        console.log(`🔍 DEBUG: Adding note: ${selectedItem.note}`);
        printer
          .style("normal")
          .size(1, 1)
          .text(`    NOTE: ${sanitizeText(selectedItem.note)}`);
      }
    });
  });
  
  console.log(`✅ DEBUG: Finished printing composed menu`);
}

// ✅ Fonction d'impression de ticket normal
function printTicket(ip, data, callback) {
  const device = getDevice(ip);
  if (!device) return callback(new Error("Aucune imprimante détectée"));

  const printer = new escpos.Printer(device);

  device.open((error) => {
    if (error) return callback(error);

    try {
      // ---------------------------
      // 1) Normalisation des données
      // ---------------------------

      const isNewFormat = Array.isArray(data.items);
      const isOldFormat = Array.isArray(data.produits);

      const service =
        data.serviceType === "DINING" ? "TABLE"
        : data.serviceType === "TAKEAWAY" ? "EMPORTER"
        : data.serviceType === "DELIVERY" ? "LIVRAISON"
        : sanitizeText(data.serviceType || "SERVICE");

      const orderNumber =
        sanitizeText(data.orderNumber ?? data.commandeId ?? "?");

      const time = formatTimestamp(data.timestamp);

      // Transforme ancien format → format items unifié
      let items = [];

      if (isNewFormat) {
        items = data.items.map(item => ({
          qty: item.quantity ?? item.quantite ?? 1,
          name: item.name || item.nom || "Article",
          price: item.price,
          menuConfig: item.menuConfig
        }));
      }

      else if (isOldFormat) {
        items = data.produits.map(item => ({
          qty: item.quantite ?? 1,
          name: item.nom || "Article",
          price: item.prix,
          menuConfig: item.isComposed
            ? convertComposedDetailsToMenuConfig(item.composedDetails)
            : null
        }));
      }

      else {
        items = [];
      }

      // Helper conversion vieux format → nouveau
      function convertComposedDetailsToMenuConfig(composedDetails) {
        const out = {};
        if (!Array.isArray(composedDetails)) return out;
        composedDetails.forEach(step => {
          const label = step.stepLabel || "Choix";
          out[label] = step.items.map(i => i.nom);
        });
        return out;
      }


      // ---------------------------
      // 2) Impression header
      //----------------------------
      printer
        .align("ct")
        .style("b")
        .size(2, 1)
        .text(`${service} ${orderNumber}`)
        .size(1, 1)
        .style("normal");

      if (data.tableInfo?.tableNumber || data.tableInfo?.tableId) {
        const tableNumber = data.tableInfo.tableNumber;
        const zone = data.tableInfo.zoneName
          ? ` (${sanitizeText(data.tableInfo.zoneName)})`
          : "";
        printer.text(`Table: ${sanitizeText(tableNumber)}${zone}`);
      }

      printer.text(time);
      printer.text("========================").align("lt");

      // ---------------------------
      // 3) Impression des items
      // ---------------------------
      if (items.length === 0) {
        printer.text("Aucun article");
      } else {
        items.forEach((item, idx) => {
          const qty = item.qty ?? 1;
          const name = sanitizeText(item.name);
          const price = item.price != null ? ` - ${item.price}EUR` : "";
          const line = `${qty}x ${name}${price}`;

          wrapText(line, 32).forEach((l) =>
            printer.style("b").text(l)
          );

          // --- MENU CONFIG (nouveau + ancien format unifié) ---
          if (item.menuConfig && typeof item.menuConfig === "object") {
            Object.keys(item.menuConfig).forEach((groupKey) => {
              const groupItems = item.menuConfig[groupKey];
              if (Array.isArray(groupItems)) {
                groupItems.forEach((sub) => {
                  printer.text(`    - ${sanitizeText(sub)}`);
                });
              }
            });
          }

          if (idx < items.length - 1) {
            printer.text("------------------------");
          }
        });
      }

      // ---------------------------
      // FOOTER
      // ---------------------------
      printer.text("========================");
      printer.text("");
      printer.text("");
      printer.text("");

      printer.cut();
      printer.close();
      callback(null);

    } catch (err) {
      try { printer.close(); } catch {}
      callback(err);
    }
  });
}


function formatTimestamp(ts) {
  if (!ts) return "";

  const date = new Date(ts);

  if (isNaN(date.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");

  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();

  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}



// ✅ Fonction d'impression de ticket d'annulation - NOUVELLE
function printCancelTicket(ip, data, callback) {
  const device = getDevice(ip);
  if (!device) return callback(new Error("Aucune imprimante détectée"));

  const printer = new escpos.Printer(device);
  device.open(function (error) {
    if (error) return callback(error);

    // ✅ Header avec ANNULE en gros et visible
    const isTableOrder = data.table && data.table !== 'EMPORTER';
    const orderType = isTableOrder ? 'TABLE' : 'EMPORTER';
    const orderNumber = isTableOrder ? data.table : (data.clientNumber || data.numeroClient || '?');

    printer
      .align("ct")
      .style("b")
      .size(2, 2)
      .text("ANNULE")
      .size(2, 1)
      .text(`${orderType} (${sanitizeText(orderNumber.toString())})`)
      .size(1, 1)
      .style("normal");

    // ✅ Informations de commande avec mention d'annulation
    const timestamp = data.timestamp || new Date().toLocaleTimeString("fr-FR", { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
    
    printer
      .text(`${sanitizeText(data.commandeId || "-")} | ${timestamp}`)
      .style("b")
      .text("COMMANDE ANNULEE")
      .style("normal")
      .text("========================")
      .align("lt");

    // ✅ Raison d'annulation si fournie
    if (data.cancellationReason && data.cancellationReason.trim()) {
      printer
        .style("b")
        .text("RAISON:")
        .style("normal");
      
      const reasonLines = wrapText(`> ${sanitizeText(data.cancellationReason)}`, 30);
      reasonLines.forEach(line => {
        printer.text(line);
      });
      
      printer.text("------------------------");
    }

    // ✅ Note globale si présente
    if (data.noteCommande && data.noteCommande.trim()) {
      printer
        .style("b")
        .text("NOTE GLOBALE:")
        .style("normal");
      
      const noteLines = wrapText(`> ${sanitizeText(data.noteCommande)}`, 30);
      noteLines.forEach(line => {
        printer.text(line);
      });
      
      printer.text("------------------------");
    }

    // ✅ Traitement des produits (même logique que printTicket normal)
    data.produits.forEach((item, itemIndex) => {
      // Nom du produit avec quantité et portion
      let productName = sanitizeText(item.nom);
      const portionInfo = formatPortionInfo(item);
      if (portionInfo) {
        productName += ` (${portionInfo})`;
      }
      
      const productLine = `${item.quantite}x ${productName}`;
      const productLines = wrapText(productLine, 32);
      
      // Nom du produit en gras
      printer.style("b");
      productLines.forEach(line => {
        printer.text(line);
      });
      
      // Gestion des menus composés
      if (item.isComposed) {
        printComposedMenuDetails(printer, item);
      }
      
      // Instructions spéciales classiques
      if (item.specialInstructions && item.specialInstructions.trim()) {
        const instruction = `Instruction: ${sanitizeText(item.specialInstructions)}`;
        const instructionLines = wrapText(instruction, 30);
        
        printer
          .style("normal")
          .size(1, 0);
        
        instructionLines.forEach(line => {
          printer.text(`  ${line}`);
        });
        
        printer.size(1, 1);
      }
      
      // Espacement entre les produits
      if (itemIndex < data.produits.length - 1) {
        printer.text("------------------------");
      }
    });

    // ✅ Footer avec mention d'annulation claire
    printer
      .text("========================")
      .align("ct")
      .style("b")
      .size(1, 1)
      .text("COMMANDE ANNULEE");
    
    // Afficher seulement le numéro client pour les commandes à emporter
    if (!isTableOrder && (data.clientNumber || data.numeroClient)) {
      printer
        .style("normal")
        .text(`Client N°${data.clientNumber || data.numeroClient}`);
    }
    
    printer
      .style("b")
      .text("ANNULE")
      .cut();

    setTimeout(() => {
      printer.close();
      callback(null);
    }, 500);
  });
}

module.exports = {
  printTicket,
  printCancelTicket,  // ✅ NOUVEAU
  getStatus
};