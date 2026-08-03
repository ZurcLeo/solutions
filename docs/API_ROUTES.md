# ElosCloud API — Mapa Completo de Rotas

> Gerado em: 2026-06-21T07:29:25.488Z

## Resumo

| Métrica | Valor |
|---------|-------|
| Total de rotas | 559 |
| Arquivos de rota | 45 |
| Com Swagger | 159 (28.4%) |
| Sem Swagger | 400 (71.6%) |

### Autenticação

| Nível | Qtd |
|-------|-----|
| Public | 47 |
| Optional | 2 |
| JWT | 457 |
| RBAC | 53 |

## Rotas por Módulo

### `/api/rbac`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/rbac/initialize` | JWT | ✅ | `roleController.initializeSystem` | - |
| `POST` | `/api/rbac/migrate-admin-users` | JWT | ✅ | `userRoleController.migrateAdminUsers` | - |
| `GET` | `/api/rbac/roles` | RBAC | ✅ | `` | - |
| `GET` | `/api/rbac/roles/:id` | RBAC | ✅ | `` | - |
| `POST` | `/api/rbac/roles` | JWT | ✅ | `validate(rbacSchemas.roleCreate` | - |
| `PUT` | `/api/rbac/roles/:id` | JWT | ✅ | `validate(rbacSchemas.roleUpdate` | - |
| `DELETE` | `/api/rbac/roles/:id` | JWT | ✅ | `roleController.deleteRole` | - |
| `GET` | `/api/rbac/roles/:id/permissions` | RBAC | ✅ | `` | - |
| `POST` | `/api/rbac/roles/:roleId/permissions/:permissionId` | JWT | ✅ | `roleController.assignPermissionToRole` | - |
| `DELETE` | `/api/rbac/roles/:roleId/permissions/:permissionId` | JWT | ✅ | `roleController.removePermissionFromRole` | - |
| `GET` | `/api/rbac/permissions` | RBAC | ✅ | `` | - |
| `GET` | `/api/rbac/permissions/:id` | RBAC | ✅ | `` | - |
| `POST` | `/api/rbac/permissions` | JWT | ✅ | `validate(rbacSchemas.permissionCreate` | - |
| `PUT` | `/api/rbac/permissions/:id` | JWT | ✅ | `validate(rbacSchemas.permissionUpdate` | - |
| `DELETE` | `/api/rbac/permissions/:id` | JWT | ✅ | `permissionController.deletePermission` | - |
| `GET` | `/api/rbac/users/:userId/roles` | RBAC | ✅ | `` | - |
| `POST` | `/api/rbac/users/:userId/roles` | RBAC | ✅ | `` | - |
| `DELETE` | `/api/rbac/users/:userId/roles/:userRoleId` | RBAC | ✅ | `` | - |
| `POST` | `/api/rbac/users/:userId/roles/:userRoleId/validate` | RBAC | ✅ | `` | - |
| `POST` | `/api/rbac/users/:userId/roles/:userRoleId/reject` | RBAC | ✅ | `` | - |
| `POST` | `/api/rbac/validations/bank/:userId/init` | JWT | ✅ | `userRoleController.initBankValidation` | - |
| `POST` | `/api/rbac/validations/bank/:userId/confirm` | JWT | ✅ | `userRoleController.confirmBankValidation` | - |
| `GET` | `/api/rbac/check-permission/:permissionName` | JWT | ✅ | `` | - |
| `GET` | `/api/rbac/check-role/:roleName` | JWT | ❌ | `` | - |

### `/api/health`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/health/public` | Public | ❌ | `` | - |
| `GET` | `/api/health/service/:serviceName` | Optional | ❌ | `` | - |
| `GET` | `/api/health/dependencies` | Optional | ❌ | `` | - |
| `GET` | `/api/health/full` | JWT | ❌ | `` | - |
| `GET` | `/api/health/` | Public | ❌ | `` | - |

### `/api/auth`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/auth/send-email-verification` | JWT | ✅ | `authController.sendEmailVerificationOtp` | - |
| `POST` | `/api/auth/confirm-email-verification` | JWT | ❌ | `authController.confirmEmailVerification` | - |
| `POST` | `/api/auth/verify-otp-challenge` | Public | ❌ | `authController.verifyOtpChallenge` | - |
| `PATCH` | `/api/auth/verify-phone` | JWT | ❌ | `authController.verifyPhone` | - |
| `POST` | `/api/auth/recovery/lookup-phone` | Public | ❌ | `authController.lookupPhoneForRecovery` | - |
| `POST` | `/api/auth/recovery/verify-phone` | Public | ❌ | `authController.verifyPhoneForRecovery` | - |
| `POST` | `/api/auth/recovery/change-email` | Public | ❌ | `authController.recoveryChangeEmail` | - |
| `POST` | `/api/auth/recovery/send-reset` | Public | ❌ | `authController.recoverySendReset` | - |
| `GET` | `/api/auth/sessions` | JWT | ❌ | `authController.getSessions` | - |
| `DELETE` | `/api/auth/sessions/:sessionId` | JWT | ❌ | `authController.revokeSession` | - |
| `DELETE` | `/api/auth/sessions` | JWT | ❌ | `authController.revokeAllSessions` | - |
| `POST` | `/api/auth/mfa/setup-totp` | JWT | ❌ | `authController.setupTOTP` | - |
| `POST` | `/api/auth/mfa/confirm-totp` | JWT | ❌ | `authController.confirmTOTP` | - |
| `POST` | `/api/auth/mfa/enable-sms` | JWT | ❌ | `authController.enableSMS2FA` | - |
| `POST` | `/api/auth/mfa/disable` | JWT | ❌ | `authController.disableMFA` | - |
| `GET` | `/api/auth/mfa/status` | JWT | ❌ | `authController.getMFAStatus` | - |
| `POST` | `/api/auth/mfa/verify` | Public | ❌ | `authController.verifyMFA` | - |
| `POST` | `/api/auth/mfa/send-sms` | Public | ❌ | `authController.sendMFASms` | - |
| `GET` | `/api/auth/session` | JWT | ✅ | `authController.checkSession` | - |
| `POST` | `/api/auth/register` | Public | ✅ | `` | - |
| `POST` | `/api/auth/logout` | JWT | ✅ | `` | - |
| `POST` | `/api/auth/refresh-token` | JWT | ✅ | `validate(authSchemas.schemas['refresh-token']` | - |
| `POST` | `/api/auth/refresh` | JWT | ❌ | `validate(authSchemas.schemas['refresh-token']` | - |
| `POST` | `/api/auth/token` | Public | ✅ | `validate(authSchemas.schemas['token']` | - |
| `GET` | `/api/auth/me` | JWT | ✅ | `authController.getCurrentUser` | - |

### `/api/admin`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `PATCH` | `/api/admin/users/:userId/moderation` | RBAC | ❌ | `` | - |
| `POST` | `/api/admin/stickers` | RBAC | ❌ | `stickerAdminController.createSticker` | - |
| `PATCH` | `/api/admin/stickers/:id` | RBAC | ❌ | `stickerAdminController.updateSticker` | - |
| `PATCH` | `/api/admin/stickers/:id/toggle` | RBAC | ❌ | `stickerAdminController.toggleSticker` | - |
| `POST` | `/api/admin/stickers/:id/image` | RBAC | ❌ | `upload.single('image'` | - |
| `GET` | `/api/admin/selos` | RBAC | ❌ | `seloAdminController.getAllSelos` | - |
| `POST` | `/api/admin/selos` | RBAC | ❌ | `seloAdminController.createSelo` | - |
| `PATCH` | `/api/admin/selos/:id` | RBAC | ❌ | `seloAdminController.updateSelo` | - |
| `PATCH` | `/api/admin/selos/:id/toggle` | RBAC | ❌ | `seloAdminController.toggleSelo` | - |
| `POST` | `/api/admin/selos/:id/image` | RBAC | ❌ | `upload.single('image'` | - |
| `GET` | `/api/admin/selos/:id/holders` | RBAC | ❌ | `seloAdminController.getSeloHolders` | - |
| `POST` | `/api/admin/users/:userId/selos` | RBAC | ❌ | `seloAdminController.grantSeloToUser` | - |
| `DELETE` | `/api/admin/users/:userId/selos/:seloId` | RBAC | ❌ | `seloAdminController.revokeSeloFromUser` | - |
| `GET` | `/api/admin/kyc/pending` | RBAC | ❌ | `kycAdminController.getPending` | - |
| `POST` | `/api/admin/kyc/:verificationId/approve` | RBAC | ❌ | `kycAdminController.approve` | - |
| `POST` | `/api/admin/kyc/:verificationId/reject` | RBAC | ❌ | `kycAdminController.reject` | - |
| `GET` | `/api/admin/kyc/:verificationId/media` | RBAC | ❌ | `kycAdminController.getMedia` | - |
| `GET` | `/api/admin/endorsements/search` | RBAC | ❌ | `endorsementAdminController.searchUsers` | - |
| `GET` | `/api/admin/endorsements` | RBAC | ❌ | `endorsementAdminController.listEndorsements` | - |
| `POST` | `/api/admin/endorsements` | RBAC | ❌ | `endorsementAdminController.endorseUser` | - |
| `POST` | `/api/admin/endorsements/:id/revoke` | RBAC | ❌ | `endorsementAdminController.revokeEndorsement` | - |

### `/api/support`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `PUT` | `/api/support/csat/:token` | JWT | ❌ | `supportController.submitCsat` | - |
| `GET` | `/api/support/articles` | JWT | ❌ | `knowledgeController.listArticles` | - |
| `GET` | `/api/support/articles/:articleId` | JWT | ❌ | `knowledgeController.getArticle` | - |
| `POST` | `/api/support/tickets` | JWT | ✅ | `supportController.createTicket` | - |
| `POST` | `/api/support/escalate` | JWT | ✅ | `supportController.requestEscalation` | - |
| `GET` | `/api/support/tickets/my` | JWT | ✅ | `supportController.getUserTickets` | - |
| `GET` | `/api/support/tickets/pending` | RBAC | ✅ | `` | - |
| `GET` | `/api/support/tickets/category/:category` | RBAC | ✅ | `` | - |
| `GET` | `/api/support/tickets/analytics` | RBAC | ✅ | `` | - |
| `GET` | `/api/support/tickets/sla-at-risk` | RBAC | ✅ | `` | - |
| `GET` | `/api/support/tickets/assigned` | RBAC | ✅ | `` | - |
| `GET` | `/api/support/tickets/all` | RBAC | ✅ | `` | - |
| `POST` | `/api/support/tickets/:ticketId/assign` | RBAC | ✅ | `` | - |
| `POST` | `/api/support/tickets/:ticketId/action` | RBAC | ❌ | `` | - |
| `POST` | `/api/support/tickets/:ticketId/resolve` | RBAC | ✅ | `` | - |
| `PUT` | `/api/support/tickets/:ticketId/status` | RBAC | ✅ | `` | - |
| `GET` | `/api/support/tickets/:ticketId/conversation` | RBAC | ✅ | `` | - |
| `GET` | `/api/support/tickets/:ticketId` | JWT | ✅ | `supportController.getTicketDetails` | - |
| `PUT` | `/api/support/tickets/:ticketId` | RBAC | ✅ | `` | - |
| `DELETE` | `/api/support/tickets/links/:linkId` | RBAC | ❌ | `` | - |
| `POST` | `/api/support/tickets/:ticketId/links` | RBAC | ❌ | `` | - |
| `GET` | `/api/support/tickets/:ticketId/links` | RBAC | ❌ | `` | - |
| `GET` | `/api/support/macros` | RBAC | ❌ | `` | - |
| `POST` | `/api/support/macros` | RBAC | ❌ | `` | - |
| `GET` | `/api/support/articles/admin/all` | RBAC | ❌ | `` | - |
| `POST` | `/api/support/articles` | RBAC | ❌ | `` | - |
| `PUT` | `/api/support/articles/:articleId` | RBAC | ❌ | `` | - |
| `DELETE` | `/api/support/articles/:articleId` | RBAC | ❌ | `` | - |

### `/api/interests`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/interests/categories` | Public | ❌ | `interestsController.getAvailableInterests` | - |
| `GET` | `/api/interests/:userId` | JWT | ❌ | `interestsController.getUserInterests` | - |
| `PUT` | `/api/interests/:userId` | JWT | ❌ | `interestsController.updateUserInterests` | - |
| `POST` | `/api/interests/admin/categories` | JWT | ❌ | `interestsController.createCategory` | - |
| `PUT` | `/api/interests/admin/categories/:categoryId` | JWT | ❌ | `interestsController.updateCategory` | - |
| `POST` | `/api/interests/admin/interests` | JWT | ❌ | `interestsController.createInterest` | - |
| `PUT` | `/api/interests/admin/interests/:interestId` | JWT | ❌ | `interestsController.updateInterest` | - |
| `GET` | `/api/interests/admin/stats` | JWT | ❌ | `interestsController.getInterestStats` | - |

