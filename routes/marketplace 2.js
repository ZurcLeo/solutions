'use strict';

const express    = require('express');
const router     = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const ctrl       = require('../controllers/marketplaceController');
const barterController = require('../controllers/barterController');
const { upload } = require('../middlewares/upload.cjs');
const { requireLevel } = require('../middlewares/requireLevel');
const { validateSellerCapability } = require('../middlewares/validateSellerCapability');
const { requireSellerTeamAccess } = require('../middlewares/requireSellerTeamAccess');
const { logger } = require('../logger');

const ROUTE_NAME = 'marketplace';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { method: req.method, path: req.path, sreContext: req.sreContext || 'no-context' });
  next();
});

// ──────────────────────────────────────────────────────
// Taxonomia / Categorias
// GET    /api/marketplace/categories          — listar todas as categorias ativas
// ──────────────────────────────────────────────────────

router.get('/categories',               verifyToken, readLimit,  ctrl.getCategories);

// ──────────────────────────────────────────────────────
// Seller Profiles
// POST   /api/marketplace/seller              — criar perfil de vendedor
// GET    /api/marketplace/sellers             — listar vendedores ativos (público)
// GET    /api/marketplace/seller/me           — meu perfil (inclui pending/suspended)
// GET    /api/marketplace/sellers/:id         — perfil público de um vendedor
// PATCH  /api/marketplace/seller             — editar próprio perfil
// PATCH  /api/marketplace/sellers/:id/approve — aprovar/rejeitar loja (admin)
// DELETE /api/marketplace/seller/location    — remover coords (LGPD Art. 18, direito ao esquecimento)
// ──────────────────────────────────────────────────────

router.post('/seller',                  verifyToken, writeLimit, ctrl.createSellerProfile);
router.get('/sellers',                  verifyToken, readLimit,  ctrl.listSellers);
router.get('/seller/me',                verifyToken, readLimit,  ctrl.getMySellerProfile);
router.get('/seller/my-businesses',     verifyToken, readLimit,  ctrl.getMyBusinesses);
router.get('/seller/products',          verifyToken, readLimit,  ctrl.listMyProducts);
router.get('/sellers/:id',              verifyToken, readLimit,  ctrl.getSellerProfile);
router.patch('/seller',                 verifyToken, writeLimit, ctrl.updateSellerProfile);
router.patch('/sellers/:id/approve',    verifyToken, writeLimit, ctrl.approveSellerProfile);
router.delete('/seller/location',       verifyToken, writeLimit, ctrl.removeSellerLocation);
// Gestão de loja — desativação / reativação / exclusão
router.patch('/seller/deactivate',      verifyToken, writeLimit, ctrl.deactivateStore);
router.patch('/seller/reactivate',      verifyToken, writeLimit, ctrl.reactivateStore);
router.delete('/seller',                verifyToken, writeLimit, ctrl.deleteStore);
// Admin — backfill de coordenadas de vendedores sem lat/lng
router.post('/seller/backfill-coords',  verifyToken, writeLimit, ctrl.backfillSellerCoords);

// ──────────────────────────────────────────────────────
// Shipping Config — Envio Nacional (SHIP-001)
// GET    /api/marketplace/sellers/:id/shipping-config  — ler config de envio
// PATCH  /api/marketplace/sellers/:id/shipping-config  — atualizar config de envio
// ──────────────────────────────────────────────────────

router.get('/sellers/:id/shipping-config',   verifyToken, readLimit,  ctrl.getShippingConfig);
router.patch('/sellers/:id/shipping-config', verifyToken, writeLimit, ctrl.updateShippingConfig);

// ──────────────────────────────────────────────────────
// Google Places — vinculação seller ↔ estabelecimento
// GET    /api/marketplace/seller/google-place        — sugestão auto-detect
// GET    /api/marketplace/seller/google-place-search — busca manual (?q=)
// POST   /api/marketplace/seller/google-place        — confirmar vinculação
// DELETE /api/marketplace/seller/google-place        — remover vinculação
// POST   /api/marketplace/seller/google-place-sync   — admin: batch sync
// ──────────────────────────────────────────────────────

