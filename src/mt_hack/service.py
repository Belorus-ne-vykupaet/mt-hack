"""Independent ML inference service. Swagger: /docs."""
from functools import lru_cache
import os
import time
from datetime import datetime
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, model_validator
from mt_hack.features import build_features,TRAFFIC_COLUMNS,PLAN_COLUMNS
from mt_hack.model import Predictor

app=FastAPI(title='Transport ML',version='0.1.0')


class Point(BaseModel):
    sample_id:str
    tr_id:int
    T:datetime
    target_stop_id:int
    target_time_begin:datetime
    cur_dev_s:float=Field(allow_inf_nan=False)

    @model_validator(mode='after')
    def horizon(self):
        try: delta=(self.target_time_begin-self.T).total_seconds()
        except TypeError as e: raise ValueError('T and target time must use consistent timezone awareness') from e
        if not 600<delta<=900:raise ValueError('Target horizon must be in (600,900] seconds')
        return self


class Telemetry(BaseModel):
    tr_id:int
    event_time:datetime
    location_valid:bool=False
    lon:float|None=None
    lat:float|None=None
    speed:float|None=None
    heading:float|None=None


class PlanStop(BaseModel):
    tt_action_item_id:int
    tr_id:int
    time_begin:datetime
    geom:str


class PredictRequest(BaseModel):
    point:Point
    telemetry:list[Telemetry]=Field(default_factory=list,max_length=10000)
    schedule:list[PlanStop]=Field(min_length=1,max_length=10000)


@lru_cache
def get_predictor():return Predictor(os.environ.get('MODEL_PATH','artifacts/model'))


@app.get('/health')
def health():
    try:get_predictor()
    except (FileNotFoundError,RuntimeError) as e:raise HTTPException(503,'Model unavailable; run training first') from e
    return {'status':'ok','model':'causal-gru-ensemble'}


@app.post('/predict')
def predict(request:PredictRequest):
    start=time.perf_counter()
    point=pd.DataFrame([request.point.model_dump(mode='json')])
    traffic=pd.DataFrame([r.model_dump(mode='json') for r in request.telemetry],columns=TRAFFIC_COLUMNS)
    plan=pd.DataFrame([r.model_dump(mode='json') for r in request.schedule],columns=PLAN_COLUMNS)
    p=request.point
    if not any(s.tr_id==p.tr_id and s.tt_action_item_id==p.target_stop_id and s.time_begin==p.target_time_begin for s in request.schedule):
        raise HTTPException(422,'Target stop/time is not present in schedule')
    x,seq=build_features(point,traffic,plan)
    try:result=get_predictor().predict(x,seq)
    except FileNotFoundError as e:raise HTTPException(503,'Model unavailable') from e
    reasons=[]
    if x.gps_age_s.iloc[0]>180:reasons.append('Устаревшие или отсутствующие координаты')
    if x.stop_frac_300.iloc[0]>.65:reasons.append('Длительное движение с почти нулевой скоростью')
    if x.speed_mean_60.iloc[0]<.5*x.speed_mean_600.iloc[0]:reasons.append('Снижение скорости относительно последних 10 минут')
    if p.cur_dev_s>120:reasons.append('Уже накоплена задержка более двух минут')
    return {'sample_id':p.sample_id,'prediction_s':float(result['prediction'][0]),
        'neural_late_probability':float(result['neural_late_probability'][0]),
        'neural_q10_s':float(result['q10_s'][0]),'neural_q90_s':float(result['q90_s'][0]),
        'forecast_time':p.T.isoformat(),'target_time':p.target_time_begin.isoformat(),
        'horizon_s':(p.target_time_begin-p.T).total_seconds(),
        'telemetry_age_s':float(x.telemetry_age_s.iloc[0]),
        'data_status':'stale' if x.telemetry_age_s.iloc[0]>180 else 'fresh',
        'observed_patterns':reasons,'patterns_are_causal_explanations':False,
        'probability_is_calibrated':False,'latency_ms':(time.perf_counter()-start)*1000}
