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

function removeAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
      
      const itemText = `  * ${removeAccents(selectedItem.nom)}`;
      
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
          .text(`    NOTE: ${removeAccents(selectedItem.note)}`);
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
  device.open(function (error) {
    if (error) return callback(error);

    // ✅ Header normal avec détection du type
    const isTableOrder = data.table && data.table !== 'EMPORTER';
    const orderType = isTableOrder ? 'TABLE' : 'EMPORTER';
    const orderNumber = isTableOrder ? data.table : (data.clientNumber || data.numeroClient || '?');

    printer
      .align("ct")
      .style("b")
      .size(2, 1)
      .text(`${orderType} ${removeAccents(orderNumber.toString())}`)
      .size(1, 1)
      .style("normal");

    // ✅ Informations de commande
    const timestamp = data.timestamp || new Date().toLocaleTimeString("fr-FR", { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
    
    printer
      .text(`${timestamp}`)
      .text("========================")
      .align("lt");

    // ✅ Note globale de la commande si présente
    if (data.noteCommande && data.noteCommande.trim()) {
      printer
        .style("b")
        .text("NOTE GLOBALE:")
        .style("normal")
        .text(`> ${removeAccents(data.noteCommande)}`)
        .text("------------------------");
    }

    data.produits.forEach((item, itemIndex) => {
      // ✅ Nom du produit avec quantité et portion
      let productName = removeAccents(item.nom);
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
      console.log(`✅ item.isComposed = `, item.isComposed, typeof item.isComposed);
      // ✅ Gestion des menus composés (nouveau)
      if (item.isComposed) {
        printComposedMenuDetails(printer, item);
      }
      
      // ✅ Instructions spéciales classiques (améliorées)
      if (item.specialInstructions && item.specialInstructions.trim()) {
        const instruction = `Instruction: ${removeAccents(item.specialInstructions)}`;
        const instructionLines = wrapText(instruction, 30);
        
        printer
          .style("normal")
          .size(1, 0);
        
        instructionLines.forEach(line => {
          printer.text(`  ${line}`);
        });
        
        printer.size(1, 1);
      }
      
      // ✅ Espacement entre les produits
      if (itemIndex < data.produits.length - 1) {
        printer.text("------------------------");
      }
    });

    // ✅ Footer normal - garde seulement l'essentiel
    printer
      .text("========================")
      .align("ct")
      .style("normal")
      .size(1, 1);
    
    // Afficher seulement le numéro client pour les commandes à emporter
    if (!isTableOrder && (data.clientNumber || data.numeroClient)) {
      printer.text(`Client N°${data.clientNumber || data.numeroClient}`);
    }
    
    printer
      .text("FIN TICKET")
      .cut();

    setTimeout(() => {
      printer.close();
      callback(null);
    }, 500);
  });
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
      .text(`${orderType} ${removeAccents(orderNumber.toString())}`)
      .size(1, 1)
      .style("normal");

    // ✅ Informations de commande avec mention d'annulation
    const timestamp = data.timestamp || new Date().toLocaleTimeString("fr-FR", { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
    
    printer
      .text(`${removeAccents(data.commandeId || "-")} | ${timestamp}`)
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
      
      const reasonLines = wrapText(`> ${removeAccents(data.cancellationReason)}`, 30);
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
      
      const noteLines = wrapText(`> ${removeAccents(data.noteCommande)}`, 30);
      noteLines.forEach(line => {
        printer.text(line);
      });
      
      printer.text("------------------------");
    }

    // ✅ Traitement des produits (même logique que printTicket normal)
    data.produits.forEach((item, itemIndex) => {
      // Nom du produit avec quantité et portion
      let productName = removeAccents(item.nom);
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
        const instruction = `Instruction: ${removeAccents(item.specialInstructions)}`;
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