router.get('/seller/google-place',        verifyToken, readLimit,  ctrl.getGooglePlaceSuggestion);
router.get('/seller/google-place-search', verifyToken, readLimit,  ctrl.searchGooglePlaces);
router.post('/seller/google-place',       verifyToken, writeLimit, ctrl.confirmGooglePlaceLink);
router.delete('/seller/google-place',     verifyToken, writeLimit, ctrl.unlinkGooglePlace);
router.post('/seller/google-place-sync',  verifyToken, writeLimit, ctrl.batchSyncGooglePlaces);

// ──────────────────────────────────────────────────────
// IconChat — Auto-Provisionamento [ICON-SELFPROV-001]
// GET    /api/marketplace/seller/iconchat               — status da integração
// POST   /api/marketplace/seller/iconchat/provision      — provisionar integração
// PATCH  /api/marketplace/seller/iconchat/toggle         — ativar/desativar
// POST   /api/marketplace/seller/iconchat/rotate-secret  — rotacionar HMAC secret
// ──────────────────────────────────────────────────────

const iconChatProvisioningCtrl = require('../controllers/iconChatProvisioningController');

router.get('/seller/iconchat',               verifyToken, requireSellerTeamAccess('manager'), readLimit,  iconChatProvisioningCtrl.getStatus);
router.post('/seller/iconchat/provision',     verifyToken, requireSellerTeamAccess('owner'),   writeLimit, iconChatProvisioningCtrl.provision);
router.patch('/seller/iconchat/toggle',       verifyToken, requireSellerTeamAccess('owner'),   writeLimit, iconChatProvisioningCtrl.toggle);
router.post('/seller/iconchat/rotate-secret', verifyToken, requireSellerTeamAccess('owner'),   writeLimit, iconChatProvisioningCtrl.rotateSecret);

// ──────────────────────────────────────────────────────
// Shipping Quote & Tracking (SHIP-003)
// POST   /api/marketplace/shipping/quote                — cotação de frete nacional
// GET    /api/marketplace/shipping/:orderId/tracking     — rastreio de envio
// ──────────────────────────────────────────────────────

router.post('/shipping/quote',                verifyToken, readLimit,  ctrl.getShippingQuote);
router.get('/shipping/:orderId/tracking',     verifyToken, readLimit,  ctrl.getShippingTracking);

// ──────────────────────────────────────────────────────
// GTIN / EAN / UPC — Lookup de código de barras (ELOS-BE-004)
// GET    /api/marketplace/gtin/:code       — busca cascata (catálogo → OSCBR)
// ──────────────────────────────────────────────────────

const gtinCtrl = require('../controllers/gtinController');

router.get('/gtin/:code', verifyToken, readLimit, gtinCtrl.lookupGtin);

// ──────────────────────────────────────────────────────
// Produtos
// POST   /api/marketplace/products         — criar produto (requer seller ativo)
// GET    /api/marketplace/products         — listar produtos (?seller_id, ?category, ?min_price, ?max_price)
// PATCH  /api/marketplace/products/:id     — editar produto
// DELETE /api/marketplace/products/:id     — desativar produto (soft delete)
// ──────────────────────────────────────────────────────

router.post('/products',       verifyToken, writeLimit, ctrl.createProduct);
router.get('/products',        verifyToken, readLimit,  ctrl.listProducts);
router.get('/products/:id',    verifyToken, readLimit,  ctrl.getProduct);
router.patch('/products/:id',  verifyToken, writeLimit, ctrl.updateProduct);
router.delete('/products/:id', verifyToken, writeLimit, ctrl.deactivateProduct);
// PATCH /api/marketplace/products/:productId/toggle-active — pausar/reativar produto (sem excluir)
router.patch('/products/:productId/toggle-active', verifyToken, writeLimit, ctrl.toggleProductActive);

// ──────────────────────────────────────────────────────
// Product Variants (ELOS-BE-014)
// GET    /api/marketplace/products/:productId/variants              — listar variantes
// POST   /api/marketplace/products/:productId/variants              — criar variante
// POST   /api/marketplace/products/:productId/variants/matrix       — gerar matriz em lote
// PUT    /api/marketplace/products/:productId/variants/:variantId   — atualizar
// DELETE /api/marketplace/products/:productId/variants/:variantId   — remover
// PATCH  /api/marketplace/products/:productId/variants/:variantId/toggle — toggle disponibilidade
// PATCH  /api/marketplace/products/:productId/variants/bulk         — atualização em lote
// ──────────────────────────────────────────────────────

