-- 20260615000003_fix_selection_list_items.sql
-- Migra itens de games.config->'items' (array de strings) para selection_list_items.
-- Cobre jogos SELECTION_LIST criados antes da correção do wizard (item batch).
-- É idempotente: só insere onde ainda não existem itens na tabela.

INSERT INTO public.selection_list_items (game_id, label, display_order, created_at)
SELECT
  g.id                     AS game_id,
  arr.item_text            AS label,
  (arr.ord - 1)::integer   AS display_order,
  NOW()                    AS created_at
FROM public.games g
CROSS JOIN LATERAL
  jsonb_array_elements_text(g.config -> 'items') WITH ORDINALITY AS arr(item_text, ord)
WHERE g.game_type = 'SELECTION_LIST'
  AND g.config ? 'items'
  AND jsonb_array_length(g.config -> 'items') > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.selection_list_items sli WHERE sli.game_id = g.id
  );
