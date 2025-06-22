FROM node:18-alpine

# Créer le répertoire de l'app
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier le code source
COPY . .

# Exposer le port du serveur
EXPOSE 3001

# Lancer l'application
CMD ["node", "server.js"]