router.get('/products/:productId/variants',                        verifyToken, readLimit,  ctrl.listVariants);
router.post('/products/:productId/variants',                       verifyToken, writeLimit, ctrl.createVariant);
router.post('/products/:productId/variants/matrix',                verifyToken, writeLimit, ctrl.generateVariantMatrix);
router.patch('/products/:productId/variants/bulk',                 verifyToken, writeLimit, ctrl.bulkUpdateVariants);
router.put('/products/:productId/variants/:variantId',             verifyToken, writeLimit, ctrl.updateVariant);
router.delete('/products/:productId/variants/:variantId',          verifyToken, writeLimit, ctrl.deleteVariant);
router.patch('/products/:productId/variants/:variantId/toggle',    verifyToken, writeLimit, ctrl.toggleVariantAvailability);

// ──────────────────────────────────────────────────────
// Pedidos
// POST   /api/marketplace/orders                   — criar pedido
// GET    /api/marketplace/orders                   — listar pedidos (?role=buyer|seller)
// PATCH  /api/marketplace/orders/:id/status        — atualizar status (seller)
// POST   /api/marketplace/orders/:id/dispute       — contestar pedido (buyer)
// ──────────────────────────────────────────────────────

// Métodos de pagamento disponíveis por seller (CMP-014 — tier-gated)
router.get('/seller/:sellerId/payment-methods', verifyToken, readLimit, ctrl.getSellerPaymentMethods);

router.post('/orders',                   verifyToken, writeLimit, ctrl.createOrder);
router.get('/orders/active',             verifyToken, readLimit,  ctrl.getActiveOrders);
router.get('/orders/cancellations/monthly', verifyToken, readLimit, ctrl.getSellerMonthlyCancellations);  // FLOW-AUDIT W3.4 — must be before :id
router.get('/orders',                    verifyToken, readLimit,  ctrl.listOrders);
router.get('/orders/:id',               verifyToken, readLimit,  ctrl.getOrder);
router.patch('/orders/:id/status',       verifyToken, writeLimit, ctrl.updateOrderStatus);
router.post('/orders/:id/cancel',        verifyToken, writeLimit, ctrl.cancelOrderBySeller);  // FLOW-AUDIT W3.4 / DSH-016
router.post('/orders/:id/renew-pix',              verifyToken, writeLimit, ctrl.renewOrderPix);
router.post('/orders/:id/confirm-payment-offline', verifyToken, writeLimit, ctrl.confirmPaymentOffline);
router.post('/orders/:id/dispute',                 verifyToken, writeLimit, ctrl.createOrderDispute);

// ──────────────────────────────────────────────────────
// Clientes por Pedido (Order Clients)
// GET    /api/marketplace/order-clients                     — listar clientes únicos
// GET    /api/marketplace/order-clients/:buyerId/orders     — pedidos de um buyer
// ──────────────────────────────────────────────────────

router.get('/order-clients',                       verifyToken, readLimit, ctrl.listOrderClients);
router.get('/order-clients/:buyerId/orders',       verifyToken, readLimit, ctrl.listOrdersByBuyer);

// ──────────────────────────────────────────────────────
// Metas Comunitárias
// POST   /api/marketplace/goals           — criar meta
// GET    /api/marketplace/goals           — listar metas (?category, ?caixinha_id, ?status)
// POST   /api/marketplace/goals/:id/contribute — contribuir para meta
// ──────────────────────────────────────────────────────

router.post('/goals',                    verifyToken, writeLimit, ctrl.createCommunityGoal);
router.get('/goals',                     verifyToken, readLimit,  ctrl.listCommunityGoals);
router.post('/goals/:id/contribute',     verifyToken, writeLimit, ctrl.contributeToGoal);

// ──────────────────────────────────────────────────────
// Barter — Loja Social (BARTER-001)
// POST   /api/marketplace/products/:id/trade-request  — solicitar troca (50 EloCoins, Nível 3+)
// GET    /api/marketplace/trade-requests              — listar trocas (?role=requester|owner|both)
// PATCH  /api/marketplace/trade-requests/:id/accept  — aceitar solicitação (dono do produto)
// PATCH  /api/marketplace/trade-requests/:id/reject  — rejeitar solicitação (dono do produto)
// PATCH  /api/marketplace/trade-requests/:id/cancel  — cancelar solicitação (solicitante)
// ──────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────
// Avaliações de Loja (MKTPLACE-REVIEW-001)
// POST   /api/marketplace/reviews                    — submeter avaliação (comprador, pedido concluído)
// GET    /api/marketplace/sellers/:sellerId/reviews  — listar avaliações públicas de uma loja
// GET    /api/marketplace/orders/:orderId/review     — verificar se pedido já foi avaliado
// PATCH  /api/marketplace/reviews/:reviewId/reply   — vendedor responde a uma avaliação
// ──────────────────────────────────────────────────────

