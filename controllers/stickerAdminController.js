const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

exports.createSticker = async (req, res) => {
  const adminId = req.user.uid;
  const data = req.body;
  
  if (!data.name || data.eloscoin_price === undefined || !data.image_url) {
    return res.status(400).json({ message: 'Nome, image_url e eloscoin_price são obrigatórios.' });
  }

  try {
    const supabase = getSupabaseClient();
    const { data: created, error } = await supabase
      .from('sticker_catalog')
      .insert({
        name: data.name,
        image_url: data.image_url,
        eloscoin_price: data.eloscoin_price,
        edition_type: data.edition_type || 'open',
        max_quantity: data.max_quantity || null,
        per_user_limit: data.per_user_limit || null,
        available_until: data.available_until || null,
        campaign_name: data.campaign_name || null,
        rarity: data.rarity || 'common',
        is_active: data.is_active !== undefined ? data.is_active : true,
        created_by_admin_id: adminId
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(created);
  } catch (error) {
    logger.error('Erro ao criar sticker', { adminId, error: error.message });
    res.status(500).json({ message: error.message });
  }
};

exports.updateSticker = async (req, res) => {
  const { id } = req.params;
  const data = req.body;

  // Filtra apenas campos permitidos
  const allowedUpdates = {};
  const fields = ['name', 'image_url', 'eloscoin_price', 'edition_type', 'max_quantity', 'per_user_limit', 'available_until', 'campaign_name', 'rarity', 'is_active'];
  fields.forEach(f => {
    if (data[f] !== undefined) {
      allowedUpdates[f] = data[f];
    }
  });

  try {
    const supabase = getSupabaseClient();
    const { data: updated, error } = await supabase
      .from('sticker_catalog')
      .update(allowedUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(updated);
  } catch (error) {
    logger.error('Erro ao atualizar sticker', { id, error: error.message });
    res.status(500).json({ message: error.message });
  }
};

exports.toggleSticker = async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (is_active === undefined) {
    return res.status(400).json({ message: 'is_active é obrigatório.' });
  }

  try {
    const supabase = getSupabaseClient();
    const { data: updated, error } = await supabase
      .from('sticker_catalog')
      .update({ is_active })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(updated);
  } catch (error) {
    logger.error('Erro ao alternar sticker', { id, error: error.message });
    res.status(500).json({ message: error.message });
  }
};

exports.uploadImage = async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ message: 'Nenhuma imagem fornecida.' });
  }

  try {
    const supabase = getSupabaseClient();
    
    // Configura um nome único para o arquivo
    const fileExt = req.file.originalname.split('.').pop() || 'png';
    const fileName = `${id}-${Date.now()}.${fileExt}`;
    const filePath = `stickers/${fileName}`;

    // Faz upload pro Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('eloscloud-public')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Pega a URL pública
    const { data: { publicUrl } } = supabase
      .storage
      .from('eloscloud-public')
      .getPublicUrl(filePath);

    // Atualiza o registro do sticker
    const { data: updated, error: updateError } = await supabase
      .from('sticker_catalog')
      .update({ image_url: publicUrl })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.status(200).json(updated);
  } catch (error) {
    logger.error('Erro ao fazer upload de imagem do sticker', { id, error: error.message });
    res.status(500).json({ message: error.message });
  }
};
