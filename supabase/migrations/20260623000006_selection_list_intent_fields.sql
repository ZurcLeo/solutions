-- 20260623000006_selection_list_intent_fields.sql
-- Marketplace de Intenção: campos opcionais de intenção em itens da Lista de Seleção.
-- Permite vincular itens a categorias, faixa de preço e raio de entrega,
-- resolvendo sugestões de produtos em tempo de execução.

ALTER TABLE selection_list_items
  ADD COLUMN IF NOT EXISTS item_category_slug  TEXT,
  ADD COLUMN IF NOT EXISTS item_category_label TEXT,
  ADD COLUMN IF NOT EXISTS price_range_min     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS price_range_max     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS delivery_range_km   INTEGER DEFAULT 10;

COMMENT ON COLUMN selection_list_items.item_category_slug  IS 'Slug estruturado da categoria (alimentacao, servicos, produtos, etc)';
COMMENT ON COLUMN selection_list_items.item_category_label IS 'Texto livre para exibição da categoria (ex: Fralda tamanho P)';
COMMENT ON COLUMN selection_list_items.price_range_min     IS 'Preço mínimo da faixa de intenção (BRL)';
COMMENT ON COLUMN selection_list_items.price_range_max     IS 'Preço máximo da faixa de intenção (BRL)';
COMMENT ON COLUMN selection_list_items.delivery_range_km   IS 'Raio máximo de entrega em km (default 10)';
