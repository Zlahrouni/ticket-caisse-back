const escpos = require("escpos");
escpos.Network = require("escpos-network");

function getDevice() {
  try {
    return new escpos.Network(process.env.PRINTER_IP);
  } catch (err) {
    console.error("❌ Erreur réseau :", err);
    return null;
  }
}



function printTest(callback) {
  const device = getDevice();
  if (!device) return callback(new Error("Aucune imprimante détectée"));

  const printer = new escpos.Printer(device);
  device.open(function (error) {
    if (error) return callback(error);

    printer
      .align("ct")
      .style("b")
      .size(2, 2)
      .text("TICKET DE TEST")
      .size(1, 1)
      .text(new Date().toLocaleString("fr-FR"))
      .text("------------------------")
      .text("Connexion réussie 🎉")
      .cut()
      .close();

    callback(null);
  });
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

// Fonction d'impression ultra-compacte pour cuisine
function printTicket(data, callback) {
  const device = getDevice();
  if (!device) return callback(new Error("Aucune imprimante détectée"));

  const printer = new escpos.Printer(device);
  device.open(function (error) {
    if (error) return callback(error);

    // Header minimal
    printer
      .align("ct")
      .style("b")
      .size(2, 1)
      .text(`TABLE ${removeAccents(data.table || "?")}`)
      .size(1, 1)
      .style("normal")
      .text(`${removeAccents(data.commandeId || "-")} | ${removeAccents(data.timestamp || new Date().toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' }))}`)
      .text("------------------------")
      .align("lt");

    // Produits compacts
    data.produits.forEach((item) => {
      // Nom du produit avec quantité
      const productLine = `${item.quantite}x ${removeAccents(item.nom)}`;
      const productLines = wrapText(productLine, 32);
      
      printer.style("b");
      productLines.forEach(line => {
        printer.text(line);
      });
      
      // Instructions spéciales en plus petit
      if (item.specialInstructions) {
        const instruction = `Com : ${removeAccents(item.specialInstructions)}`;
        const instructionLines = wrapText(instruction, 32); // Ajusté pour la nouvelle taille
        
        printer
          .style("normal")
          .size(1, 0); // Un peu plus grand que très petit
        
        instructionLines.forEach(line => {
          printer.text(`  ${line}`);
        });
        
        printer.size(1, 1); // Retour à la taille normale
      }
    });

    // Footer minimal
    printer
      .text("------------------------")
      .cut();

    setTimeout(() => {
      printer.close();
      callback(null);
    }, 500);
  });
}


module.exports = {
  printTicket,
  printTest,
  getStatus
};