-- ============================================================
-- Fix: prediction_entries.game_id ON DELETE CASCADE
-- Sem CASCADE, deletar um jogo com palpites retorna FK violation.
-- ============================================================

ALTER TABLE public.prediction_entries
  DROP CONSTRAINT prediction_entries_game_id_fkey,
  ADD CONSTRAINT prediction_entries_game_id_fkey
    FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;
