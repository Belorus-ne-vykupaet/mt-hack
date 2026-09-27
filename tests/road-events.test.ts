import { describe, expect, it, vi } from "vitest";
import { aheadCorridors, eventAhead, pathPoint, type RoadEvent } from "../src/entities/road-events";
import { RoadMonitor, parseRoadEvents } from "../server/road-monitor";
import { GigachatAdvisor } from "../server/gigachat";
import type { Geometry, Route, Vehicle } from "../src/entities/models";
const now = Date.now();
const geometry: Geometry = {routeId: "r", coordinates: [[37,55],[37.1,55]]};
const vehicle: Vehicle = {id:"bus",routeId:"r",position:{lon:37.02,lat:55},nextStop:{id:"stop",name:"Площадь",sequence:1,position:{lon:37.09,lat:55}},speedKmh:20,currentDelaySec:30,predictedDelaySec:60,riskProbability:.1,riskLevel:"normal",updatedAt:new Date(now).toISOString()};
const route: Route = {id:"r",number:"1",name:"Площадь",stops:[vehicle.nextStop!],activeVehicleCount:1,currentDelaySec:30,predictedDelaySec:60,riskProbability:.1,riskLevel:"normal",transportType:"bus"};
const event: RoadEvent = {id:"accident",kind:"accident",source:"event-feed",position:{lon:37.03,lat:55},description:"Одна полоса закрыта",observedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()};
const analyze = vi.fn(async () => ({analysis:"Тестовое ДТП впереди автобуса.", recommendation:"Уточните обстановку у водителя."}));
const advisor = {configured:true,analyzeRoadEvent:analyze};