router.post('/reviews',                          verifyToken, writeLimit, ctrl.createReview);
router.get('/sellers/:sellerId/reviews',         verifyToken, readLimit,  ctrl.getSellerReviews);
router.get('/orders/:orderId/review',            verifyToken, readLimit,  ctrl.getOrderReview);
router.patch('/reviews/:reviewId/reply',         verifyToken, writeLimit, ctrl.replyToReview);

router.post('/products/:id/trade-request', verifyToken, requireLevel(3), writeLimit, barterController.createTradeRequest);
router.get('/trade-requests',              verifyToken, readLimit,        barterController.listTradeRequests);
router.patch('/trade-requests/:id/accept', verifyToken, writeLimit,       barterController.acceptTradeRequest);
router.patch('/trade-requests/:id/reject', verifyToken, writeLimit,       barterController.rejectTradeRequest);
router.patch('/trade-requests/:id/cancel', verifyToken, writeLimit,       barterController.cancelTradeRequest);

// ──────────────────────────────────────────────────────
// Seller Subtypes — lookup público
// GET  /api/marketplace/seller-subtypes          — todos os subtipos
// GET  /api/marketplace/seller-subtypes?category=alimentacao — filtrado
// ──────────────────────────────────────────────────────

router.get('/seller-subtypes', verifyToken, readLimit, ctrl.listSellerSubtypes);

// ──────────────────────────────────────────────────────
// Menu Categories (alimentação)
// POST   /api/marketplace/menu/categories           — criar categoria (seller owner)
// GET    /api/marketplace/menu/:sellerId/categories — listar categorias (público)
// GET    /api/marketplace/menu/:sellerId            — cardápio completo via RPC
// PATCH  /api/marketplace/menu/categories/:id       — editar categoria (seller owner)
// ──────────────────────────────────────────────────────

router.post('/menu/categories',                  verifyToken, validateSellerCapability('has_menu_categories'), writeLimit, ctrl.createMenuCategory);
router.get('/menu/:sellerId/categories',          verifyToken, readLimit,  ctrl.listMenuCategories);
router.get('/menu/:sellerId',                     verifyToken, readLimit,  ctrl.getSellerMenu);
router.patch('/menu/categories/:id',              verifyToken, validateSellerCapability('has_menu_categories'), writeLimit, ctrl.updateMenuCategory);

// ──────────────────────────────────────────────────────
// Product Modifiers (customizações de prato)
// POST   /api/marketplace/products/:productId/modifiers           — adicionar modifier
// GET    /api/marketplace/products/:productId/modifiers           — listar modifiers
// PATCH  /api/marketplace/products/:productId/modifiers/:modifierId — editar
// DELETE /api/marketplace/products/:productId/modifiers/:modifierId — remover (soft)
// ──────────────────────────────────────────────────────

router.post('/products/:productId/modifiers',                      verifyToken, validateSellerCapability('has_modifiers'), writeLimit, ctrl.addProductModifier);
router.get('/products/:productId/modifiers',                       verifyToken, readLimit,  ctrl.listProductModifiers);
router.patch('/products/:productId/modifiers/:modifierId',         verifyToken, validateSellerCapability('has_modifiers'), writeLimit, ctrl.updateProductModifier);
router.delete('/products/:productId/modifiers/:modifierId',        verifyToken, validateSellerCapability('has_modifiers'), writeLimit, ctrl.removeProductModifier);

// ──────────────────────────────────────────────────────
// Upload de imagens
// POST   /api/marketplace/upload/product-image  — foto de produto (retorna URL)
// POST   /api/marketplace/upload/seller-cover   — capa da loja (atualiza cover_image_url)
// ──────────────────────────────────────────────────────

