"""Minimal integration API; live NDTP ingestion and dashboard are future work."""
import os
from fastapi import FastAPI,HTTPException
import httpx
from mt_hack.service import PredictRequest

app=FastAPI(title='Transport Backend',version='0.1.0')
ML_URL=os.environ.get('ML_URL','http://localhost:8001')


@app.get('/health')
async def health():
    async with httpx.AsyncClient(timeout=2) as client:
        try:
            r=await client.get(f'{ML_URL}/health');r.raise_for_status()
            return {'status':'ok','ml':r.json()}
        except httpx.HTTPError:
            return {'status':'degraded','ml':'unavailable'}


@app.post('/api/predict')
async def predict(request:PredictRequest):
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            r=await client.post(f'{ML_URL}/predict',json=request.model_dump(mode='json'))
            if r.status_code==422:raise HTTPException(422,r.json())
            r.raise_for_status();return r.json()
        except httpx.HTTPError:
            # Explicit degraded prediction from the supplied last known delay.
            return {'sample_id':request.point.sample_id,'prediction_s':request.point.cur_dev_s,
                    'data_status':'degraded','model':'persistence_fallback',
                    'forecast_time':request.point.T.isoformat(),
                    'horizon_s':(request.point.target_time_begin-request.point.T).total_seconds(),
                    'reason':'ML service unavailable'}