describe("road events ahead of a bus", () => {
  it("excludes events behind, on a nearby road, expired and in the opposite direction", () => {
    const corridor = aheadCorridors([vehicle],[geometry])[0];
    expect(eventAhead(event,corridor,now)).toBeGreaterThan(600);
    for (const change of [
      {position:{lon:37.01,lat:55}}, {position:{lon:37.03,lat:55.001}},
      {bearingDeg:270}, {expiresAt:new Date(now-1).toISOString()},
      {observedAt:new Date(now-700000).toISOString()},
    ]) expect(eventAhead({...event,...change},corridor,now)).toBeNull();
    expect(aheadCorridors([{...vehicle,telemetryStale:true}],[geometry])).toEqual([]);
  });
  it("follows reverse travel along the same road and refuses unknown direction", () => {
    const reverse = {...vehicle,nextStop:{...vehicle.nextStop!,position:{lon:37,lat:55}}};
    const corridor = aheadCorridors([reverse],[geometry])[0];
    expect(eventAhead({...event,position:{lon:37.01,lat:55}},corridor,now)).toBeGreaterThan(600);
    expect(eventAhead(event,corridor,now)).toBeNull();
    expect(aheadCorridors([{...vehicle,nextStop:null}],[geometry])).toEqual([]);
    expect(pathPoint(corridor.path,0)).toEqual({lon:37,lat:55});
  });
  it("validates feed events and never accepts caller-supplied source or invalid coordinates", () => {
    expect(parseRoadEvents({items:[{...event,source:"demo"}]})).toMatchObject([{source:"event-feed"}]);
    expect(parseRoadEvents({items:[{...event,position:{lat:NaN,lon:37}}, {...event,kind:"camera"}]})).toEqual([]);
    expect(() => parseRoadEvents({})).toThrow();
  });
  it("demonstrates analysis without modifying vehicle predictions, deduplicates and clears it", async () => {
    analyze.mockClear();
    const monitor = new RoadMonitor(advisor);
    const original = structuredClone(vehicle);
    const [notice, again] = await Promise.all([monitor.demo("bus",[vehicle],[route],[geometry]),monitor.demo("bus",[vehicle],[route],[geometry])]);
    expect(notice).toBe(again);
    expect(notice).toMatchObject({delayStatus:"indefinite",delaySec:null,analysisStatus:"ready",event:{source:"demo"}});
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(vehicle).toEqual(original);
    await monitor.demo("bus",[vehicle],[route],[geometry]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(monitor.state()).toMatchObject({configured:false,status:"needs_key",usedInModel:false});
    expect(monitor.state().items).toHaveLength(1);
    monitor.clearDemo(); expect(monitor.state().items).toHaveLength(0);
  });
  it("still notifies when GigaChat fails, without claiming an AI analysis", async () => {
    const monitor = new RoadMonitor({configured:true,analyzeRoadEvent:async () => {throw new Error("offline");}});
    const notice = await monitor.demo("bus",[vehicle],[route],[geometry]);
    expect(notice.analysisStatus).toBe("unavailable"); expect(notice.analysis).toBeUndefined();
  });
  it("polls a feed once per sweep and handles failure as unavailable", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({items:[event]}))) as unknown as typeof fetch;
    const monitor = new RoadMonitor(advisor,{eventsUrl:"https://example.test/events",fetcher});
    await Promise.all([monitor.refresh([vehicle],[route],[geometry]),monitor.refresh([vehicle],[route],[geometry])]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(monitor.state().items).toHaveLength(1);
    const failed = new RoadMonitor(advisor,{eventsUrl:"https://example.test/events",fetcher:async () => {throw new Error("secret-url");}});
    await failed.refresh([vehicle],[route],[geometry]);
    expect(failed.state().status).toBe("unavailable"); expect(JSON.stringify(failed.state())).not.toContain("secret-url");
  });
  it("uses actual traffic on the road ahead, not the first two route stops, and does not invent an accident", async () => {
    const urls: URL[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); urls.push(url);
      return new Response(JSON.stringify({traffic_type:"realtime",route:{legs:[{status:"OK",steps:[{
        duration:url.searchParams.has("traffic") ? 100 : 400,
        polyline:{points:url.searchParams.get("waypoints")!.split("|").map(p=>p.split(",").map(Number))},
      }]}]}}));
    }) as unknown as typeof fetch;
    const monitor = new RoadMonitor(advisor,{routerKey:"private-test-key",fetcher});
    await monitor.refresh([vehicle],[route],[geometry]);
    expect(urls).toHaveLength(2);
    expect(urls[0].searchParams.get("waypoints")!.split("|")[0]).toBe("55,37.02");
    expect(monitor.state().items[0].event).toMatchObject({kind:"congestion",source:"yandex-router"});
    expect(JSON.stringify(monitor.state())).not.toContain("private-test-key");
  });
  it("does not turn non-comparable routes or free flow into an incident", async () => {
    for (const different of [true,false]) {
      const monitor = new RoadMonitor(advisor,{routerKey:"test",fetcher:async input => {
        const free = new URL(String(input)).searchParams.has("traffic");
        return new Response(JSON.stringify({traffic_type:"realtime",route:{legs:[{status:"OK",steps:[{
          duration: different ? (free ? 100:500) : 120,
          polyline:{points:[[55,37.02],[55,different && free ? 37.04 : 37.05]]},
        }]}]}}));
      }});
      await monitor.refresh([vehicle],[route],[geometry]); expect(monitor.state().items).toEqual([]);
    }
  });
  it("sends incident facts to GigaChat and validates its response", async () => {
    const prompts: string[] = [];
    const gigachat = new GigachatAdvisor("test",undefined,undefined,async (url, options) => {
      if (String(url).includes("oauth")) return new Response(JSON.stringify({access_token:"token",expires_at:Date.now()+600000}));
      prompts.push(String(options?.body));
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({analysis:"Тестовое ДТП.",recommendation:"Уточните обстановку."})}}]}));
    });
    const monitor = new RoadMonitor(gigachat);
    expect((await monitor.demo("bus",[vehicle],[route],[geometry])).analysisStatus).toBe("ready");
    const request = JSON.parse(prompts[0]);
    expect(JSON.parse(request.messages[1].content)).toMatchObject({event:{source:"demo"},delayStatus:"indefinite",usedInModel:false});
  });
});