router.post('/upload/product-image', verifyToken, writeLimit, upload.single('image'), ctrl.uploadProductImage);
router.post('/upload/seller-cover',  verifyToken, writeLimit, upload.single('image'), ctrl.uploadSellerCover);

// ──────────────────────────────────────────────────────
// Seller Team Members [TEAM-001]
// GET    /api/marketplace/seller/team              — lista membros
// POST   /api/marketplace/seller/team/invite       — convida membro
// POST   /api/marketplace/seller/team/accept/:sellerId — aceita convite
// GET    /api/marketplace/seller/team/:userId/assignments — atribuições do membro
// DELETE /api/marketplace/seller/team/:userId      — remove membro
// PATCH  /api/marketplace/seller/team/:userId/role — altera role/permissões
// ──────────────────────────────────────────────────────

const teamCtrl = require('../controllers/sellerTeamController');

router.get('/seller/team/my-invites',          verifyToken, readLimit,  teamCtrl.getMyPendingInvites);
router.get('/seller/team',                    verifyToken, requireSellerTeamAccess('employee'), readLimit,  teamCtrl.listTeamMembers);
router.get('/seller/team/:userId/assignments', verifyToken, requireSellerTeamAccess('manager'),  readLimit,  teamCtrl.getTeamMemberAssignments);
router.post('/seller/team/invite',            verifyToken, requireSellerTeamAccess('manager'),  writeLimit, teamCtrl.inviteTeamMember);
router.post('/seller/team/accept/:sellerId',  verifyToken, writeLimit, teamCtrl.acceptInvite);
router.post('/seller/team/decline/:sellerId', verifyToken, writeLimit, teamCtrl.declineInvite);
router.post('/seller/team/leave',             verifyToken, requireSellerTeamAccess('employee'), writeLimit, teamCtrl.leaveTeam);
router.delete('/seller/team/:userId',         verifyToken, requireSellerTeamAccess('owner'),    writeLimit, teamCtrl.removeTeamMember);
router.patch('/seller/team/:userId/role',     verifyToken, requireSellerTeamAccess('manager'),  writeLimit, teamCtrl.updateTeamMemberRole);

// ──────────────────────────────────────────────────────
// Business Invites [BIZ-004]
// POST   /api/marketplace/seller/:sellerId/invite         — convida para equipe (existing ou novo user)
// GET    /api/marketplace/seller/:sellerId/invites        — lista convites pendentes
// DELETE /api/marketplace/seller/:sellerId/invites/:inviteId — cancela convite
// POST   /api/marketplace/business-invite/:token/accept   — aceita convite via token
// GET    /api/marketplace/business-invite/:token          — info pública do convite (landing page)
// ──────────────────────────────────────────────────────

const bizInviteCtrl = require('../controllers/businessInviteController');

router.post('/seller/:sellerId/invite',                verifyToken, requireSellerTeamAccess('manager'), writeLimit, bizInviteCtrl.createInvite);
router.get('/seller/:sellerId/invites',                verifyToken, requireSellerTeamAccess('manager'), readLimit,  bizInviteCtrl.listInvites);
router.delete('/seller/:sellerId/invites/:inviteId',   verifyToken, requireSellerTeamAccess('manager'), writeLimit, bizInviteCtrl.cancelInvite);
router.post('/business-invite/:token/accept',          verifyToken, writeLimit, bizInviteCtrl.acceptInvite);
router.get('/business-invite/:token',                  readLimit,  bizInviteCtrl.getInviteInfo);  // público (landing page)

// ──────────────────────────────────────────────────────
// Business Trust [BIZ-005]
// GET    /api/marketplace/seller/:sellerId/trust — trust score do negócio
// ──────────────────────────────────────────────────────

const businessTrustService = require('../services/businessTrustService');

router.get('/seller/:sellerId/trust', verifyToken, readLimit, async (req, res) => {
  try {
    const trust = await businessTrustService.getBusinessTrust(req.params.sellerId);
    res.json({ success: true, data: trust });
  } catch (err) {
    logger.error(`[marketplace] getBusinessTrust: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────��────────────────────────────
// Financeiro (Seller Financial Panel)
// GET    /api/marketplace/seller/financials — métricas financeiras do vendedor
// ──────────────────────────────────────────────────────

router.get('/seller/financials', verifyToken, readLimit, ctrl.getSellerFinancials);

module.exports = router;
