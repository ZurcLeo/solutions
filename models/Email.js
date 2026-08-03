// models/Email.js
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

class Email {
  constructor(data) {
    this.id = data.id;
    this.to = data.to;
    this.subject = data.subject;
    this.templateType = data.templateType;
    this.templateData = data.templateData || {};
    this.status = data.status || 'pending';
    this.createdAt = data.createdAt || new Date();
    this.sentAt = data.sentAt || null;
    this.userId = data.userId || null;
    this.reference = data.reference || null;
    this.referenceType = data.referenceType || null;
    this.messageId = data.messageId || null;
    this.error = data.error || null;
    this.retryCount = data.retryCount || 0;
  }

  /**
   * Mapeia objeto interno para colunas do Supabase (PostgreSQL)
   */
  toSupabaseObject() {
    return {
      recipient_to: this.to,
      subject: this.subject,
      template_type: this.templateType,
      template_data: this.templateData,
      status: this.status,
      created_at: this.createdAt,
      sent_at: this.sentAt,
      user_id: this.userId,
      reference_id: this.reference,
      reference_type: this.referenceType,
      message_id: this.messageId,
      error_message: this.error,
      retry_count: this.retryCount
    };
  }

  /**
   * Mapeia retorno do Supabase para objeto interno
   */
  static fromSupabase(row) {
    if (!row) return null;
    return new Email({
      id: row.id,
      to: row.recipient_to,
      subject: row.subject,
      templateType: row.template_type,
      templateData: row.template_data,
      status: row.status,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      userId: row.user_id,
      reference: row.reference_id,
      referenceType: row.reference_type,
      messageId: row.message_id,
      error: row.error_message,
      retryCount: row.retry_count
    });
  }

  toPlainObject() {
    return {
      id: this.id,
      to: this.to,
      subject: this.subject,
      templateType: this.templateType,
      templateData: this.templateData,
      status: this.status,
      createdAt: this.createdAt,
      sentAt: this.sentAt,
      userId: this.userId,
      reference: this.reference,
      referenceType: this.referenceType,
      messageId: this.messageId,
      error: this.error,
      retryCount: this.retryCount
    };
  }

  static async create(emailData) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    const { data, error } = await supabase
      .from('email_logs')
      .insert([{
        recipient_to: emailData.to,
        subject: emailData.subject,
        template_type: emailData.templateType,
        template_data: emailData.templateData || {},
        status: emailData.status || 'pending',
        user_id: emailData.userId,
        reference_id: emailData.reference,
        reference_type: emailData.referenceType,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    logger.info('Email record created in Supabase', { emailId: data.id });
    return Email.fromSupabase(data);
  }

  static async getById(emailId) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    const { data, error } = await supabase
      .from('email_logs')
      .select('*')
      .eq('id', emailId)
      .single();

    if (error) throw error;
    if (!data) throw new Error('Email not found');

    return Email.fromSupabase(data);
  }

  static async updateStatus(emailId, status, extraData = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    const sbData = {};
    if (status) sbData.status = status;
    if (extraData.messageId) sbData.message_id = extraData.messageId;
    if (extraData.error) sbData.error_message = extraData.error;

    if (status === 'sent' && !extraData.sentAt) {
      sbData.sent_at = new Date();
    } else if (extraData.sentAt) {
      sbData.sent_at = extraData.sentAt;
    }

    const { error } = await supabase
      .from('email_logs')
      .update(sbData)
      .eq('id', emailId);

    if (error) throw error;

    logger.info('Email status updated in Supabase', { emailId, status });
    return true;
  }

  static async getByUser(userId, limit = 50) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    const { data, error } = await supabase
      .from('email_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || []).map(row => Email.fromSupabase(row));
  }

  static async getByReference(referenceType, referenceId, limit = 50) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    const { data, error } = await supabase
      .from('email_logs')
      .select('*')
      .eq('reference_type', referenceType)
      .eq('reference_id', referenceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || []).map(row => Email.fromSupabase(row));
  }
}

module.exports = Email;
