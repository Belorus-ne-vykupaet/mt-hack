"""Dispatcher hypotheses require an observable signal available at issue time."""

from transit_ml.backend import suspected_cause


def test_suspected_cause_uses_only_observed_dwell_speed_and_prior_delay():
    clear = {"dwell_s": 0, "speed_mean_120": 35}
    assert suspected_cause(clear, None) is None
    assert suspected_cause(clear, 0) is None
    assert suspected_cause(clear, 150) == "ранее накопленное опоздание"
    assert suspected_cause({**clear, "speed_mean_120": 6}, 150) == "замедленное движение на подходе"
    assert suspected_cause({**clear, "dwell_s": 95}, 150) == "продолжительная стоянка у остановки"
