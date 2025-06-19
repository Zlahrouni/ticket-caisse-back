require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const os = require("os");
const escpos = require("escpos");
escpos.USB = require("escpos-usb");


const { printTest, getStatus, printTicket } = require("./printer");

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.PRINT_API_KEY;

// Middleware de base
app.use(cors());
app.use(bodyParser.json());

// 🔓 AUTHENTIFICATION OPTIONNELLE (pour debug local)
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

// 🧪 Route impression test SIMPLIFIÉE
app.get("/print-test", (req, res) => {
  console.log("🧪 Demande d'impression test reçue");
  
  printTest((err) => {
    if (err) {
      console.error("❌ Erreur impression test:", err.message);
      return res.status(500).json({ 
        error: "Erreur impression test", 
        details: err.message,
        timestamp: new Date().toISOString()
      });
    }
    
    console.log("✅ Impression test réussie");
    res.json({ 
      success: true, 
      message: "Impression test réussie",
      timestamp: new Date().toISOString()
    });
  });
});

// 🧾 Impression ticket SIMPLIFIÉE
app.post("/print-ticket", (req, res) => {
  console.log("🎫 Demande d'impression ticket reçue:", req.body);
  
  const data = req.body;
  
  // Validation basique
  if (!data.produits || !Array.isArray(data.produits)) {
    return res.status(400).json({ 
      error: "Produits manquants ou invalides",
      received: data
    });
  }

  printTicket(data, (err) => {
    if (err) {
      console.error("❌ Erreur impression ticket:", err.message);
      return res.status(500).json({ 
        error: "Erreur impression ticket", 
        details: err.message,
        timestamp: new Date().toISOString()
      });
    }
    
    console.log("✅ Ticket imprimé avec succès");
    res.json({ 
      success: true, 
      message: "Ticket imprimé avec succès",
      timestamp: new Date().toISOString()
    });
  });
});

// 📡 Statut imprimante SIMPLIFIÉ
app.get("/status", (req, res) => {
  console.log("📡 Vérification statut imprimante");
  
  getStatus((err, status) => {
    if (err) {
      console.error("❌ Erreur statut:", err.message);
      return res.status(500).json({ 
        error: "Erreur statut",
        details: err.message
      });
    }
    
    console.log("📊 Statut imprimante:", status);
    res.json({
      ...status,
      timestamp: new Date().toISOString(),
      printerIP: process.env.PRINTER_IP,
      useNetwork: process.env.USE_NETWORK === "true"
    });
  });
});

// 🩺 Santé (toujours accessible)
app.get("/health", (req, res) => {
  console.log("🩺 Health check");
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(),
    authMode: SKIP_AUTH ? "DISABLED" : "ENABLED",
    printerConfig: {
      useNetwork: process.env.USE_NETWORK === "true",
      printerIP: process.env.PRINTER_IP || "Non configuré"
    }
  });
});

app.get("/findusbprinter", (req, res) => {
  try {
    const devices = escpos.USB.findPrinter();

    if (!devices.length) {
      return res.status(404).json({ message: "Aucune imprimante USB détectée" });
    }

    const formattedDevices = devices.map((device, i) => {
      try {
        // Extraire les informations depuis le deviceDescriptor
        const descriptor = device.deviceDescriptor || {};
        return {
          index: i,
          vendorId: descriptor.idVendor,
          productId: descriptor.idProduct,
          manufacturer: device.deviceDescriptor?.iManufacturer,
          product: device.deviceDescriptor?.iProduct
        };
      } catch (err) {
        return { index: i, info: "Impossible de lire les détails du périphérique" };
      }
    });

    res.json({
      success: true,
      count: devices.length,
      printers: formattedDevices
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la détection USB", details: err.message });
  }
});


// 🖥️ Informations système
app.get("/system-info", (req, res) => {
  const interfaces = os.networkInterfaces();
  let localIp = null;

  for (const name of Object.keys(interfaces)) {
    for (const netInfo of interfaces[name]) {
      if (netInfo.family === "IPv4" && !netInfo.internal) {
        localIp = netInfo.address;
        break;
      }
    }
  }

  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    localIp: localIp,
    timestamp: new Date().toISOString()
  });
});

// 🚀 Démarrer le serveur sur TOUTES les interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🖨️ Microservice impression actif sur 0.0.0.0:${PORT}`);
  console.log(`🔐 Authentification: ${SKIP_AUTH ? '❌ DÉSACTIVÉE' : '✅ ACTIVÉE'}`);
  console.log(`🖨️ Mode imprimante: ${process.env.USE_NETWORK === "true" ? 'RÉSEAU' : 'USB'}`);
  if (process.env.USE_NETWORK === "true") {
    console.log(`📍 IP imprimante: ${process.env.PRINTER_IP}`);
  }
  console.log(`🌐 Testez avec: http://localhost:${PORT}/health`);
});