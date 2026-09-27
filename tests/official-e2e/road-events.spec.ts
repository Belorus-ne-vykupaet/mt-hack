import {test, expect} from "@playwright/test";

test("test road incident shows unknown delay and GigaChat advice, also on overview", async ({page,request}) => {
  const fleet = (await (await request.get("/api/v1/vehicles")).json()).items;
  const vehicle = fleet.find((v: {next_stop: unknown; status: string}) => v.next_stop && v.status !== "stale");
  const now = new Date().toISOString();
  const state = {configured:false,status:"needs_key",checkedAt:null,usedInModel:false,items: [] as object[]};
  const errors: string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/v1/dispatch/advice*",r=>r.fulfill({json:{configured:false}}));
  await page.route("**/api/v1/traffic/notifications",r=>r.fulfill({json:state}));
  await page.route("**/api/v1/traffic/demo",r=>{
    const body=r.request().postDataJSON();
    state.items=body.clear?[]:[{id:"test",vehicleId:body.vehicleId,routeId:vehicle.route_id,routeNumber:"1",distanceM:650,
      delayStatus:"indefinite",delaySec:null,analysisStatus:"ready",analysis:"Тестовое ДТП впереди автобуса.",recommendation:"Уточните обстановку у водителя.",observedAt:now,expiresAt:new Date(Date.now()+300000).toISOString(),
      event:{id:"test",kind:"accident",source:"demo",description:"Одна полоса перекрыта",observedAt:now,expiresAt:new Date(Date.now()+300000).toISOString(),position:vehicle.position}}];
    return r.fulfill({json:state});
  });
  await page.goto("/dispatch?source=official&visual-test=1");
  const panel = page.getByRole("region",{name:"Дорожные события"});
  await expect(panel).toContainText("Живой источник не подключён");
  await panel.getByLabel("Автобус для тестового ДТП").selectOption(vehicle.id);
  await panel.getByRole("button",{name:"Тестовое ДТП",exact:true}).click();
  await expect(panel).toContainText("Задержка не определена");
  await expect(panel).toContainText("Тестовое событие");
  await expect(panel).toContainText("GigaChat");
  await panel.getByRole("button",{name:"На карте",exact:true}).click();
  await expect(page).toHaveURL(/overview/);
  await expect(page.getByRole("region",{name:"Дорожные события"})).toContainText("Задержка не определена");
  await page.getByRole("link",{name:"Диспетчер",exact:true}).click();
  await panel.getByRole("button",{name:"Убрать тест",exact:true}).click();
  await expect(panel.locator(".traffic-notice")).toHaveCount(0);
  expect(errors).toEqual([]);
});
