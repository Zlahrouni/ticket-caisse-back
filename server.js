require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const escpos = require("escpos");
escpos.Network = require("escpos-network");

const { printTest, printTicket } = require("./printer");

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.PRINT_API_KEY;

app.use(cors());
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

// 🧪 Test d'impression
app.get("/print-test", (req, res) => {
  const ip = req.query.ip;
  if (!ip) {
    return res.status(400).json({ error: "IP de l'imprimante manquante (paramètre ?ip=...)" });
  }

  printTest(ip, (err) => {
    if (err) {
      return res.status(500).json({ error: "Erreur impression test", details: err.message });
    }
    res.json({ success: true, message: "Impression test réussie" });
  });
});

// 🧾 Impression ticket
app.post("/print-ticket", (req, res) => {
  const ip = req.body.ip;
  const data = req.body;

  if (!ip) {
    return res.status(400).json({ error: "IP de l'imprimante manquante (champ 'ip')" });
  }
  if (!data.produits || !Array.isArray(data.produits)) {
    return res.status(400).json({ error: "Produits manquants ou invalides", received: data });
  }

  printTicket(ip, data, (err) => {
    if (err) {
      return res.status(500).json({ error: "Erreur impression ticket", details: err.message });
    }
    res.json({ success: true, message: "Ticket imprimé avec succès" });
  });
});

// 🩺 Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 🚀 Lancement du serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🖨️ Serveur prêt sur le port ${PORT}`);
});