### `/api/caixinha`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/caixinha/user/:userId` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/` | JWT | ✅ | `` | - |
| `GET` | `/api/caixinha/id/:caixinhaId` | JWT | ✅ | `` | - |
| `PUT` | `/api/caixinha/:caixinhaId` | JWT | ✅ | `` | - |
| `DELETE` | `/api/caixinha/:caixinhaId` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/membros` | JWT | ✅ | `` | - |
| `GET` | `/api/caixinha/membros/:caixinhaId` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/membros/:caixinhaId/convite` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/membros/:caixinhaId/convite-email` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/membros/convite/:caixinhaInviteId/aceitar` | JWT | ✅ | `caixinhaInviteController.acceptInvite` | - |
| `POST` | `/api/caixinha/membros/convite/:caixinhaInviteId/cancelar` | JWT | ✅ | `caixinhaInviteController.cancelInvite` | - |
| `POST` | `/api/caixinha/membros/convite/:caixinhaInviteId/reenviar` | JWT | ✅ | `caixinhaInviteController.resendInvite` | - |
| `POST` | `/api/caixinha/membros/convite/:caixinhaInviteId/rejeitar` | JWT | ✅ | `caixinhaInviteController.rejectInvite` | - |
| `GET` | `/api/caixinha/membros/:userId/convites-recebidos` | JWT | ✅ | `caixinhaInviteController.getReceivedInvites` | - |
| `GET` | `/api/caixinha/membros/:userId/convites-enviados` | JWT | ✅ | `caixinhaInviteController.getSentInvites` | - |
| `POST` | `/api/caixinha/membros/:caixinhaId/convite/:caixinhaInviteId/reenviar-email` | JWT | ✅ | `caixinhaInviteController.resendInviteEmail` | - |
| `GET` | `/api/caixinha/membros/:caixinhaId/convites` | JWT | ❌ | `caixinhaInviteController.getCaixinhaInvites` | - |
| `GET` | `/api/caixinha/membros/convite/:caixinhaInviteId` | JWT | ❌ | `caixinhaInviteController.getInviteDetails` | - |
| `GET` | `/api/caixinha/:caixinhaId/disputes` | JWT | ✅ | `` | - |
| `GET` | `/api/caixinha/:caixinhaId/disputes/:disputeId` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/disputes` | JWT | ✅ | `validate(disputeSchema.create` | - |
| `POST` | `/api/caixinha/:caixinhaId/disputes/:disputeId/vote` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/disputes/:disputeId/cancel` | JWT | ✅ | `validate(disputeSchema.cancel` | - |
| `GET` | `/api/caixinha/:caixinhaId/disputes/check` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/disputes/rule-change` | JWT | ✅ | `` | - |
| `GET` | `/api/caixinha/:caixinhaId/emprestimos` | JWT | ✅ | `` | - |
| `GET` | `/api/caixinha/:caixinhaId/emprestimos/:loanId` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/emprestimos` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/emprestimos/:loanId/pagamento` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/emprestimos/:loanId/aprovar` | JWT | ✅ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/emprestimos/:loanId/rejeitar` | JWT | ✅ | `` | - |
| `GET` | `/api/caixinha/:caixinhaId/me` | JWT | ❌ | `` | - |
| `POST` | `/api/caixinha/:caixinhaId/contribuicao` | JWT | ❌ | `` | - |
| `GET` | `/api/caixinha/:caixinhaId/contribuicoes` | JWT | ❌ | `` | - |
| `GET` | `/api/caixinha/:caixinhaId/relatorio` | JWT | ❌ | `` | - |

### `/api/rifas`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/rifas/:caixinhaId/all` | JWT | ✅ | `rifaController.listarRifas` | - |
| `GET` | `/api/rifas/:caixinhaId/:rifaId` | JWT | ✅ | `rifaController.obterRifa` | - |
| `POST` | `/api/rifas/:caixinhaId` | JWT | ✅ | `validate(rifaSchema.create` | - |
| `PUT` | `/api/rifas/:caixinhaId/update/:rifaId` | JWT | ✅ | `validate(rifaSchema.update` | - |
| `POST` | `/api/rifas/:caixinhaId/cancel/:rifaId` | JWT | ✅ | `rifaController.cancelarRifa` | - |
| `POST` | `/api/rifas/:caixinhaId/bilhetes/:rifaId` | JWT | ✅ | `validate(rifaSchema.venderBilhete` | - |
| `POST` | `/api/rifas/:caixinhaId/sorteio/:rifaId` | JWT | ❌ | `validate(rifaSchema.realizarSorteio` | - |
| `GET` | `/api/rifas/:caixinhaId/autenticidade/:rifaId` | JWT | ✅ | `rifaController.verificarAutenticidade` | - |
| `GET` | `/api/rifas/:caixinhaId/rifas/:rifaId/comprovante` | JWT | ✅ | `rifaController.gerarComprovante` | - |
| `POST` | `/api/rifas/:caixinhaId/amigo-secreto/:rifaId/sortear` | JWT | ❌ | `validate(rifaSchema.sortearPares` | - |
| `GET` | `/api/rifas/:caixinhaId/amigo-secreto/:rifaId/meu-par` | JWT | ❌ | `rifaController.revelarMeuPar` | - |
| `GET` | `/api/rifas/:caixinhaId/amigo-secreto/:rifaId/pares` | JWT | ❌ | `rifaController.listarTodosPares` | - |
| `POST` | `/api/rifas/:caixinhaId/votar/:rifaId` | JWT | ❌ | `validate(rifaSchema.votar` | - |
| `GET` | `/api/rifas/:caixinhaId/votos/:rifaId` | JWT | ❌ | `rifaController.listarVotos` | - |
| `POST` | `/api/rifas/:caixinhaId/resolver/:rifaId` | JWT | ❌ | `validate(rifaSchema.resolver` | - |

### `/api/banking`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/banking/:caixinhaId` | JWT | ❌ | `bankAccountController.getAllBankAccounts` | - |
| `GET` | `/api/banking/:caixinhaId/history` | JWT | ❌ | `bankAccountController.getAccountHistory` | - |
| `POST` | `/api/banking/:caixinhaId/register` | JWT | ❌ | `bankAccountController.createBankAccount` | - |
| `POST` | `/api/banking/:accountId/generate-validation-pix` | JWT | ❌ | `bankAccountController.generateValidationPix` | - |
| `POST` | `/api/banking/:accountId/validate` | JWT | ❌ | `bankAccountController.validateAccount` | - |
| `PUT` | `/api/banking/:id` | JWT | ❌ | `bankAccountController.updateBankAccount` | - |
| `PATCH` | `/api/banking/:id/activate` | JWT | ❌ | `bankAccountController.activateBankAccount` | - |
| `DELETE` | `/api/banking/:id` | JWT | ❌ | `bankAccountController.deleteBankAccount` | - |
| `POST` | `/api/banking/payments/card` | JWT | ❌ | `` | - |
| `POST` | `/api/banking/payments/pix` | JWT | ❌ | `paymentsController.createPixPayment` | - |
| `GET` | `/api/banking/payments/status/:paymentId` | JWT | ❌ | `paymentsController.checkPixPaymentStatus` | - |
| `POST` | `/api/banking/transfer` | JWT | ❌ | `` | - |
| `POST` | `/api/banking/transaction/:id/cancel` | JWT | ❌ | `bankAccountController.cancelTransaction` | - |
| `POST` | `/api/banking/:caixinhaId/apply-user-method/:methodId` | JWT | ❌ | `userPaymentMethodController.applyToCaixinha` | - |

### `/api/email`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/email/` | JWT | ✅ | `validate(emailSchema.send` | - |
| `GET` | `/api/email/user` | JWT | ✅ | `emailController.getUserEmails` | - |
| `GET` | `/api/email/reference/:referenceType/:referenceId` | JWT | ✅ | `emailController.getEmailsByReference` | - |
| `POST` | `/api/email/:emailId/resend` | JWT | ✅ | `validate(emailSchema.resend` | - |
| `GET` | `/api/email/admin/status/:status` | JWT | ✅ | `emailController.getEmailsByStatus` | - |
| `POST` | `/api/email/send-invite` | JWT | ❌ | `` | - |

### `/api/groups`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/groups/` | JWT | ✅ | `groupsCaixinhaController.getGroups` | - |
| `GET` | `/api/groups/:id` | JWT | ✅ | `groupsCaixinhaController.getGroupById` | - |
| `POST` | `/api/groups/` | JWT | ✅ | `groupsCaixinhaController.createGroup` | - |
| `PUT` | `/api/groups/:id` | JWT | ✅ | `groupsCaixinhaController.updateGroup` | - |
| `DELETE` | `/api/groups/:id` | JWT | ✅ | `groupsCaixinhaController.deleteGroup` | - |

### `/api/invite`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/invite/check/:inviteId` | Public | ✅ | `inviteController.checkInvite` | - |
| `POST` | `/api/invite/validate/:inviteId` | Public | ✅ | `inviteController.validateInvite` | - |
| `POST` | `/api/invite/invalidate` | JWT | ✅ | `` | - |
| `POST` | `/api/invite/generate` | JWT | ✅ | `` | - |
| `GET` | `/api/invite/sent/:userId` | JWT | ✅ | `` | - |
| `POST` | `/api/invite/resend/:inviteId` | JWT | ✅ | `inviteController.resendInvite` | - |
| `GET` | `/api/invite/view/:inviteId` | Public | ✅ | `` | - |
| `PUT` | `/api/invite/cancel/:inviteId` | JWT | ✅ | `` | - |

### `/api/ja3`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/ja3/calculate` | Public | ✅ | `` | - |

### `/api/messages`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/messages/conversations` | JWT | ✅ | `MessageController.getUserConversations` | - |
| `GET` | `/api/messages/conversations/:conversationId` | JWT | ✅ | `MessageController.getConversationMessages` | - |
| `GET` | `/api/messages/user/:otherUserId` | JWT | ✅ | `MessageController.getMessagesBetweenUsers` | - |
| `POST` | `/api/messages/` | JWT | ✅ | `MessageController.createMessage` | - |
| `POST` | `/api/messages/conversations/:conversationId/read` | JWT | ✅ | `MessageController.markMessagesAsRead` | - |
| `PATCH` | `/api/messages/conversations/:conversationId/messages/:messageId/status` | JWT | ✅ | `MessageController.updateMessageStatus` | - |
| `DELETE` | `/api/messages/conversations/:conversationId/messages/:messageId` | JWT | ✅ | `MessageController.deleteMessage` | - |
| `GET` | `/api/messages/stats` | JWT | ✅ | `MessageController.getUserMessageStats` | - |
| `POST` | `/api/messages/migrate` | JWT | ✅ | `MessageController.migrateUserMessages` | - |
| `POST` | `/api/messages/conversations/:conversationId/attachments` | JWT | ✅ | `attachmentUpload.array('files', 5` | - |
| `POST` | `/api/messages/:messageId/reactions` | JWT | ✅ | `MessageController.toggleReaction` | - |

### `/api/notifications`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/notifications/vapid-key` | Public | ✅ | `notificationsController.getVapidPublicKey` | - |
| `POST` | `/api/notifications/` | JWT | ✅ | `` | - |
| `GET` | `/api/notifications/:userId` | JWT | ✅ | `notificationsController.getUserNotifications` | - |
| `POST` | `/api/notifications/:userId/markAsRead/:notificationId` | JWT | ✅ | `` | - |
| `POST` | `/api/notifications/:userId/clearAll` | JWT | ✅ | `notificationsController.clearAllNotifications` | - |
| `POST` | `/api/notifications/push-token` | JWT | ✅ | `notificationsController.savePushToken` | - |
| `DELETE` | `/api/notifications/push-token` | JWT | ❌ | `notificationsController.removePushToken` | - |

### `/api/payments`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/payments/all-purchases` | JWT | ✅ | `paymentsController.getAllPurchases` | - |
| `POST` | `/api/payments/create-payment-intent` | JWT | ✅ | `` | - |
| `GET` | `/api/payments/session-status` | JWT | ✅ | `paymentsController.sessionStatus` | - |
| `GET` | `/api/payments/purchases` | JWT | ✅ | `paymentsController.getPurchases` | - |
| `POST` | `/api/payments/pix` | JWT | ✅ | `` | - |
| `GET` | `/api/payments/status/:paymentId` | JWT | ❌ | `paymentsController.checkPixPaymentStatus` | - |
| `POST` | `/api/payments/card` | JWT | ❌ | `` | - |
| `POST` | `/api/payments/asaas/subconta/create/:caixinhaId` | JWT | ❌ | `asaasController.createSubconta` | - |
| `POST` | `/api/payments/asaas/pix` | JWT | ❌ | `` | - |
| `GET` | `/api/payments/asaas/status/:paymentId` | JWT | ❌ | `asaasController.getPaymentStatus` | - |
| `GET` | `/api/payments/asaas/balance/:caixinhaId` | JWT | ❌ | `asaasController.getMemberBalance` | - |
| `GET` | `/api/payments/asaas/withdrawal/estimate` | JWT | ❌ | `asaasController.withdrawalEstimate` | - |
| `POST` | `/api/payments/asaas/withdrawal/request` | JWT | ❌ | `` | - |
| `POST` | `/api/payments/asaas/withdrawal/approve` | JWT | ❌ | `` | - |

### `/api/posts`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/posts/` | JWT | ✅ | `postController.getFeed` | - |
| `GET` | `/api/posts/generosity-ranking` | JWT | ✅ | `postController.getGenerosityRanking` | - |
| `GET` | `/api/posts/trending-hashtags` | JWT | ❌ | `postController.getTrendingHashtags` | - |
| `GET` | `/api/posts/:id` | JWT | ✅ | `postController.getPostById` | - |
| `POST` | `/api/posts/` | JWT | ✅ | `postController.createPost` | - |
| `PUT` | `/api/posts/:id` | JWT | ✅ | `postController.updatePost` | - |
| `DELETE` | `/api/posts/:id` | JWT | ✅ | `postController.deletePost` | - |
| `POST` | `/api/posts/:postId/comments` | JWT | ✅ | `postController.addComment` | - |
| `POST` | `/api/posts/:postId/comments/:commentId/like` | JWT | ✅ | `postController.toggleCommentLike` | - |
| `POST` | `/api/posts/:postId/comments/:commentId/reply` | JWT | ✅ | `postController.replyToComment` | - |
| `POST` | `/api/posts/:postId/reactions` | JWT | ✅ | `postController.addReaction` | - |
| `POST` | `/api/posts/:postId/gifts` | JWT | ✅ | `postController.addGift` | - |
| `POST` | `/api/posts/:postId/report` | JWT | ✅ | `reportController.reportPost` | - |
| `POST` | `/api/posts/:postId/comments/:commentId/report` | JWT | ✅ | `reportController.reportComment` | - |

### `/api/stickers`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/stickers/` | JWT | ❌ | `stickerController.listStickers` | - |

### `/api/recaptcha`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/recaptcha/verify` | Public | ✅ | `recaptchaController.verifyRecaptcha` | - |

### `/api/users`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/users/` | JWT | ✅ | `userController.getUsers` | - |
| `GET` | `/api/users/search` | JWT | ✅ | `userController.searchUsers` | - |
| `GET` | `/api/users/check-username/:username` | Public | ✅ | `userController.checkUsername` | - |
| `GET` | `/api/users/generate-fallback` | Public | ✅ | `userController.generateFallbackUsername` | - |
| `GET` | `/api/users/preferences` | JWT | ❌ | `userController.getNotificationPreferences` | - |
| `PUT` | `/api/users/preferences` | JWT | ❌ | `userController.updateNotificationPreferences` | - |
| `GET` | `/api/users/payment-methods` | JWT | ❌ | `userPaymentMethodController.list` | - |
| `POST` | `/api/users/payment-methods` | JWT | ❌ | `userPaymentMethodController.register` | - |
| `POST` | `/api/users/payment-methods/:id/validate` | JWT | ❌ | `userPaymentMethodController.validate` | - |
| `DELETE` | `/api/users/payment-methods/:id` | JWT | ❌ | `userPaymentMethodController.remove` | - |
| `GET` | `/api/users/:userId` | JWT | ❌ | `` | - |
| `POST` | `/api/users/add-user` | JWT | ✅ | `` | - |
| `PUT` | `/api/users/update-user/:userId` | JWT | ✅ | `` | - |
| `POST` | `/api/users/upload-profile-picture/:userId` | JWT | ✅ | `upload.single('profilePicture'` | - |
| `DELETE` | `/api/users/delete-user/:id` | JWT | ✅ | `userController.deleteUser` | - |
| `POST` | `/api/users/suggest-username` | Public | ✅ | `userController.suggestUsername` | - |
| `PATCH` | `/api/users/username` | JWT | ❌ | `userController.updateUsername` | - |
| `PUT` | `/api/users/recovery-email` | JWT | ❌ | `userController.setRecoveryEmail` | - |
| `POST` | `/api/users/recovery-email/verify` | JWT | ❌ | `userController.verifyRecoveryEmail` | - |
| `POST` | `/api/users/recovery-email/resend` | JWT | ❌ | `userController.resendRecoveryEmailOTP` | - |
| `DELETE` | `/api/users/recovery-email` | JWT | ❌ | `userController.removeRecoveryEmail` | - |
| `GET` | `/api/users/me/wishlist` | JWT | ❌ | `userController.getMyWishlist` | - |
| `PATCH` | `/api/users/me/wishlist` | JWT | ❌ | `userController.updateMyWishlist` | - |
| `POST` | `/api/users/:userId/report` | JWT | ❌ | `reportController.reportUser` | - |

### `/api/video-sdk`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/video-sdk/get-token` | Public | ✅ | `videoSdkController.getToken` | - |
| `POST` | `/api/video-sdk/start-session` | JWT | ✅ | `videoSdkController.startSession` | - |
| `POST` | `/api/video-sdk/end-session` | JWT | ✅ | `videoSdkController.endSession` | - |
| `POST` | `/api/video-sdk/create-meeting` | JWT | ✅ | `videoSdkController.createMeeting` | - |
| `POST` | `/api/video-sdk/validate-meeting/:meetingId` | JWT | ✅ | `videoSdkController.validateMeeting` | - |

### `/api/connections`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/connections/requests/:senderId/accept` | JWT | ❌ | `connectionsController.acceptConnectionRequest` | - |
| `DELETE` | `/api/connections/:userId/friends/:friendId` | JWT | ✅ | `connectionsController.deleteFriendConnection` | - |

### `/api/webhook`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/webhook/mercadopago` | Public | ❌ | `webhookController.mercadoPagoWebhook` | - |
| `POST` | `/api/webhook/asaas` | Public | ❌ | `webhookController.asaasWebhook` | - |
| `POST` | `/api/webhook/resend-inbound` | Public | ❌ | `webhookController.resendInboundWebhook` | - |
| `POST` | `/api/webhook/stripe` | Public | ❌ | `webhookController.stripeWebhook` | - |
| `POST` | `/api/webhook/test` | Public | ❌ | `` | - |

### `/api/security`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/security/dashboard` | JWT | ✅ | `SecurityController.getDashboard` | - |
| `GET` | `/api/security/user/:userId/risk` | JWT | ✅ | `SecurityController.getUserRiskAnalysis` | - |
| `GET` | `/api/security/events` | JWT | ❌ | `` | - |
| `GET` | `/api/security/report` | JWT | ✅ | `` | - |
| `POST` | `/api/security/action` | RBAC | ✅ | `` | - |
| `POST` | `/api/security/otp/generate` | JWT | ✅ | `OtpController.generate` | - |
| `POST` | `/api/security/otp/validate` | JWT | ✅ | `OtpController.validate` | - |

### `/api/qa`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/qa/health` | Public | ❌ | `qaCtrl.getHealth` | - |
| `POST` | `/api/qa/run` | Public | ❌ | `qaCtrl.triggerRun` | - |
| `GET` | `/api/qa/stream` | Public | ❌ | `qaCtrl.streamRun` | - |
| `POST` | `/api/qa/seed-balance` | Public | ❌ | `qaCtrl.seedBalance` | - |
| `GET` | `/api/qa/runs` | Public | ❌ | `qaCtrl.listRuns` | - |
| `GET` | `/api/qa/runs/:runId` | Public | ❌ | `qaCtrl.getRunDetail` | - |
| `GET` | `/api/qa/autofix-pending` | Public | ❌ | `qaCtrl.listAutofixPending` | - |
| `POST` | `/api/qa/autofix-pending/:id/approve` | Public | ❌ | `qaCtrl.approveAutofix` | - |
| `POST` | `/api/qa/autofix-pending/:id/refine` | Public | ❌ | `qaCtrl.refineAutofix` | - |
| `DELETE` | `/api/qa/autofix-pending/:id` | Public | ❌ | `qaCtrl.rejectAutofix` | - |
| `GET` | `/api/qa/interpretation-cache/:hash` | Public | ❌ | `qaCtrl.getInterpretationCache` | - |
| `GET` | `/api/qa/notification-jobs` | Public | ❌ | `qaCtrl.listNotificationJobs` | - |
| `GET` | `/api/qa/sre-logs` | Public | ❌ | `qaCtrl.getSreLogs` | - |

### `/api/sre`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/sre/recent-events` | JWT | ✅ | `` | - |
| `POST` | `/api/sre/feedback` | JWT | ❌ | `` | - |

### `/api/gamification`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/gamification/me` | JWT | ❌ | `ctrl.getMe` | - |
| `GET` | `/api/gamification/tasks` | JWT | ❌ | `ctrl.getTasks` | - |
| `GET` | `/api/gamification/leaderboard` | JWT | ❌ | `ctrl.getLeaderboard` | - |
| `GET` | `/api/gamification/catalog/levels` | Public | ❌ | `ctrl.getLevels` | - |
| `GET` | `/api/gamification/catalog/selos` | Public | ❌ | `ctrl.getSelos` | - |
| `POST` | `/api/gamification/task/complete` | JWT | ❌ | `ctrl.completeTask` | - |
| `POST` | `/api/gamification/task/progress` | JWT | ❌ | `ctrl.incrementProgress` | - |
| `POST` | `/api/gamification/streak` | JWT | ❌ | `ctrl.updateStreak` | - |
| `POST` | `/api/gamification/selo/pin` | JWT | ❌ | `ctrl.togglePin` | - |
| `POST` | `/api/gamification/event` | JWT | ❌ | `ctrl.triggerEvent` | - |
| `POST` | `/api/gamification/spend` | JWT | ❌ | `ctrl.spendCoins` | - |
| `POST` | `/api/gamification/boost-content` | JWT | ❌ | `ctrl.boostContent` | - |
| `POST` | `/api/gamification/tip` | JWT | ❌ | `ctrl.tipUser` | - |
| `POST` | `/api/gamification/recalculate` | JWT | ❌ | `ctrl.recalculate` | - |
| `POST` | `/api/gamification/boost` | JWT | ❌ | `ctrl.grantBoost` | - |

### `/api/elcoin`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/elcoin/statement` | JWT | ❌ | `ctrl.getStatement` | - |

### `/api/kyc`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/kyc/status` | JWT | ❌ | `kycController.getStatus` | - |
| `POST` | `/api/kyc/verify-cpf` | JWT | ❌ | `` | - |
| `POST` | `/api/kyc/upload-media` | JWT | ❌ | `` | - |
| `POST` | `/api/kyc/verify-document` | JWT | ❌ | `` | - |
| `POST` | `/api/kyc/verify-cnpj` | JWT | ❌ | `` | - |

### `/api/contracts`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/contracts/webhook/clicksign` | JWT | ❌ | `ctrl.clicksignWebhook` | - |
| `GET` | `/api/contracts/` | JWT | ❌ | `ctrl.listContracts` | - |
| `POST` | `/api/contracts/generate` | JWT | ❌ | `ctrl.generateContract` | - |
| `GET` | `/api/contracts/:id` | JWT | ❌ | `ctrl.getContract` | - |
| `GET` | `/api/contracts/:id/download-url` | JWT | ❌ | `ctrl.getDownloadUrl` | - |
| `GET` | `/api/contracts/:id/signing-link` | JWT | ❌ | `ctrl.getSigningLink` | - |
| `POST` | `/api/contracts/:id/cancel` | JWT | ❌ | `ctrl.cancelContract` | - |

### `/api/marketplace`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/marketplace/categories` | JWT | ❌ | `ctrl.getCategories` | - |
| `POST` | `/api/marketplace/seller` | JWT | ❌ | `ctrl.createSellerProfile` | - |
| `GET` | `/api/marketplace/sellers` | JWT | ❌ | `ctrl.listSellers` | - |
| `GET` | `/api/marketplace/seller/me` | JWT | ❌ | `ctrl.getMySellerProfile` | - |
| `GET` | `/api/marketplace/seller/products` | JWT | ❌ | `ctrl.listMyProducts` | - |
| `GET` | `/api/marketplace/sellers/:id` | JWT | ❌ | `ctrl.getSellerProfile` | - |
| `PATCH` | `/api/marketplace/seller` | JWT | ❌ | `ctrl.updateSellerProfile` | - |
| `PATCH` | `/api/marketplace/sellers/:id/approve` | JWT | ❌ | `ctrl.approveSellerProfile` | - |
| `DELETE` | `/api/marketplace/seller/location` | JWT | ❌ | `ctrl.removeSellerLocation` | - |
| `PATCH` | `/api/marketplace/seller/deactivate` | JWT | ❌ | `ctrl.deactivateStore` | - |
| `PATCH` | `/api/marketplace/seller/reactivate` | JWT | ❌ | `ctrl.reactivateStore` | - |
| `DELETE` | `/api/marketplace/seller` | JWT | ❌ | `ctrl.deleteStore` | - |
| `POST` | `/api/marketplace/seller/backfill-coords` | JWT | ❌ | `ctrl.backfillSellerCoords` | - |
| `POST` | `/api/marketplace/products` | JWT | ❌ | `ctrl.createProduct` | - |
| `GET` | `/api/marketplace/products` | JWT | ❌ | `ctrl.listProducts` | - |
| `GET` | `/api/marketplace/products/:id` | JWT | ❌ | `ctrl.getProduct` | - |
| `PATCH` | `/api/marketplace/products/:id` | JWT | ❌ | `ctrl.updateProduct` | - |
| `DELETE` | `/api/marketplace/products/:id` | JWT | ❌ | `ctrl.deactivateProduct` | - |
| `POST` | `/api/marketplace/orders` | JWT | ❌ | `ctrl.createOrder` | - |
| `GET` | `/api/marketplace/orders` | JWT | ❌ | `ctrl.listOrders` | - |
| `GET` | `/api/marketplace/orders/:id` | JWT | ❌ | `ctrl.getOrder` | - |
| `PATCH` | `/api/marketplace/orders/:id/status` | JWT | ❌ | `ctrl.updateOrderStatus` | - |
| `POST` | `/api/marketplace/orders/:id/renew-pix` | JWT | ❌ | `ctrl.renewOrderPix` | - |
| `POST` | `/api/marketplace/orders/:id/confirm-payment-offline` | JWT | ❌ | `ctrl.confirmPaymentOffline` | - |
| `POST` | `/api/marketplace/orders/:id/dispute` | JWT | ❌ | `ctrl.createOrderDispute` | - |
| `POST` | `/api/marketplace/goals` | JWT | ❌ | `ctrl.createCommunityGoal` | - |
| `GET` | `/api/marketplace/goals` | JWT | ❌ | `ctrl.listCommunityGoals` | - |
| `POST` | `/api/marketplace/goals/:id/contribute` | JWT | ❌ | `ctrl.contributeToGoal` | - |
| `POST` | `/api/marketplace/reviews` | JWT | ❌ | `ctrl.createReview` | - |
| `GET` | `/api/marketplace/sellers/:sellerId/reviews` | JWT | ❌ | `ctrl.getSellerReviews` | - |
| `GET` | `/api/marketplace/orders/:orderId/review` | JWT | ❌ | `ctrl.getOrderReview` | - |
| `PATCH` | `/api/marketplace/reviews/:reviewId/reply` | JWT | ❌ | `ctrl.replyToReview` | - |
| `POST` | `/api/marketplace/products/:id/trade-request` | JWT | ❌ | `` | - |
| `GET` | `/api/marketplace/trade-requests` | JWT | ❌ | `barterController.listTradeRequests` | - |
| `PATCH` | `/api/marketplace/trade-requests/:id/accept` | JWT | ❌ | `barterController.acceptTradeRequest` | - |
| `PATCH` | `/api/marketplace/trade-requests/:id/reject` | JWT | ❌ | `barterController.rejectTradeRequest` | - |
| `PATCH` | `/api/marketplace/trade-requests/:id/cancel` | JWT | ❌ | `barterController.cancelTradeRequest` | - |
| `GET` | `/api/marketplace/seller-subtypes` | JWT | ❌ | `ctrl.listSellerSubtypes` | - |
| `POST` | `/api/marketplace/menu/categories` | JWT | ❌ | `` | - |
| `GET` | `/api/marketplace/menu/:sellerId/categories` | JWT | ❌ | `ctrl.listMenuCategories` | - |
| `GET` | `/api/marketplace/menu/:sellerId` | JWT | ❌ | `ctrl.getSellerMenu` | - |
| `PATCH` | `/api/marketplace/menu/categories/:id` | JWT | ❌ | `` | - |
| `POST` | `/api/marketplace/products/:productId/modifiers` | JWT | ❌ | `` | - |
| `GET` | `/api/marketplace/products/:productId/modifiers` | JWT | ❌ | `ctrl.listProductModifiers` | - |
| `PATCH` | `/api/marketplace/products/:productId/modifiers/:modifierId` | JWT | ❌ | `` | - |
| `DELETE` | `/api/marketplace/products/:productId/modifiers/:modifierId` | JWT | ❌ | `` | - |
| `POST` | `/api/marketplace/upload/product-image` | JWT | ❌ | `upload.single('image'` | - |
| `POST` | `/api/marketplace/upload/seller-cover` | JWT | ❌ | `upload.single('image'` | - |
| `GET` | `/api/marketplace/seller/team` | JWT | ❌ | `` | - |
| `POST` | `/api/marketplace/seller/team/invite` | JWT | ❌ | `` | - |
| `POST` | `/api/marketplace/seller/team/accept/:sellerId` | JWT | ❌ | `teamCtrl.acceptInvite` | - |
| `DELETE` | `/api/marketplace/seller/team/:userId` | JWT | ❌ | `` | - |
| `PATCH` | `/api/marketplace/seller/team/:userId/role` | JWT | ❌ | `` | - |

### `/api/subscriptions`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/subscriptions/my` | JWT | ❌ | `subscriptionController.getMy` | - |
| `POST` | `/api/subscriptions/seller` | JWT | ❌ | `subscriptionController.createSeller` | - |
| `PATCH` | `/api/subscriptions/billing-mode` | JWT | ❌ | `subscriptionController.updateBillingMode` | - |
| `POST` | `/api/subscriptions/cancel` | JWT | ❌ | `subscriptionController.cancel` | - |

### `/api/kyc-social`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/kyc-social/request` | JWT | ❌ | `ctrl.requestVerification` | - |
| `GET` | `/api/kyc-social/my-request` | JWT | ❌ | `ctrl.getMyRequest` | - |
| `GET` | `/api/kyc-social/requests/:requestId` | JWT | ❌ | `ctrl.getRequestForValidation` | - |
| `POST` | `/api/kyc-social/requests/:requestId/validate` | JWT | ❌ | `ctrl.validateIdentity` | - |
| `POST` | `/api/kyc-social/bonds/:protegeId/break` | JWT | ❌ | `ctrl.breakGodfatherBond` | - |
| `POST` | `/api/kyc-social/admin/cleanup-expired-photos` | JWT | ❌ | `ctrl.cleanupExpiredPhotos` | - |

### `/api/preferences`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/preferences/` | JWT | ❌ | `` | - |
| `PATCH` | `/api/preferences/location` | JWT | ❌ | `` | - |
| `PATCH` | `/api/preferences/address` | JWT | ❌ | `` | - |
| `PATCH` | `/api/preferences/vehicle` | JWT | ❌ | `` | - |
| `PATCH` | `/api/preferences/:category` | JWT | ❌ | `` | - |

### `/api/modules`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/modules/` | JWT | ❌ | `` | - |
| `PATCH` | `/api/modules/:moduleId/preference` | JWT | ❌ | `` | - |
| `GET` | `/api/modules/admin/all` | JWT | ❌ | `` | - |
| `PATCH` | `/api/modules/admin/:moduleId` | JWT | ❌ | `` | - |

### `/api/delivery`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/delivery/service` | JWT | ❌ | `ctrl.createDeliveryService` | - |
| `GET` | `/api/delivery/service/me` | JWT | ❌ | `ctrl.getMyDeliveryService` | - |
| `GET` | `/api/delivery/service/:id` | JWT | ❌ | `ctrl.getDeliveryServiceById` | - |
| `PATCH` | `/api/delivery/service` | JWT | ❌ | `ctrl.updateDeliveryService` | - |
| `POST` | `/api/delivery/session/online` | JWT | ❌ | `ctrl.goOnline` | - |
| `POST` | `/api/delivery/session/offline` | JWT | ❌ | `ctrl.goOffline` | - |
| `GET` | `/api/delivery/eligible` | JWT | ❌ | `ctrl.findEligibleDeliverers` | - |
| `GET` | `/api/delivery/fee` | JWT | ❌ | `ctrl.calculateFee` | - |
| `POST` | `/api/delivery/orders/:orderId/request` | JWT | ❌ | `ctrl.requestDelivery` | - |
| `GET` | `/api/delivery/dashboard` | JWT | ❌ | `ctrl.getDashboard` | - |
| `GET` | `/api/delivery/requests` | JWT | ❌ | `ctrl.listMyDeliveryRequests` | - |
| `GET` | `/api/delivery/requests/:id` | JWT | ❌ | `ctrl.getDeliveryRequest` | - |
| `PATCH` | `/api/delivery/requests/:id/cancel` | JWT | ❌ | `ctrl.cancelDeliveryRequest` | - |
| `POST` | `/api/delivery/requests/:id/accept` | JWT | ❌ | `ctrl.acceptDeliveryRequest` | - |
| `POST` | `/api/delivery/requests/:id/decline` | JWT | ❌ | `ctrl.declineDeliveryRequest` | - |
| `POST` | `/api/delivery/requests/:id/step` | JWT | ❌ | `ctrl.confirmStep` | - |
| `POST` | `/api/delivery/requests/:id/rate` | JWT | ❌ | `ctrl.rateDelivery` | - |
| `GET` | `/api/delivery/ratings/pending` | JWT | ❌ | `ratingCtrl.getPendingRatings` | - |
| `GET` | `/api/delivery/ratings/history` | JWT | ❌ | `ratingCtrl.getRatingHistory` | - |
| `GET` | `/api/delivery/ratings/summary/:userId` | JWT | ❌ | `ratingCtrl.getUserRatingSummary` | - |
| `POST` | `/api/delivery/:requestId/ratings` | JWT | ❌ | `ratingCtrl.submitRating` | - |
| `GET` | `/api/delivery/:requestId/ratings` | JWT | ❌ | `ratingCtrl.getRatingsForRequest` | - |

### `/api/bookings`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `PUT` | `/api/bookings/availability` | JWT | ❌ | `` | - |
| `GET` | `/api/bookings/availability/:serviceId` | JWT | ❌ | `ctrl.getAvailability` | - |
| `GET` | `/api/bookings/available-days` | JWT | ❌ | `ctrl.getActiveDays` | - |
| `GET` | `/api/bookings/slots` | JWT | ❌ | `ctrl.getAvailableSlots` | - |
| `POST` | `/api/bookings/` | JWT | ❌ | `ctrl.createBooking` | - |
| `GET` | `/api/bookings/` | JWT | ❌ | `ctrl.getMyBookings` | - |
| `GET` | `/api/bookings/:id` | JWT | ❌ | `ctrl.getBookingById` | - |
| `PATCH` | `/api/bookings/:id/confirm` | JWT | ❌ | `ctrl.confirmBooking` | - |
| `PATCH` | `/api/bookings/:id/decline` | JWT | ❌ | `ctrl.declineBooking` | - |
| `PATCH` | `/api/bookings/:id/complete` | JWT | ❌ | `ctrl.completeBooking` | - |
| `PATCH` | `/api/bookings/:id/cancel` | JWT | ❌ | `ctrl.cancelBooking` | - |

### `/api/marketplace/imoveis`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/marketplace/imoveis/:propertyId/availability` | Public | ❌ | `ctrl.getAvailability` | - |
| `GET` | `/api/marketplace/imoveis/:propertyId/reviews` | Public | ❌ | `ctrl.getPropertyReviews` | - |
| `POST` | `/api/marketplace/imoveis/stay` | JWT | ❌ | `ctrl.createStay` | - |
| `POST` | `/api/marketplace/imoveis/stay/:id/confirm` | JWT | ❌ | `ctrl.confirmStayPayment` | - |
| `POST` | `/api/marketplace/imoveis/stay/:id/cancel` | JWT | ❌ | `ctrl.cancelStay` | - |
| `POST` | `/api/marketplace/imoveis/stay/:id/review` | JWT | ❌ | `ctrl.submitReview` | - |
| `GET` | `/api/marketplace/imoveis/stays/guest` | JWT | ❌ | `ctrl.getGuestStays` | - |
| `POST` | `/api/marketplace/imoveis/:propertyId/block` | JWT | ❌ | `ctrl.blockDates` | - |
| `DELETE` | `/api/marketplace/imoveis/block/:blockId` | JWT | ❌ | `ctrl.unblockDates` | - |
| `GET` | `/api/marketplace/imoveis/stays/host` | JWT | ❌ | `ctrl.getHostStays` | - |
| `POST` | `/api/marketplace/imoveis/stay/:id/complete` | JWT | ❌ | `ctrl.completeStay` | - |

### `/api/games`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/games/` | JWT | ❌ | `ctrl.createGame` | - |
| `GET` | `/api/games/` | JWT | ❌ | `ctrl.listMyGames` | - |
| `GET` | `/api/games/:gameId` | JWT | ❌ | `ctrl.getGame` | - |
| `PATCH` | `/api/games/:gameId` | JWT | ❌ | `ctrl.updateGame` | - |
| `DELETE` | `/api/games/:gameId` | JWT | ❌ | `ctrl.deleteGame` | - |
| `PATCH` | `/api/games/:gameId/cancel` | JWT | ❌ | `ctrl.cancelGame` | - |
| `PATCH` | `/api/games/:gameId/open` | JWT | ❌ | `ctrl.openGame` | - |
| `PATCH` | `/api/games/:gameId/close` | JWT | ❌ | `ctrl.closeGame` | - |
| `PATCH` | `/api/games/:gameId/associate` | JWT | ❌ | `ctrl.associateCaixinha` | - |
| `GET` | `/api/games/:gameId/items` | JWT | ❌ | `ctrl.listItems` | - |
| `PUT` | `/api/games/:gameId/items` | JWT | ❌ | `ctrl.replaceItems` | - |
| `POST` | `/api/games/:gameId/items/batch` | JWT | ❌ | `ctrl.addItemsBatch` | - |
| `POST` | `/api/games/:gameId/items` | JWT | ❌ | `ctrl.addItem` | - |
| `POST` | `/api/games/:gameId/items/:itemId/claim` | JWT | ❌ | `ctrl.claimItem` | - |
| `DELETE` | `/api/games/:gameId/items/:itemId/claim` | JWT | ❌ | `ctrl.unclaimItem` | - |
| `POST` | `/api/games/:gameId/draw` | JWT | ❌ | `ctrl.drawGame` | - |
| `GET` | `/api/games/:gameId/pair` | JWT | ❌ | `ctrl.revealMyPair` | - |
| `POST` | `/api/games/:gameId/gift-proposal` | JWT | ❌ | `ctrl.proposeGiftValue` | - |
| `PATCH` | `/api/games/:gameId/gift-proposal/:targetUserId` | JWT | ❌ | `ctrl.respondGiftProposal` | - |
| `POST` | `/api/games/:gameId/raffle/initialize` | JWT | ❌ | `ctrl.initializeRaffleTickets` | - |
| `POST` | `/api/games/:gameId/raffle/tickets/buy` | JWT | ❌ | `ctrl.buyRaffleTicket` | - |
| `GET` | `/api/games/:gameId/raffle/tickets/mine` | JWT | ❌ | `ctrl.getMyRaffleTickets` | - |
| `GET` | `/api/games/:gameId/raffle/tickets` | JWT | ❌ | `ctrl.getRaffleTickets` | - |
| `POST` | `/api/games/:gameId/invites` | JWT | ❌ | `ctrl.inviteParticipant` | - |
| `GET` | `/api/games/:gameId/participants` | JWT | ❌ | `ctrl.getParticipants` | - |
| `POST` | `/api/games/:gameId/leave` | JWT | ❌ | `ctrl.leaveGame` | - |
| `DELETE` | `/api/games/:gameId/participants/:targetUserId` | JWT | ❌ | `ctrl.removeParticipant` | - |

### `/api/payments/pix-direto`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/payments/pix-direto/generate` | JWT | ❌ | `pixDiretoController.generatePixData` | - |
| `POST` | `/api/payments/pix-direto/upload/:receiptId` | JWT | ❌ | `receiptUpload.single('receipt'` | - |
| `POST` | `/api/payments/pix-direto/approve/:receiptId` | JWT | ❌ | `pixDiretoController.approveReceipt` | - |
| `POST` | `/api/payments/pix-direto/reject/:receiptId` | JWT | ❌ | `pixDiretoController.rejectReceipt` | - |
| `POST` | `/api/payments/pix-direto/admin/register-cash` | JWT | ❌ | `pixDiretoController.registerCashPayment` | - |
| `GET` | `/api/payments/pix-direto/modes/:caixinhaId` | JWT | ❌ | `pixDiretoController.getPaymentModes` | - |
| `GET` | `/api/payments/pix-direto/receipts/:caixinhaId` | JWT | ❌ | `pixDiretoController.listReceipts` | - |
| `GET` | `/api/payments/pix-direto/my-receipts/:caixinhaId` | JWT | ❌ | `pixDiretoController.getMyReceipts` | - |

### `/api/user`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/user/readiness` | JWT | ❌ | `` | - |
| `GET` | `/api/user/pending-actions` | JWT | ❌ | `` | - |

### `/api/trust`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/trust/passport` | JWT | ❌ | `ctrl.getMyPassport` | - |
| `GET` | `/api/trust/passport/:userId` | JWT | ❌ | `ctrl.getPublicPassport` | - |
| `GET` | `/api/trust/levels` | Public | ❌ | `ctrl.getLevels` | - |
| `POST` | `/api/trust/endorse` | JWT | ❌ | `ctrl.createEndorsement` | - |
| `POST` | `/api/trust/recalculate` | JWT | ❌ | `ctrl.recalculate` | - |
| `POST` | `/api/trust/recalculate-all` | JWT | ❌ | `ctrl.recalculateAll` | - |

### `/api/agora`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/agora/regioes/por-cep` | JWT | ❌ | `ctrl.getRegiaoByCep` | - |
| `GET` | `/api/agora/regioes/por-gps` | JWT | ❌ | `ctrl.getRegiaoByGps` | - |
| `GET` | `/api/agora/regioes` | JWT | ❌ | `ctrl.listRegioes` | - |
| `POST` | `/api/agora/regioes` | JWT | ❌ | `ctrl.createRegiao` | - |
| `PATCH` | `/api/agora/regioes/:id` | JWT | ❌ | `ctrl.updateRegiao` | - |
| `GET` | `/api/agora/regioes/:id/log` | JWT | ❌ | `ctrl.getRegiaoLog` | - |
| `POST` | `/api/agora/classificar` | JWT | ❌ | `ctrl.classifyPreview` | - |
| `GET` | `/api/agora/relatos` | JWT | ❌ | `ctrl.listRelatos` | - |
| `GET` | `/api/agora/relatos/:id` | JWT | ❌ | `ctrl.getRelato` | - |
| `POST` | `/api/agora/relatos` | JWT | ❌ | `ctrl.createRelato` | - |
| `POST` | `/api/agora/relatos/:id/assinar` | JWT | ❌ | `ctrl.signRelato` | - |
| `GET` | `/api/agora/relatos/:id/assinei` | JWT | ❌ | `ctrl.hasUserSigned` | - |
| `GET` | `/api/agora/relatos/:id/manifesto` | JWT | ❌ | `ctrl.getManifesto` | - |
| `PATCH` | `/api/agora/relatos/:id/encaminhamento` | JWT | ❌ | `ctrl.registerEncaminhamento` | - |
| `PATCH` | `/api/agora/relatos/:id/resolucao` | JWT | ❌ | `ctrl.registerResolucao` | - |
| `GET` | `/api/agora/moderacao/fila` | JWT | ❌ | `ctrl.getModerationQueue` | - |
| `PATCH` | `/api/agora/relatos/:id/moderar` | JWT | ❌ | `ctrl.moderateRelato` | - |
| `PATCH` | `/api/agora/relatos/:id/override` | JWT | ❌ | `ctrl.overrideModeration` | - |
| `GET` | `/api/agora/enquetes` | JWT | ❌ | `ctrl.listEnquetes` | - |
| `GET` | `/api/agora/enquetes/:id` | JWT | ❌ | `ctrl.getEnquete` | - |
| `POST` | `/api/agora/enquetes` | JWT | ❌ | `ctrl.createEnquete` | - |
| `POST` | `/api/agora/enquetes/:id/votar` | JWT | ❌ | `ctrl.voteEnquete` | - |
| `GET` | `/api/agora/enquetes/:id/votei` | JWT | ❌ | `ctrl.hasVotedEnquete` | - |
| `GET` | `/api/agora/enquetes/:id/resultados` | JWT | ❌ | `ctrl.getEnqueteResults` | - |
| `PATCH` | `/api/agora/enquetes/:id/encerrar` | JWT | ❌ | `ctrl.closeEnquete` | - |
| `GET` | `/api/agora/informativos` | JWT | ❌ | `ctrl.listInformativos` | - |
| `GET` | `/api/agora/informativos/:id` | JWT | ❌ | `ctrl.getInformativo` | - |
| `POST` | `/api/agora/informativos` | JWT | ❌ | `ctrl.createInformativo` | - |
| `PATCH` | `/api/agora/informativos/:id/publicar` | JWT | ❌ | `ctrl.publishInformativo` | - |
| `PATCH` | `/api/agora/informativos/:id/arquivar` | JWT | ❌ | `ctrl.archiveInformativo` | - |
| `POST` | `/api/agora/informativos/:id/votar` | JWT | ❌ | `ctrl.voteInformativo` | - |
| `GET` | `/api/agora/stats/:regiaoId` | JWT | ❌ | `ctrl.getStats` | - |
| `GET` | `/api/agora/feed/:regiaoId` | JWT | ❌ | `ctrl.getFeed` | - |

### `/api/carona`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `POST` | `/api/carona/drivers` | JWT | ❌ | `ctrl.registerDriver` | - |
| `GET` | `/api/carona/drivers/me` | JWT | ❌ | `ctrl.getDriverProfile` | - |
| `PATCH` | `/api/carona/drivers/:id/verify` | JWT | ❌ | `ctrl.verifyDriver` | - |
| `GET` | `/api/carona/dashboard` | JWT | ❌ | `ctrl.getDriverDashboard` | - |
| `POST` | `/api/carona/rides` | JWT | ❌ | `ctrl.createRide` | - |
| `GET` | `/api/carona/rides/search` | JWT | ❌ | `ctrl.searchRides` | - |
| `GET` | `/api/carona/rides/me/driver` | JWT | ❌ | `ctrl.getMyRidesAsDriver` | - |
| `GET` | `/api/carona/rides/me/passenger` | JWT | ❌ | `ctrl.getMyRidesAsPassenger` | - |
| `POST` | `/api/carona/rides/recurring` | JWT | ❌ | `ctrl.createRecurringRide` | - |
| `GET` | `/api/carona/rides/:id` | JWT | ❌ | `ctrl.getRideDetail` | - |
| `PATCH` | `/api/carona/rides/:id` | JWT | ❌ | `ctrl.updateRide` | - |
| `DELETE` | `/api/carona/rides/:id/cancel` | JWT | ❌ | `ctrl.cancelRide` | - |
| `POST` | `/api/carona/rides/:id/seats` | JWT | ❌ | `ctrl.bookSeat` | - |
| `POST` | `/api/carona/rides/:id/checkin` | JWT | ❌ | `ctrl.driverCheckin` | - |
| `POST` | `/api/carona/seats/:seatId/board` | JWT | ❌ | `ctrl.passengerBoard` | - |
| `POST` | `/api/carona/seats/:seatId/alight` | JWT | ❌ | `ctrl.passengerAlight` | - |
| `POST` | `/api/carona/seats/:seatId/cancel` | JWT | ❌ | `ctrl.cancelSeat` | - |
| `POST` | `/api/carona/seats/:seatId/rate` | JWT | ❌ | `ctrl.submitRating` | - |

### `/api/fiscal`

| Método | Path | Auth | Swagger | Controller | Joi |
|--------|------|------|---------|------------|-----|
| `GET` | `/api/fiscal/users/search` | JWT | ❌ | `ctrl.searchUser` | - |
| `GET` | `/api/fiscal/clients` | JWT | ❌ | `` | - |
| `POST` | `/api/fiscal/clients` | JWT | ❌ | `` | - |
| `GET` | `/api/fiscal/clients/:clientId` | JWT | ❌ | `` | - |
| `PATCH` | `/api/fiscal/clients/:clientId` | JWT | ❌ | `` | - |
| `DELETE` | `/api/fiscal/clients/:clientId` | JWT | ❌ | `` | - |
| `GET` | `/api/fiscal/clients/:clientId/pendencias` | JWT | ❌ | `` | - |
| `POST` | `/api/fiscal/clients/:clientId/pendencias` | JWT | ❌ | `` | - |
| `GET` | `/api/fiscal/pendencias` | JWT | ❌ | `` | - |
| `PATCH` | `/api/fiscal/pendencias/:id` | JWT | ❌ | `` | - |
| `POST` | `/api/fiscal/pendencias/:id/concluir` | JWT | ❌ | `` | - |
| `GET` | `/api/fiscal/pendencias/:id/historico` | JWT | ❌ | `` | - |
| `GET` | `/api/fiscal/my-pendencias` | JWT | ❌ | `ctrl.getMyPendencias` | - |
| `POST` | `/api/fiscal/bookings/:bookingId/attachments` | JWT | ❌ | `upload.single('file'` | - |
| `GET` | `/api/fiscal/bookings/:bookingId/attachments` | JWT | ❌ | `ctrl.listAttachments` | - |
| `DELETE` | `/api/fiscal/attachments/:attachmentId` | JWT | ❌ | `ctrl.deleteAttachment` | - |
| `GET` | `/api/fiscal/attachments/:attachmentId/url` | JWT | ❌ | `ctrl.getAttachmentUrl` | - |

## Rotas sem documentação Swagger

| # | Método | Path | Controller |
|---|--------|------|------------|
| 1 | `GET` | `/api/rbac/check-role/:roleName` | `` |
| 2 | `GET` | `/api/health/public` | `` |
| 3 | `GET` | `/api/health/service/:serviceName` | `` |
| 4 | `GET` | `/api/health/dependencies` | `` |
| 5 | `GET` | `/api/health/full` | `` |
| 6 | `GET` | `/api/health/` | `` |
| 7 | `POST` | `/api/auth/confirm-email-verification` | `authController.confirmEmailVerification` |
| 8 | `POST` | `/api/auth/verify-otp-challenge` | `authController.verifyOtpChallenge` |
| 9 | `PATCH` | `/api/auth/verify-phone` | `authController.verifyPhone` |
| 10 | `POST` | `/api/auth/recovery/lookup-phone` | `authController.lookupPhoneForRecovery` |
| 11 | `POST` | `/api/auth/recovery/verify-phone` | `authController.verifyPhoneForRecovery` |
| 12 | `POST` | `/api/auth/recovery/change-email` | `authController.recoveryChangeEmail` |
| 13 | `POST` | `/api/auth/recovery/send-reset` | `authController.recoverySendReset` |
| 14 | `GET` | `/api/auth/sessions` | `authController.getSessions` |
| 15 | `DELETE` | `/api/auth/sessions/:sessionId` | `authController.revokeSession` |
| 16 | `DELETE` | `/api/auth/sessions` | `authController.revokeAllSessions` |
| 17 | `POST` | `/api/auth/mfa/setup-totp` | `authController.setupTOTP` |
| 18 | `POST` | `/api/auth/mfa/confirm-totp` | `authController.confirmTOTP` |
| 19 | `POST` | `/api/auth/mfa/enable-sms` | `authController.enableSMS2FA` |
| 20 | `POST` | `/api/auth/mfa/disable` | `authController.disableMFA` |
| 21 | `GET` | `/api/auth/mfa/status` | `authController.getMFAStatus` |
| 22 | `POST` | `/api/auth/mfa/verify` | `authController.verifyMFA` |
| 23 | `POST` | `/api/auth/mfa/send-sms` | `authController.sendMFASms` |
| 24 | `POST` | `/api/auth/refresh` | `validate(authSchemas.schemas['refresh-token']` |
| 25 | `PATCH` | `/api/admin/users/:userId/moderation` | `` |
| 26 | `POST` | `/api/admin/stickers` | `stickerAdminController.createSticker` |
| 27 | `PATCH` | `/api/admin/stickers/:id` | `stickerAdminController.updateSticker` |
| 28 | `PATCH` | `/api/admin/stickers/:id/toggle` | `stickerAdminController.toggleSticker` |
| 29 | `POST` | `/api/admin/stickers/:id/image` | `upload.single('image'` |
| 30 | `GET` | `/api/admin/selos` | `seloAdminController.getAllSelos` |
| 31 | `POST` | `/api/admin/selos` | `seloAdminController.createSelo` |
| 32 | `PATCH` | `/api/admin/selos/:id` | `seloAdminController.updateSelo` |
| 33 | `PATCH` | `/api/admin/selos/:id/toggle` | `seloAdminController.toggleSelo` |
| 34 | `POST` | `/api/admin/selos/:id/image` | `upload.single('image'` |
| 35 | `GET` | `/api/admin/selos/:id/holders` | `seloAdminController.getSeloHolders` |
| 36 | `POST` | `/api/admin/users/:userId/selos` | `seloAdminController.grantSeloToUser` |
| 37 | `DELETE` | `/api/admin/users/:userId/selos/:seloId` | `seloAdminController.revokeSeloFromUser` |
| 38 | `GET` | `/api/admin/kyc/pending` | `kycAdminController.getPending` |
| 39 | `POST` | `/api/admin/kyc/:verificationId/approve` | `kycAdminController.approve` |
| 40 | `POST` | `/api/admin/kyc/:verificationId/reject` | `kycAdminController.reject` |
| 41 | `GET` | `/api/admin/kyc/:verificationId/media` | `kycAdminController.getMedia` |
| 42 | `GET` | `/api/admin/endorsements/search` | `endorsementAdminController.searchUsers` |
| 43 | `GET` | `/api/admin/endorsements` | `endorsementAdminController.listEndorsements` |
| 44 | `POST` | `/api/admin/endorsements` | `endorsementAdminController.endorseUser` |
| 45 | `POST` | `/api/admin/endorsements/:id/revoke` | `endorsementAdminController.revokeEndorsement` |
| 46 | `PUT` | `/api/support/csat/:token` | `supportController.submitCsat` |
| 47 | `GET` | `/api/support/articles` | `knowledgeController.listArticles` |
| 48 | `GET` | `/api/support/articles/:articleId` | `knowledgeController.getArticle` |
| 49 | `POST` | `/api/support/tickets/:ticketId/action` | `` |
| 50 | `DELETE` | `/api/support/tickets/links/:linkId` | `` |
| 51 | `POST` | `/api/support/tickets/:ticketId/links` | `` |
| 52 | `GET` | `/api/support/tickets/:ticketId/links` | `` |
| 53 | `GET` | `/api/support/macros` | `` |
| 54 | `POST` | `/api/support/macros` | `` |
| 55 | `GET` | `/api/support/articles/admin/all` | `` |
| 56 | `POST` | `/api/support/articles` | `` |
| 57 | `PUT` | `/api/support/articles/:articleId` | `` |
| 58 | `DELETE` | `/api/support/articles/:articleId` | `` |
| 59 | `GET` | `/api/interests/categories` | `interestsController.getAvailableInterests` |
| 60 | `GET` | `/api/interests/:userId` | `interestsController.getUserInterests` |
| 61 | `PUT` | `/api/interests/:userId` | `interestsController.updateUserInterests` |
| 62 | `POST` | `/api/interests/admin/categories` | `interestsController.createCategory` |
| 63 | `PUT` | `/api/interests/admin/categories/:categoryId` | `interestsController.updateCategory` |
| 64 | `POST` | `/api/interests/admin/interests` | `interestsController.createInterest` |
| 65 | `PUT` | `/api/interests/admin/interests/:interestId` | `interestsController.updateInterest` |
| 66 | `GET` | `/api/interests/admin/stats` | `interestsController.getInterestStats` |
| 67 | `GET` | `/api/caixinha/membros/:caixinhaId/convites` | `caixinhaInviteController.getCaixinhaInvites` |
| 68 | `GET` | `/api/caixinha/membros/convite/:caixinhaInviteId` | `caixinhaInviteController.getInviteDetails` |
| 69 | `GET` | `/api/caixinha/:caixinhaId/me` | `` |
| 70 | `POST` | `/api/caixinha/:caixinhaId/contribuicao` | `` |
| 71 | `GET` | `/api/caixinha/:caixinhaId/contribuicoes` | `` |
| 72 | `GET` | `/api/caixinha/:caixinhaId/relatorio` | `` |
| 73 | `POST` | `/api/rifas/:caixinhaId/sorteio/:rifaId` | `validate(rifaSchema.realizarSorteio` |
| 74 | `POST` | `/api/rifas/:caixinhaId/amigo-secreto/:rifaId/sortear` | `validate(rifaSchema.sortearPares` |
| 75 | `GET` | `/api/rifas/:caixinhaId/amigo-secreto/:rifaId/meu-par` | `rifaController.revelarMeuPar` |
| 76 | `GET` | `/api/rifas/:caixinhaId/amigo-secreto/:rifaId/pares` | `rifaController.listarTodosPares` |
| 77 | `POST` | `/api/rifas/:caixinhaId/votar/:rifaId` | `validate(rifaSchema.votar` |
| 78 | `GET` | `/api/rifas/:caixinhaId/votos/:rifaId` | `rifaController.listarVotos` |
| 79 | `POST` | `/api/rifas/:caixinhaId/resolver/:rifaId` | `validate(rifaSchema.resolver` |
| 80 | `GET` | `/api/banking/:caixinhaId` | `bankAccountController.getAllBankAccounts` |
| 81 | `GET` | `/api/banking/:caixinhaId/history` | `bankAccountController.getAccountHistory` |
| 82 | `POST` | `/api/banking/:caixinhaId/register` | `bankAccountController.createBankAccount` |
| 83 | `POST` | `/api/banking/:accountId/generate-validation-pix` | `bankAccountController.generateValidationPix` |
| 84 | `POST` | `/api/banking/:accountId/validate` | `bankAccountController.validateAccount` |
| 85 | `PUT` | `/api/banking/:id` | `bankAccountController.updateBankAccount` |
| 86 | `PATCH` | `/api/banking/:id/activate` | `bankAccountController.activateBankAccount` |
| 87 | `DELETE` | `/api/banking/:id` | `bankAccountController.deleteBankAccount` |
| 88 | `POST` | `/api/banking/payments/card` | `` |
| 89 | `POST` | `/api/banking/payments/pix` | `paymentsController.createPixPayment` |
| 90 | `GET` | `/api/banking/payments/status/:paymentId` | `paymentsController.checkPixPaymentStatus` |
| 91 | `POST` | `/api/banking/transfer` | `` |
| 92 | `POST` | `/api/banking/transaction/:id/cancel` | `bankAccountController.cancelTransaction` |
| 93 | `POST` | `/api/banking/:caixinhaId/apply-user-method/:methodId` | `userPaymentMethodController.applyToCaixinha` |
| 94 | `POST` | `/api/email/send-invite` | `` |
| 95 | `DELETE` | `/api/notifications/push-token` | `notificationsController.removePushToken` |
| 96 | `GET` | `/api/payments/status/:paymentId` | `paymentsController.checkPixPaymentStatus` |
| 97 | `POST` | `/api/payments/card` | `` |
| 98 | `POST` | `/api/payments/asaas/subconta/create/:caixinhaId` | `asaasController.createSubconta` |
| 99 | `POST` | `/api/payments/asaas/pix` | `` |
| 100 | `GET` | `/api/payments/asaas/status/:paymentId` | `asaasController.getPaymentStatus` |
| 101 | `GET` | `/api/payments/asaas/balance/:caixinhaId` | `asaasController.getMemberBalance` |
| 102 | `GET` | `/api/payments/asaas/withdrawal/estimate` | `asaasController.withdrawalEstimate` |
| 103 | `POST` | `/api/payments/asaas/withdrawal/request` | `` |
| 104 | `POST` | `/api/payments/asaas/withdrawal/approve` | `` |
| 105 | `GET` | `/api/posts/trending-hashtags` | `postController.getTrendingHashtags` |
| 106 | `GET` | `/api/stickers/` | `stickerController.listStickers` |
| 107 | `GET` | `/api/users/preferences` | `userController.getNotificationPreferences` |
| 108 | `PUT` | `/api/users/preferences` | `userController.updateNotificationPreferences` |
| 109 | `GET` | `/api/users/payment-methods` | `userPaymentMethodController.list` |
| 110 | `POST` | `/api/users/payment-methods` | `userPaymentMethodController.register` |
| 111 | `POST` | `/api/users/payment-methods/:id/validate` | `userPaymentMethodController.validate` |
| 112 | `DELETE` | `/api/users/payment-methods/:id` | `userPaymentMethodController.remove` |
| 113 | `GET` | `/api/users/:userId` | `` |
| 114 | `PATCH` | `/api/users/username` | `userController.updateUsername` |
| 115 | `PUT` | `/api/users/recovery-email` | `userController.setRecoveryEmail` |
| 116 | `POST` | `/api/users/recovery-email/verify` | `userController.verifyRecoveryEmail` |
| 117 | `POST` | `/api/users/recovery-email/resend` | `userController.resendRecoveryEmailOTP` |
| 118 | `DELETE` | `/api/users/recovery-email` | `userController.removeRecoveryEmail` |
| 119 | `GET` | `/api/users/me/wishlist` | `userController.getMyWishlist` |
| 120 | `PATCH` | `/api/users/me/wishlist` | `userController.updateMyWishlist` |
| 121 | `POST` | `/api/users/:userId/report` | `reportController.reportUser` |
| 122 | `POST` | `/api/connections/requests/:senderId/accept` | `connectionsController.acceptConnectionRequest` |
| 123 | `POST` | `/api/webhook/mercadopago` | `webhookController.mercadoPagoWebhook` |
| 124 | `POST` | `/api/webhook/asaas` | `webhookController.asaasWebhook` |
| 125 | `POST` | `/api/webhook/resend-inbound` | `webhookController.resendInboundWebhook` |
| 126 | `POST` | `/api/webhook/stripe` | `webhookController.stripeWebhook` |
| 127 | `POST` | `/api/webhook/test` | `` |
| 128 | `GET` | `/api/security/events` | `` |
| 129 | `GET` | `/api/qa/health` | `qaCtrl.getHealth` |
| 130 | `POST` | `/api/qa/run` | `qaCtrl.triggerRun` |
| 131 | `GET` | `/api/qa/stream` | `qaCtrl.streamRun` |
| 132 | `POST` | `/api/qa/seed-balance` | `qaCtrl.seedBalance` |
| 133 | `GET` | `/api/qa/runs` | `qaCtrl.listRuns` |
| 134 | `GET` | `/api/qa/runs/:runId` | `qaCtrl.getRunDetail` |
| 135 | `GET` | `/api/qa/autofix-pending` | `qaCtrl.listAutofixPending` |
| 136 | `POST` | `/api/qa/autofix-pending/:id/approve` | `qaCtrl.approveAutofix` |
| 137 | `POST` | `/api/qa/autofix-pending/:id/refine` | `qaCtrl.refineAutofix` |
| 138 | `DELETE` | `/api/qa/autofix-pending/:id` | `qaCtrl.rejectAutofix` |
| 139 | `GET` | `/api/qa/interpretation-cache/:hash` | `qaCtrl.getInterpretationCache` |
| 140 | `GET` | `/api/qa/notification-jobs` | `qaCtrl.listNotificationJobs` |
| 141 | `GET` | `/api/qa/sre-logs` | `qaCtrl.getSreLogs` |
| 142 | `POST` | `/api/sre/feedback` | `` |
| 143 | `GET` | `/api/gamification/me` | `ctrl.getMe` |
| 144 | `GET` | `/api/gamification/tasks` | `ctrl.getTasks` |
| 145 | `GET` | `/api/gamification/leaderboard` | `ctrl.getLeaderboard` |
| 146 | `GET` | `/api/gamification/catalog/levels` | `ctrl.getLevels` |
| 147 | `GET` | `/api/gamification/catalog/selos` | `ctrl.getSelos` |
| 148 | `POST` | `/api/gamification/task/complete` | `ctrl.completeTask` |
| 149 | `POST` | `/api/gamification/task/progress` | `ctrl.incrementProgress` |
| 150 | `POST` | `/api/gamification/streak` | `ctrl.updateStreak` |
| 151 | `POST` | `/api/gamification/selo/pin` | `ctrl.togglePin` |
| 152 | `POST` | `/api/gamification/event` | `ctrl.triggerEvent` |
| 153 | `POST` | `/api/gamification/spend` | `ctrl.spendCoins` |
| 154 | `POST` | `/api/gamification/boost-content` | `ctrl.boostContent` |
| 155 | `POST` | `/api/gamification/tip` | `ctrl.tipUser` |
| 156 | `POST` | `/api/gamification/recalculate` | `ctrl.recalculate` |
| 157 | `POST` | `/api/gamification/boost` | `ctrl.grantBoost` |
| 158 | `GET` | `/api/elcoin/statement` | `ctrl.getStatement` |
| 162 | `GET` | `/api/kyc/status` | `kycController.getStatus` |
| 163 | `POST` | `/api/kyc/verify-cpf` | `` |
| 164 | `POST` | `/api/kyc/upload-media` | `` |
| 165 | `POST` | `/api/kyc/verify-document` | `` |
| 166 | `POST` | `/api/kyc/verify-cnpj` | `` |
| 167 | `POST` | `/api/contracts/webhook/clicksign` | `ctrl.clicksignWebhook` |
| 168 | `GET` | `/api/contracts/` | `ctrl.listContracts` |
| 169 | `POST` | `/api/contracts/generate` | `ctrl.generateContract` |
| 170 | `GET` | `/api/contracts/:id` | `ctrl.getContract` |
| 171 | `GET` | `/api/contracts/:id/download-url` | `ctrl.getDownloadUrl` |
| 172 | `GET` | `/api/contracts/:id/signing-link` | `ctrl.getSigningLink` |
| 173 | `POST` | `/api/contracts/:id/cancel` | `ctrl.cancelContract` |
| 174 | `GET` | `/api/marketplace/categories` | `ctrl.getCategories` |
| 175 | `POST` | `/api/marketplace/seller` | `ctrl.createSellerProfile` |
| 176 | `GET` | `/api/marketplace/sellers` | `ctrl.listSellers` |
| 177 | `GET` | `/api/marketplace/seller/me` | `ctrl.getMySellerProfile` |
| 178 | `GET` | `/api/marketplace/seller/products` | `ctrl.listMyProducts` |
| 179 | `GET` | `/api/marketplace/sellers/:id` | `ctrl.getSellerProfile` |
| 180 | `PATCH` | `/api/marketplace/seller` | `ctrl.updateSellerProfile` |
| 181 | `PATCH` | `/api/marketplace/sellers/:id/approve` | `ctrl.approveSellerProfile` |
| 182 | `DELETE` | `/api/marketplace/seller/location` | `ctrl.removeSellerLocation` |
| 183 | `PATCH` | `/api/marketplace/seller/deactivate` | `ctrl.deactivateStore` |
| 184 | `PATCH` | `/api/marketplace/seller/reactivate` | `ctrl.reactivateStore` |
| 185 | `DELETE` | `/api/marketplace/seller` | `ctrl.deleteStore` |
| 186 | `POST` | `/api/marketplace/seller/backfill-coords` | `ctrl.backfillSellerCoords` |
| 187 | `POST` | `/api/marketplace/products` | `ctrl.createProduct` |
| 188 | `GET` | `/api/marketplace/products` | `ctrl.listProducts` |
| 189 | `GET` | `/api/marketplace/products/:id` | `ctrl.getProduct` |
| 190 | `PATCH` | `/api/marketplace/products/:id` | `ctrl.updateProduct` |
| 191 | `DELETE` | `/api/marketplace/products/:id` | `ctrl.deactivateProduct` |
| 192 | `POST` | `/api/marketplace/orders` | `ctrl.createOrder` |
| 193 | `GET` | `/api/marketplace/orders` | `ctrl.listOrders` |
| 194 | `GET` | `/api/marketplace/orders/:id` | `ctrl.getOrder` |
| 195 | `PATCH` | `/api/marketplace/orders/:id/status` | `ctrl.updateOrderStatus` |
| 196 | `POST` | `/api/marketplace/orders/:id/renew-pix` | `ctrl.renewOrderPix` |
| 197 | `POST` | `/api/marketplace/orders/:id/confirm-payment-offline` | `ctrl.confirmPaymentOffline` |
| 198 | `POST` | `/api/marketplace/orders/:id/dispute` | `ctrl.createOrderDispute` |
| 199 | `POST` | `/api/marketplace/goals` | `ctrl.createCommunityGoal` |
| 200 | `GET` | `/api/marketplace/goals` | `ctrl.listCommunityGoals` |
| 201 | `POST` | `/api/marketplace/goals/:id/contribute` | `ctrl.contributeToGoal` |
| 202 | `POST` | `/api/marketplace/reviews` | `ctrl.createReview` |
| 203 | `GET` | `/api/marketplace/sellers/:sellerId/reviews` | `ctrl.getSellerReviews` |
| 204 | `GET` | `/api/marketplace/orders/:orderId/review` | `ctrl.getOrderReview` |
| 205 | `PATCH` | `/api/marketplace/reviews/:reviewId/reply` | `ctrl.replyToReview` |
| 206 | `POST` | `/api/marketplace/products/:id/trade-request` | `` |
| 207 | `GET` | `/api/marketplace/trade-requests` | `barterController.listTradeRequests` |
| 208 | `PATCH` | `/api/marketplace/trade-requests/:id/accept` | `barterController.acceptTradeRequest` |
| 209 | `PATCH` | `/api/marketplace/trade-requests/:id/reject` | `barterController.rejectTradeRequest` |
| 210 | `PATCH` | `/api/marketplace/trade-requests/:id/cancel` | `barterController.cancelTradeRequest` |
| 211 | `GET` | `/api/marketplace/seller-subtypes` | `ctrl.listSellerSubtypes` |
| 212 | `POST` | `/api/marketplace/menu/categories` | `` |
| 213 | `GET` | `/api/marketplace/menu/:sellerId/categories` | `ctrl.listMenuCategories` |
| 214 | `GET` | `/api/marketplace/menu/:sellerId` | `ctrl.getSellerMenu` |
| 215 | `PATCH` | `/api/marketplace/menu/categories/:id` | `` |
| 216 | `POST` | `/api/marketplace/products/:productId/modifiers` | `` |
| 217 | `GET` | `/api/marketplace/products/:productId/modifiers` | `ctrl.listProductModifiers` |
| 218 | `PATCH` | `/api/marketplace/products/:productId/modifiers/:modifierId` | `` |
| 219 | `DELETE` | `/api/marketplace/products/:productId/modifiers/:modifierId` | `` |
| 220 | `POST` | `/api/marketplace/upload/product-image` | `upload.single('image'` |
| 221 | `POST` | `/api/marketplace/upload/seller-cover` | `upload.single('image'` |
| 222 | `GET` | `/api/marketplace/seller/team` | `` |
| 223 | `POST` | `/api/marketplace/seller/team/invite` | `` |
| 224 | `POST` | `/api/marketplace/seller/team/accept/:sellerId` | `teamCtrl.acceptInvite` |
| 225 | `DELETE` | `/api/marketplace/seller/team/:userId` | `` |
| 226 | `PATCH` | `/api/marketplace/seller/team/:userId/role` | `` |
| 227 | `GET` | `/api/subscriptions/my` | `subscriptionController.getMy` |
| 228 | `POST` | `/api/subscriptions/seller` | `subscriptionController.createSeller` |
| 229 | `PATCH` | `/api/subscriptions/billing-mode` | `subscriptionController.updateBillingMode` |
| 230 | `POST` | `/api/subscriptions/cancel` | `subscriptionController.cancel` |
| 231 | `POST` | `/api/kyc-social/request` | `ctrl.requestVerification` |
| 232 | `GET` | `/api/kyc-social/my-request` | `ctrl.getMyRequest` |
| 233 | `GET` | `/api/kyc-social/requests/:requestId` | `ctrl.getRequestForValidation` |
| 234 | `POST` | `/api/kyc-social/requests/:requestId/validate` | `ctrl.validateIdentity` |
| 235 | `POST` | `/api/kyc-social/bonds/:protegeId/break` | `ctrl.breakGodfatherBond` |
| 236 | `POST` | `/api/kyc-social/admin/cleanup-expired-photos` | `ctrl.cleanupExpiredPhotos` |
| 237 | `GET` | `/api/preferences/` | `` |
| 238 | `PATCH` | `/api/preferences/location` | `` |
| 239 | `PATCH` | `/api/preferences/address` | `` |
| 240 | `PATCH` | `/api/preferences/vehicle` | `` |
| 241 | `PATCH` | `/api/preferences/:category` | `` |
| 242 | `GET` | `/api/modules/` | `` |
| 243 | `PATCH` | `/api/modules/:moduleId/preference` | `` |
| 244 | `GET` | `/api/modules/admin/all` | `` |
| 245 | `PATCH` | `/api/modules/admin/:moduleId` | `` |
| 246 | `POST` | `/api/delivery/service` | `ctrl.createDeliveryService` |
| 247 | `GET` | `/api/delivery/service/me` | `ctrl.getMyDeliveryService` |
| 248 | `GET` | `/api/delivery/service/:id` | `ctrl.getDeliveryServiceById` |
| 249 | `PATCH` | `/api/delivery/service` | `ctrl.updateDeliveryService` |
| 250 | `POST` | `/api/delivery/session/online` | `ctrl.goOnline` |
| 251 | `POST` | `/api/delivery/session/offline` | `ctrl.goOffline` |
| 252 | `GET` | `/api/delivery/eligible` | `ctrl.findEligibleDeliverers` |
| 253 | `GET` | `/api/delivery/fee` | `ctrl.calculateFee` |
| 254 | `POST` | `/api/delivery/orders/:orderId/request` | `ctrl.requestDelivery` |
| 255 | `GET` | `/api/delivery/dashboard` | `ctrl.getDashboard` |
| 256 | `GET` | `/api/delivery/requests` | `ctrl.listMyDeliveryRequests` |
| 257 | `GET` | `/api/delivery/requests/:id` | `ctrl.getDeliveryRequest` |
| 258 | `PATCH` | `/api/delivery/requests/:id/cancel` | `ctrl.cancelDeliveryRequest` |
| 259 | `POST` | `/api/delivery/requests/:id/accept` | `ctrl.acceptDeliveryRequest` |
| 260 | `POST` | `/api/delivery/requests/:id/decline` | `ctrl.declineDeliveryRequest` |
| 261 | `POST` | `/api/delivery/requests/:id/step` | `ctrl.confirmStep` |
| 262 | `POST` | `/api/delivery/requests/:id/rate` | `ctrl.rateDelivery` |
| 263 | `GET` | `/api/delivery/ratings/pending` | `ratingCtrl.getPendingRatings` |
| 264 | `GET` | `/api/delivery/ratings/history` | `ratingCtrl.getRatingHistory` |
| 265 | `GET` | `/api/delivery/ratings/summary/:userId` | `ratingCtrl.getUserRatingSummary` |
| 266 | `POST` | `/api/delivery/:requestId/ratings` | `ratingCtrl.submitRating` |
| 267 | `GET` | `/api/delivery/:requestId/ratings` | `ratingCtrl.getRatingsForRequest` |
| 268 | `PUT` | `/api/bookings/availability` | `` |
| 269 | `GET` | `/api/bookings/availability/:serviceId` | `ctrl.getAvailability` |
| 270 | `GET` | `/api/bookings/available-days` | `ctrl.getActiveDays` |
| 271 | `GET` | `/api/bookings/slots` | `ctrl.getAvailableSlots` |
| 272 | `POST` | `/api/bookings/` | `ctrl.createBooking` |
| 273 | `GET` | `/api/bookings/` | `ctrl.getMyBookings` |
| 274 | `GET` | `/api/bookings/:id` | `ctrl.getBookingById` |
| 275 | `PATCH` | `/api/bookings/:id/confirm` | `ctrl.confirmBooking` |
| 276 | `PATCH` | `/api/bookings/:id/decline` | `ctrl.declineBooking` |
| 277 | `PATCH` | `/api/bookings/:id/complete` | `ctrl.completeBooking` |
| 278 | `PATCH` | `/api/bookings/:id/cancel` | `ctrl.cancelBooking` |
| 279 | `GET` | `/api/marketplace/imoveis/:propertyId/availability` | `ctrl.getAvailability` |
| 280 | `GET` | `/api/marketplace/imoveis/:propertyId/reviews` | `ctrl.getPropertyReviews` |
| 281 | `POST` | `/api/marketplace/imoveis/stay` | `ctrl.createStay` |
| 282 | `POST` | `/api/marketplace/imoveis/stay/:id/confirm` | `ctrl.confirmStayPayment` |
| 283 | `POST` | `/api/marketplace/imoveis/stay/:id/cancel` | `ctrl.cancelStay` |
| 284 | `POST` | `/api/marketplace/imoveis/stay/:id/review` | `ctrl.submitReview` |
| 285 | `GET` | `/api/marketplace/imoveis/stays/guest` | `ctrl.getGuestStays` |
| 286 | `POST` | `/api/marketplace/imoveis/:propertyId/block` | `ctrl.blockDates` |
| 287 | `DELETE` | `/api/marketplace/imoveis/block/:blockId` | `ctrl.unblockDates` |
| 288 | `GET` | `/api/marketplace/imoveis/stays/host` | `ctrl.getHostStays` |
| 289 | `POST` | `/api/marketplace/imoveis/stay/:id/complete` | `ctrl.completeStay` |
| 290 | `POST` | `/api/games/` | `ctrl.createGame` |
| 291 | `GET` | `/api/games/` | `ctrl.listMyGames` |
| 292 | `GET` | `/api/games/:gameId` | `ctrl.getGame` |
| 293 | `PATCH` | `/api/games/:gameId` | `ctrl.updateGame` |
| 294 | `DELETE` | `/api/games/:gameId` | `ctrl.deleteGame` |
| 295 | `PATCH` | `/api/games/:gameId/cancel` | `ctrl.cancelGame` |
| 296 | `PATCH` | `/api/games/:gameId/open` | `ctrl.openGame` |
| 297 | `PATCH` | `/api/games/:gameId/close` | `ctrl.closeGame` |
| 298 | `PATCH` | `/api/games/:gameId/associate` | `ctrl.associateCaixinha` |
| 299 | `GET` | `/api/games/:gameId/items` | `ctrl.listItems` |
| 300 | `PUT` | `/api/games/:gameId/items` | `ctrl.replaceItems` |
| 301 | `POST` | `/api/games/:gameId/items/batch` | `ctrl.addItemsBatch` |
| 302 | `POST` | `/api/games/:gameId/items` | `ctrl.addItem` |
| 303 | `POST` | `/api/games/:gameId/items/:itemId/claim` | `ctrl.claimItem` |
| 304 | `DELETE` | `/api/games/:gameId/items/:itemId/claim` | `ctrl.unclaimItem` |
| 305 | `POST` | `/api/games/:gameId/draw` | `ctrl.drawGame` |
| 306 | `GET` | `/api/games/:gameId/pair` | `ctrl.revealMyPair` |
| 307 | `POST` | `/api/games/:gameId/gift-proposal` | `ctrl.proposeGiftValue` |
| 308 | `PATCH` | `/api/games/:gameId/gift-proposal/:targetUserId` | `ctrl.respondGiftProposal` |
| 309 | `POST` | `/api/games/:gameId/raffle/initialize` | `ctrl.initializeRaffleTickets` |
| 310 | `POST` | `/api/games/:gameId/raffle/tickets/buy` | `ctrl.buyRaffleTicket` |
| 311 | `GET` | `/api/games/:gameId/raffle/tickets/mine` | `ctrl.getMyRaffleTickets` |
| 312 | `GET` | `/api/games/:gameId/raffle/tickets` | `ctrl.getRaffleTickets` |
| 313 | `POST` | `/api/games/:gameId/invites` | `ctrl.inviteParticipant` |
| 314 | `GET` | `/api/games/:gameId/participants` | `ctrl.getParticipants` |
| 315 | `POST` | `/api/games/:gameId/leave` | `ctrl.leaveGame` |
| 316 | `DELETE` | `/api/games/:gameId/participants/:targetUserId` | `ctrl.removeParticipant` |
| 317 | `POST` | `/api/payments/pix-direto/generate` | `pixDiretoController.generatePixData` |
| 318 | `POST` | `/api/payments/pix-direto/upload/:receiptId` | `receiptUpload.single('receipt'` |
| 319 | `POST` | `/api/payments/pix-direto/approve/:receiptId` | `pixDiretoController.approveReceipt` |
| 320 | `POST` | `/api/payments/pix-direto/reject/:receiptId` | `pixDiretoController.rejectReceipt` |
| 321 | `POST` | `/api/payments/pix-direto/admin/register-cash` | `pixDiretoController.registerCashPayment` |
| 322 | `GET` | `/api/payments/pix-direto/modes/:caixinhaId` | `pixDiretoController.getPaymentModes` |
| 323 | `GET` | `/api/payments/pix-direto/receipts/:caixinhaId` | `pixDiretoController.listReceipts` |
| 324 | `GET` | `/api/payments/pix-direto/my-receipts/:caixinhaId` | `pixDiretoController.getMyReceipts` |
| 325 | `GET` | `/api/user/readiness` | `` |
| 326 | `GET` | `/api/user/pending-actions` | `` |
| 327 | `GET` | `/api/trust/passport` | `ctrl.getMyPassport` |
| 328 | `GET` | `/api/trust/passport/:userId` | `ctrl.getPublicPassport` |
| 329 | `GET` | `/api/trust/levels` | `ctrl.getLevels` |
| 330 | `POST` | `/api/trust/endorse` | `ctrl.createEndorsement` |
| 331 | `POST` | `/api/trust/recalculate` | `ctrl.recalculate` |
| 332 | `POST` | `/api/trust/recalculate-all` | `ctrl.recalculateAll` |
| 333 | `GET` | `/api/agora/regioes/por-cep` | `ctrl.getRegiaoByCep` |
| 334 | `GET` | `/api/agora/regioes/por-gps` | `ctrl.getRegiaoByGps` |
| 335 | `GET` | `/api/agora/regioes` | `ctrl.listRegioes` |
| 336 | `POST` | `/api/agora/regioes` | `ctrl.createRegiao` |
| 337 | `PATCH` | `/api/agora/regioes/:id` | `ctrl.updateRegiao` |
| 338 | `GET` | `/api/agora/regioes/:id/log` | `ctrl.getRegiaoLog` |
| 339 | `POST` | `/api/agora/classificar` | `ctrl.classifyPreview` |
| 340 | `GET` | `/api/agora/relatos` | `ctrl.listRelatos` |
| 341 | `GET` | `/api/agora/relatos/:id` | `ctrl.getRelato` |
| 342 | `POST` | `/api/agora/relatos` | `ctrl.createRelato` |
| 343 | `POST` | `/api/agora/relatos/:id/assinar` | `ctrl.signRelato` |
| 344 | `GET` | `/api/agora/relatos/:id/assinei` | `ctrl.hasUserSigned` |
| 345 | `GET` | `/api/agora/relatos/:id/manifesto` | `ctrl.getManifesto` |
| 346 | `PATCH` | `/api/agora/relatos/:id/encaminhamento` | `ctrl.registerEncaminhamento` |
| 347 | `PATCH` | `/api/agora/relatos/:id/resolucao` | `ctrl.registerResolucao` |
| 348 | `GET` | `/api/agora/moderacao/fila` | `ctrl.getModerationQueue` |
| 349 | `PATCH` | `/api/agora/relatos/:id/moderar` | `ctrl.moderateRelato` |
| 350 | `PATCH` | `/api/agora/relatos/:id/override` | `ctrl.overrideModeration` |
| 351 | `GET` | `/api/agora/enquetes` | `ctrl.listEnquetes` |
| 352 | `GET` | `/api/agora/enquetes/:id` | `ctrl.getEnquete` |
| 353 | `POST` | `/api/agora/enquetes` | `ctrl.createEnquete` |
| 354 | `POST` | `/api/agora/enquetes/:id/votar` | `ctrl.voteEnquete` |
| 355 | `GET` | `/api/agora/enquetes/:id/votei` | `ctrl.hasVotedEnquete` |
| 356 | `GET` | `/api/agora/enquetes/:id/resultados` | `ctrl.getEnqueteResults` |
| 357 | `PATCH` | `/api/agora/enquetes/:id/encerrar` | `ctrl.closeEnquete` |
| 358 | `GET` | `/api/agora/informativos` | `ctrl.listInformativos` |
| 359 | `GET` | `/api/agora/informativos/:id` | `ctrl.getInformativo` |
| 360 | `POST` | `/api/agora/informativos` | `ctrl.createInformativo` |
| 361 | `PATCH` | `/api/agora/informativos/:id/publicar` | `ctrl.publishInformativo` |
| 362 | `PATCH` | `/api/agora/informativos/:id/arquivar` | `ctrl.archiveInformativo` |
| 363 | `POST` | `/api/agora/informativos/:id/votar` | `ctrl.voteInformativo` |
| 364 | `GET` | `/api/agora/stats/:regiaoId` | `ctrl.getStats` |
| 365 | `GET` | `/api/agora/feed/:regiaoId` | `ctrl.getFeed` |
| 366 | `POST` | `/api/carona/drivers` | `ctrl.registerDriver` |
| 367 | `GET` | `/api/carona/drivers/me` | `ctrl.getDriverProfile` |
| 368 | `PATCH` | `/api/carona/drivers/:id/verify` | `ctrl.verifyDriver` |
| 369 | `GET` | `/api/carona/dashboard` | `ctrl.getDriverDashboard` |
| 370 | `POST` | `/api/carona/rides` | `ctrl.createRide` |
| 371 | `GET` | `/api/carona/rides/search` | `ctrl.searchRides` |
| 372 | `GET` | `/api/carona/rides/me/driver` | `ctrl.getMyRidesAsDriver` |
| 373 | `GET` | `/api/carona/rides/me/passenger` | `ctrl.getMyRidesAsPassenger` |
| 374 | `POST` | `/api/carona/rides/recurring` | `ctrl.createRecurringRide` |
| 375 | `GET` | `/api/carona/rides/:id` | `ctrl.getRideDetail` |
| 376 | `PATCH` | `/api/carona/rides/:id` | `ctrl.updateRide` |
| 377 | `DELETE` | `/api/carona/rides/:id/cancel` | `ctrl.cancelRide` |
| 378 | `POST` | `/api/carona/rides/:id/seats` | `ctrl.bookSeat` |
| 379 | `POST` | `/api/carona/rides/:id/checkin` | `ctrl.driverCheckin` |
| 380 | `POST` | `/api/carona/seats/:seatId/board` | `ctrl.passengerBoard` |
| 381 | `POST` | `/api/carona/seats/:seatId/alight` | `ctrl.passengerAlight` |
| 382 | `POST` | `/api/carona/seats/:seatId/cancel` | `ctrl.cancelSeat` |
| 383 | `POST` | `/api/carona/seats/:seatId/rate` | `ctrl.submitRating` |
| 384 | `GET` | `/api/fiscal/users/search` | `ctrl.searchUser` |
| 385 | `GET` | `/api/fiscal/clients` | `` |
| 386 | `POST` | `/api/fiscal/clients` | `` |
| 387 | `GET` | `/api/fiscal/clients/:clientId` | `` |
| 388 | `PATCH` | `/api/fiscal/clients/:clientId` | `` |
| 389 | `DELETE` | `/api/fiscal/clients/:clientId` | `` |
| 390 | `GET` | `/api/fiscal/clients/:clientId/pendencias` | `` |
| 391 | `POST` | `/api/fiscal/clients/:clientId/pendencias` | `` |
| 392 | `GET` | `/api/fiscal/pendencias` | `` |
| 393 | `PATCH` | `/api/fiscal/pendencias/:id` | `` |
| 394 | `POST` | `/api/fiscal/pendencias/:id/concluir` | `` |
| 395 | `GET` | `/api/fiscal/pendencias/:id/historico` | `` |
| 396 | `GET` | `/api/fiscal/my-pendencias` | `ctrl.getMyPendencias` |
| 397 | `POST` | `/api/fiscal/bookings/:bookingId/attachments` | `upload.single('file'` |
| 398 | `GET` | `/api/fiscal/bookings/:bookingId/attachments` | `ctrl.listAttachments` |
| 399 | `DELETE` | `/api/fiscal/attachments/:attachmentId` | `ctrl.deleteAttachment` |
| 400 | `GET` | `/api/fiscal/attachments/:attachmentId/url` | `ctrl.getAttachmentUrl` |

