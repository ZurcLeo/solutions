// templates/emails/index.js
const conviteTemplate = require('./convite');
const conviteReminderTemplate = require('./conviteReminder');
const welcomeTemplate = require('./welcome');
const padrao = require('./padrao');
const caixinhaInviteTemplate = require('./caixinhaInvite');
const supportTicketCreatedTemplate = require('./supportTicketCreated');
const supportTicketUpdateTemplate = require('./supportTicketUpdate');
const supportTicketResolvedTemplate = require('./supportTicketResolved');
const otpTemplate = require('./otp');
const sellerApprovedTemplate = require('./sellerApproved');
const sellerRejectedTemplate = require('./sellerRejected');
const csatSurveyTemplate = require('./csatSurvey');
const kycApprovedTemplate = require('./kycApproved');
const kycRejectedTemplate = require('./kycRejected');
const bookingNewRequestTemplate = require('./bookingNewRequest');
const bookingConfirmedTemplate  = require('./bookingConfirmed');
const bookingDeclinedTemplate   = require('./bookingDeclined');
const bookingCreatedTemplate    = require('./bookingCreated');
const gameInviteTemplate        = require('./gameInvite');
const businessInviteTemplate    = require('./businessInvite');
const waitlistMatchTemplate     = require('./waitlistMatch');
const magicLinkTemplate         = require('./magicLink');
const passwordTransitionTemplate = require('./passwordTransition');
const guestOrderStatusTemplate   = require('./guestOrderStatus');

/**
 * Collection of email templates
 * Each template is a function that accepts a data object and returns HTML content
 */
module.exports = {
  // Invite templates
  convite: conviteTemplate,
  convite_lembrete: conviteReminderTemplate,
  
  // User account templates
  welcome: welcomeTemplate,
  caixinha_invite: caixinhaInviteTemplate,
  
  // Support templates
  support_ticket_created: supportTicketCreatedTemplate,
  support_ticket_update: supportTicketUpdateTemplate,
  support_ticket_resolved: supportTicketResolvedTemplate,
  csat_survey: csatSurveyTemplate,
  
  // Security / OTP
  otp: otpTemplate,
  magic_link: magicLinkTemplate,
  password_transition: passwordTransitionTemplate,

  // Marketplace — seller approval
  seller_approved: sellerApprovedTemplate,
  seller_rejected: sellerRejectedTemplate,

  // KYC — aprovação/rejeição manual pelo suporte
  kyc_approved: kycApprovedTemplate,
  kyc_rejected: kycRejectedTemplate,

  // Agendamentos — notificações SCHED
  booking_new_request: bookingNewRequestTemplate,
  booking_confirmed:   bookingConfirmedTemplate,
  booking_declined:    bookingDeclinedTemplate,
  booking_created:     bookingCreatedTemplate,

  // Jogos e Concursos
  game_invite: gameInviteTemplate,

  // Business — convite de equipe
  business_invite: businessInviteTemplate,

  // Waitlist — matching de contatos
  waitlist_match: waitlistMatchTemplate,

  // Guest checkout — status de pedido para visitantes
  guest_order_status: guestOrderStatusTemplate,

  // Generic template
  padrao: padrao,
  
  // Legacy compatibility
  getEmailTemplate: (subject, content, type) => {
    if (type === 'convite') {
      return conviteTemplate({ subject, content });
    } else if (type === 'convite_lembrete') {
      return conviteReminderTemplate({ subject, content }); 
    } else if (type === 'caixinha_invite') {
      return caixinhaInviteTemplate({ subject, content });
    } else if (type === 'support_ticket_created') {
      return supportTicketCreatedTemplate({ subject, content });
    } else if (type === 'support_ticket_update') {
      return supportTicketUpdateTemplate({ subject, content });
    } else if (type === 'support_ticket_resolved') {
      return supportTicketResolvedTemplate({ subject, content });
    } else {
      return padrao({ subject, content });
    }
  }
};