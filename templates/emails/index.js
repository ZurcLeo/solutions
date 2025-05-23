// templates/emails/index.js
const conviteTemplate = require('./convite');
const conviteReminderTemplate = require('./conviteReminder');
const welcomeTemplate = require('./welcome');
const padrao = require('./padrao');
const caixinhaInviteTemplate = require('./caixinhaInvite'); 
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
    } else {
      return padrao({ subject, content });
    }
  }
};