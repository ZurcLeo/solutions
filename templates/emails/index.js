// templates/emails/index.js
const conviteTemplate = require('./convite');
const conviteReminderTemplate = require('./conviteReminder');
const welcomeTemplate = require('./welcome');
const padrao = require('./padrao');
const caixinhaInviteTemplate = require('./caixinhaInvite');
const supportTicketCreatedTemplate = require('./supportTicketCreated');
const supportTicketUpdateTemplate = require('./supportTicketUpdate');
const supportTicketResolvedTemplate = require('./supportTicketResolved');

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