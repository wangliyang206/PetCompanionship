# -*- coding: utf-8 -*-
"""CDP：孵化演示定向诊断（蛋 prefab 加载 + 控制台错误捕获）"""
import asyncio
import json
import urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PORT = 9227


async def main():
    with OPENER.open(f'http://127.0.0.1:{PORT}/json/version') as r:
        ver = json.load(r)
    import websockets
    async with websockets.connect(ver['webSocketDebuggerUrl'], max_size=50 * 1024 * 1024) as ws:
        st = {"id": 0}

        async def call(method, params=None, session=None):
            st["id"] += 1
            m = {"id": st["id"], "method": method, "params": params or {}}
            if session:
                m["sessionId"] = session
            await ws.send(json.dumps(m))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == st["id"]:
                    return msg

        ev = await call("Target.createTarget", {"url": "http://127.0.0.1:8766/index.html"})
        tid = ev["result"]["targetId"]
        r = await call("Target.attachToTarget", {"targetId": tid, "flatten": True})
        sess = r["result"]["sessionId"]
        await call("Runtime.enable", session=sess)

        async def js(expr):
            r = await call("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                                "awaitPromise": True}, session=sess)
            res = r.get("result", {})
            if "exceptionDetails" in r:
                print("JS异常:", str(r["exceptionDetails"].get("exception", {}).get("description", ""))[:400])
                return None
            return res.get("value")

        logs = []

        async def drain(sec):
            try:
                for _ in range(int(sec * 2)):
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.5))
                    if msg.get("method") == "Runtime.consoleAPICalled":
                        p = msg["params"]
                        args = [a.get("value", a.get("description", "")) for a in p.get("args", [])]
                        logs.append(f"[{p.get('type')}] " + " | ".join(str(a)[:200] for a in args))
                    elif msg.get("method") == "Runtime.exceptionThrown":
                        d = msg["params"]["exceptionDetails"]
                        logs.append("[EXC] " + str(d.get("exception", {}).get("description", d))[:300])
            except asyncio.TimeoutError:
                pass

        await drain(12)   # 等场景+蛋
        print("== 启动期控制台 ==")
        print("\n".join(logs[-25:]) or "(无)")

        print("\n== 状态 ==")
        print("stage:", await js("window.hatchDemo && hatchDemo.stage()"))

        # 1) 验证蛋 prefab 路径
        print("\n== 蛋 prefab 试载 ==")
        r = await js("""
new Promise(res => {
  resources.load('models/mao_tuantuan/mao_tuantuan_egg', Prefab, (e, p) => {
    res('err=' + (e ? (e.message || e) : 'null') + ' prefab=' + !!p);
  });
})
""")
        print(r)

        # 2) 幼崽 prefab 路径
        r = await js("""
new Promise(res => {
  resources.load('models/tuantuan_rig/tuantuan_rig', Prefab, (e, p) => {
    res('err=' + (e ? (e.message || e) : 'null') + ' prefab=' + !!p);
  });
})
""")
        print(r)

        # 3) 触发孵化并观察
        await js("window.hatchDemo && hatchDemo.hatch()")
        await drain(6)
        print("\n== 孵化后 ==")
        print("stage:", await js("hatchDemo && hatchDemo.stage()"))
        print("clips:", await js("window.__petClips"))
        logs.clear()
        await drain(8)
        print("\n== 后续控制台 ==")
        print("\n".join(logs[-25:]) or "(无)")

asyncio.run(main())
