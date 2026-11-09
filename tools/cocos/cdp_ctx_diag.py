# -*- coding: utf-8 -*-
"""CDP 诊断（robust 版）：跟踪最新主世界执行上下文，避免打到死上下文"""
import asyncio
import json
import urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PORT = 9227
URL = None


async def main():
    with OPENER.open(f'http://127.0.0.1:{PORT}/json') as r:
        targets = json.load(r)
    pages = [t for t in targets if t.get('type') == 'page' and URL in t.get('url', '')] \
        or [t for t in targets if t.get('type') == 'page']
    page = pages[-1]
    import websockets
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=50 * 1024 * 1024) as ws:
        st = {"id": 0}
        ctx = {"main": None}

        async def recv_until(pred):
            while True:
                msg = json.loads(await ws.recv())
                if pred(msg):
                    return msg

        async def call(method, params=None, session=None, context=None):
            st["id"] += 1
            m = {"id": st["id"], "method": method, "params": params or {}}
            if session:
                m["sessionId"] = session
            await ws.send(json.dumps(m))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == st["id"]:
                    return msg

        async def js(expr):
            p = {"expression": expr, "returnByValue": True,
                 "awaitPromise": True, "userGesture": True}
            if ctx["main"]:
                p["contextId"] = ctx["main"]
            r = await call("Runtime.evaluate", p)
            if "exceptionDetails" in r:
                return "EXC: " + str(r["exceptionDetails"].get("exception", {}).get("description", ""))[:250]
            return r.get("result", {}).get("value")

        async def pump(sec):
            try:
                for _ in range(int(sec * 4)):
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.25))
                    m = msg.get("method", "")
                    p = msg.get("params", {})
                    if m == "Runtime.executionContextCreated":
                        c = p["context"]
                        if not c.get("auxData", {}).get("isDefault", True) is False or c.get("name") in ("main", None):
                            if c.get("auxData", {}).get("isDefault", True):
                                ctx["main"] = c["id"]
                    elif m == "Runtime.consoleAPICalled":
                        args = [a.get("value", a.get("description", "")) for a in p.get("args", [])]
                        print("  [log]", " | ".join(str(a)[:160] for a in args))
                    elif m == "Runtime.exceptionThrown":
                        d = p["exceptionDetails"]
                        print("  [EXC]", str(d.get("exception", {}).get("description", d))[:200])
            except asyncio.TimeoutError:
                pass

        await call("Runtime.enable")
        await call("Page.enable")
        await pump(60)
        print("---- 状态 ----")
        print("ctx:", ctx["main"])
        print("hatchDemo:", await js("typeof window.hatchDemo"))
        if await js("typeof window.hatchDemo") == "object":
            print("stage:", await js("hatchDemo.stage()"))
            print("scene tree:", await js("""
(()=>{const s=cc.director.getScene();const out=[];
 function dig(n,d){out.push('  '.repeat(d)+n.name+' pos='+n.position.toString()+' scl='+n.scale.toString());
  n.children.forEach(c=>dig(c,d+1));}
 s.children.forEach(c=>{if(c.name==='DemoHolder')dig(c,0);});
 return out.join('\\n');})()"""))

asyncio.run(main())
