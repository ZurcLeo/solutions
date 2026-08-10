-- =====================================================
-- Migration: Pet extra seat support
-- Date: 2026-08-05
-- Description: Adds seats_booked and is_pet_seat columns
--              to carona_seats, and updates book/release RPCs
--              to support multi-seat bookings (pet = +1 vaga).
-- =====================================================

-- 1. Add columns to carona_seats
ALTER TABLE public.carona_seats
    ADD COLUMN IF NOT EXISTS seats_booked  INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_pet_seat   BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.carona_seats.seats_booked IS
    'Number of physical seats this booking occupies (2 when pet_extra_seat).';
COMMENT ON COLUMN public.carona_seats.is_pet_seat IS
    'True when passenger is booking with a pet that requires an extra seat.';

-- 2. Update book_carona_seat RPC to accept p_seats_count
CREATE OR REPLACE FUNCTION public.book_carona_seat(
    p_ride_id       TEXT,
    p_passenger_id  TEXT,
    p_seats_count   INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ride   RECORD;
    v_rows   INTEGER;
BEGIN
    -- Validate seats_count
    IF p_seats_count < 1 OR p_seats_count > 2 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_seats_count',
            'message', 'seats_count deve ser 1 ou 2.');
    END IF;

    -- 1. Verifica se a viagem existe e está aberta
    SELECT * INTO v_ride
    FROM public.carona_rides
    WHERE id = p_ride_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_found',
            'message', 'Viagem não encontrada.');
    END IF;

    IF v_ride.status NOT IN ('open') THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_available',
            'message', 'Esta viagem não está mais aceitando passageiros.');
    END IF;

    -- 2. Verifica se passageiro não é o motorista
    IF p_passenger_id = v_ride.driver_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'self_booking',
            'message', 'Motorista não pode reservar vaga na própria viagem.');
    END IF;

    -- 3. Verifica se já tem reserva
    IF EXISTS (
        SELECT 1 FROM public.carona_seats
        WHERE ride_id = p_ride_id
          AND passenger_id = p_passenger_id
          AND status NOT IN ('cancelled_passenger', 'cancelled_driver')
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'already_booked',
            'message', 'Você já tem uma reserva nesta viagem.');
    END IF;

    -- 4. Decremento atômico — previne race condition
    UPDATE public.carona_rides
    SET    seats_available = seats_available - p_seats_count
    WHERE  id = p_ride_id
      AND  seats_available >= p_seats_count
      AND  status = 'open';

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'no_seats',
            'message', 'Não há vagas suficientes nesta viagem.');
    END IF;

    RETURN jsonb_build_object('success', true, 'seats_remaining',
        (SELECT seats_available FROM public.carona_rides WHERE id = p_ride_id));

EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_booked',
        'message', 'Você já tem uma reserva nesta viagem.');
END;
$$;

COMMENT ON FUNCTION public.book_carona_seat(TEXT, TEXT, INTEGER) IS
    '[CARONA-002] Reserva atômica de vaga(s). p_seats_count=2 para pet extra seat. '
    'UPDATE ... WHERE seats_available >= p_seats_count elimina race condition de overbooking.';

GRANT EXECUTE ON FUNCTION public.book_carona_seat(TEXT, TEXT, INTEGER) TO authenticated;

-- Drop old 2-arg signature (replaced by 3-arg with default)
DROP FUNCTION IF EXISTS public.book_carona_seat(TEXT, TEXT);


-- 3. Update release_carona_seat RPC to accept p_seats_count
CREATE OR REPLACE FUNCTION public.release_carona_seat(
    p_ride_id       TEXT,
    p_seats_count   INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.carona_rides
    SET    seats_available = LEAST(seats_available + p_seats_count, total_seats)
    WHERE  id = p_ride_id
      AND  status IN ('open', 'full');
    -- Trigger trg_carona_rides_seats_sync cuida de full → open
END;
$$;

COMMENT ON FUNCTION public.release_carona_seat(TEXT, INTEGER) IS
    '[CARONA-002] Devolve vaga(s) quando passageiro cancela. '
    'p_seats_count para suportar cancelamento de pet extra seat. '
    'LEAST previne seats_available > total_seats.';

-- Drop old 1-arg signature
DROP FUNCTION IF EXISTS public.release_carona_seat(TEXT);
