const { getSupabaseClient } = require('../config/supabase');

exports.listStickers = async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('sticker_catalog')
      .select('*')
      .eq('is_active', true)
      .order('rarity', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
