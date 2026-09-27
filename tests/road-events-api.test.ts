import {expect,it} from "vitest";
import {createApi} from "../server/app";
import {csvGeometries,csvSnapshot} from "../src/mocks/csv-scenario";
import {mapGeometry,mapVehicle} from "../src/entities/adapters";
import {aheadCorridors} from "../src/entities/road-events";

it("keeps demo incidents separate from predictions and protects writes", async () => {
  const token="test-road-events-token-123456";
  const api=createApi({frozen:true,token,publicRead:true});
  await new Promise<void>(resolve=>api.server.listen(0,"127.0.0.1",resolve));
  const url=`http://127.0.0.1:${(api.server.address() as {port:number}).port}/api/v1`;
  try {
    const vehicle=aheadCorridors(csvSnapshot(900).vehicles.map(mapVehicle),csvGeometries.map(mapGeometry))[0].vehicle;
    const before=await (await fetch(`${url}/vehicles`)).json();
    const post=(body:object,auth=true)=>fetch(`${url}/traffic/demo`,{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
    expect((await post({vehicleId:vehicle.id},false)).status).toBe(401);
    expect((await post({vehicleId:"missing"})).status).toBe(404);
    const response=await post({vehicleId:vehicle.id});expect(response.status).toBe(200);
    const state=await response.json();
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({delaySec:null,delayStatus:"indefinite",analysisStatus:"unavailable",event:{source:"demo"}});
    expect(await (await fetch(`${url}/vehicles`)).json()).toEqual(before);
    expect((await (await fetch(`${url}/traffic/notifications`)).json()).items).toHaveLength(1);
    expect((await (await post({clear:true})).json()).items).toEqual([]);
  } finally {await api.close();}
});
