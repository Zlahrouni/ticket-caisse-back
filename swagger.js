const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: 'API d\'Impression de Tickets',
    description: `
      API pour l'impression de tickets de commande et d'annulation sur imprimantes thermiques ESC/POS.
      
      **Fonctionnalités principales:**
      - Impression de tickets de commande (sur place et à emporter)
      - Impression de tickets d'annulation
      - Support des menus composés avec personnalisations
      - Gestion des portions (entière, demi, pièce)
      - Instructions spéciales et notes
      - Mode logging pour tests sans imprimante
      - Aperçu des tickets avant impression
      
      **Workflow:**
      1. Utilisez \`/print-preview\` pour visualiser le ticket
      2. Utilisez \`/print-ticket-log\` pour tester sans imprimante
      3. Utilisez \`/print-ticket\` pour l'impression réelle
    `,
    version: '2.0.0',
  },
  host: 'localhost:3001',
  basePath: '/',
  schemes: ['http'],
  consumes: ['application/json'],
  produces: ['application/json'],
  tags: [
    {
      name: 'Impression',
      description: 'Endpoints d\'impression sur imprimante physique'
    },
    {
      name: 'Test & Logging',
      description: 'Endpoints de test et logging sans imprimante'
    },
    {
      name: 'Logs',
      description: 'Consultation des logs d\'impression'
    },
    {
      name: 'Santé',
      description: 'Vérification de l\'état du serveur'
    }
  ],
  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      name: 'Authorization',
      in: 'header',
      description: 'Bearer token (optionnel si SKIP_AUTH=true)'
    }
  },
  definitions: {
    // ========== NOUVEAU WORKFLOW (produits + composedDetails) ==========
    CommandeNormale: {
      mode: 'sur_place',
      table: '12',
      numeroClient: null,
      commandeId: 'CMD-12345',
      timestamp: '2025-12-07T14:30:00Z',
      noteCommande: 'Merci de préparer rapidement',
      produits: [
        {
          quantite: 2,
          nom: 'Burger Classique',
          specialInstructions: 'Sans oignons',
          isComposed: false,
          portionInfo: null
        },
        {
          quantite: 1,
          nom: 'Menu Complet',
          isComposed: true,
          composedDetails: [
            {
              stepLabel: 'Choix de viande',
              items: [
                { nom: 'Bœuf', note: 'Bien cuit' }
              ]
            },
            {
              stepLabel: 'Sauce',
              items: [
                { nom: 'Mayo', note: '' },
                { nom: 'Ketchup', note: '' }
              ]
            }
          ]
        },
        {
          quantite: 1,
          nom: 'Houmous',
          portionInfo: 'demi'
        }
      ]
    },
    CommandeEmporter: {
      mode: 'emporter',
      table: null,
      numeroClient: '42',
      commandeId: 'CMD-67890',
      timestamp: '2025-12-07T14:35:00Z',
      noteCommande: null,
      produits: [
        {
          quantite: 3,
          nom: 'Frites',
          specialInstructions: 'Bien croustillantes'
        }
      ]
    },
    CommandeAnnulation: {
      mode: 'sur_place',
      table: '12',
      numeroClient: null,
      commandeId: 'CMD-12345',
      timestamp: '2025-12-07T14:30:00Z',
      cancellationReason: 'Client parti sans attendre',
      noteCommande: 'Commande urgente',
      ip: '192.168.1.100',
      produits: [
        {
          quantite: 2,
          nom: 'Burger Classique',
          isComposed: true,
          composedDetails: [
            {
              stepLabel: 'Viande',
              items: [{ nom: 'Bœuf', note: 'Saignant' }]
            }
          ]
        }
      ]
    },
    CancelTicket: {
      mode: 'sur_place',
      table: '12',
      numeroClient: null,
      commandeId: 'CMD-12345',
      timestamp: '2025-12-07T14:30:00Z',
      cancellationReason: 'Client parti sans attendre',
      noteCommande: 'Commande urgente',
      ip: '192.168.1.100',
      produits: [
        {
          quantite: 2,
          nom: 'Burger Classique',
          isComposed: false
        }
      ]
    },
    // ========== ANCIEN WORKFLOW (items + menuConfig) ==========
    OldWorkflowTicket: {
      ip: '192.168.1.102',
      restaurantId: 'talya-bercy',
      serviceType: 'DINING',
      orderNumber: 'CMD_4',
      timestamp: 1765060580866,
      items: [
        {
          name: 'Muhammara',
          quantity: 1,
          price: 7.5
        },
        {
          name: 'Menu Talya gourmand',
          quantity: 1,
          price: 13.5,
          menuConfig: {
            'sandwich-step': ['Chawarma bœuf'],
            'beignets-step': ['Beignet épinard', 'Beignet mixte'],
            'boisson-step': ['Fanta (33cl)'],
            'dessert-step': ['Baklawa (feuilletés aux fruits secs)']
          }
        }
      ],
      tableInfo: {
        tableId: '62N41RSuQb7HBPoJx0eI',
        tableNumber: 'RDC 2',
        zoneName: 'RDC'
      }
    },
    // ========== RÉPONSES ==========
    SuccessResponse: {
      success: true,
      message: 'Ticket imprimé avec succès'
    },
    PreviewResponse: {
      success: true,
      message: 'Aperçu du ticket généré',
      preview: '================================\n        TABLE (12)        \n================================\n...',
      analysis: {
        table: '12',
        commandeId: 'CMD-12345',
        itemCount: 3,
        features: {
          composedMenus: true,
          portions: true,
          specialInstructions: true
        },
        products: [
          {
            index: 1,
            name: 'Burger Classique',
            quantity: 2,
            isComposed: false,
            hasPortionInfo: false,
            hasInstructions: true,
            composedSteps: 0
          }
        ]
      }
    },
    LogResponse: {
      success: true,
      message: 'Ticket enregistré dans les logs (mode test)',
      logFile: {
        filename: '2025-12-07_14-30-00_CMD-12345.log',
        path: '/app/logs/2025-12-07_14-30-00_CMD-12345.log',
        size: 2048,
        created: '2025-12-07T14:30:00Z'
      },
      preview: '================================\n...',
      analysis: {
        table: '12',
        commandeId: 'CMD-12345',
        itemCount: 3,
        features: {
          composedMenus: true,
          portions: false,
          specialInstructions: true,
          globalNote: true
        }
      }
    },
    LogListResponse: {
      success: true,
      count: 15,
      logDirectory: '/app/logs',
      files: [
        {
          filename: '2025-12-07_14-30-00_CMD-12345.log',
          size: 2048,
          created: '2025-12-07T14:30:00Z',
          modified: '2025-12-07T14:30:00Z',
          type: 'normal'
        },
        {
          filename: 'CANCEL_2025-12-07_14-25-00_CMD-67890.log',
          size: 1856,
          created: '2025-12-07T14:25:00Z',
          modified: '2025-12-07T14:25:00Z',
          type: 'annulation'
        }
      ]
    },
    ErrorResponse: {
      error: 'Description de l\'erreur',
      details: 'Détails techniques supplémentaires'
    }
  }
};

const outputFile = './swagger-output.json';
const endpointsFiles = ['./server.js'];

swaggerAutogen(outputFile, endpointsFiles, doc).then(() => {
  console.log('✅ Documentation Swagger générée avec succès');
  console.log(`📄 Fichier créé: ${outputFile}`);
});