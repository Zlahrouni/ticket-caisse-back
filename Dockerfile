FROM node:18-slim

# Installer les dépendances nécessaires à node-usb
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libusb-1.0-0-dev \
    libudev-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
