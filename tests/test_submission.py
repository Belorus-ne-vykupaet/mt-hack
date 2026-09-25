import numpy as np
import pandas as pd
import pytest
from mt_hack.predict import validate_submission


def test_negative_delays_are_kept():
    s=pd.DataFrame({'sample_id':['a','b'],'prediction':[-42.,123.]})
    validate_submission(s,s)


@pytest.mark.parametrize('kind',['duplicate','missing','nan','extra_column'])
def test_invalid_submission_rejected(kind):
    template=pd.DataFrame({'sample_id':['a','b'],'prediction':[0.,0.]});s=template.copy()
    if kind=='duplicate':s.sample_id=['a','a']
    if kind=='missing':s=s.iloc[:1]
    if kind=='nan':s.loc[0,'prediction']=np.nan
    if kind=='extra_column':s['target']=0
    with pytest.raises(ValueError):validate_submission(s,template)
