# -*- coding: utf-8 -*-
"""CDP 标定：孵化后按已知 scale 截图，实测宠物屏高占比；抓 SMR 网格包围盒"""
import asyncio, json, base64, os, urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PORT = 9227
OUT = r"E:/git/PetCompanionship/tools/cocos/shots_hatch"


async def main():
    os.makedirs(OUT, exist_ok=True)
    with OPENER.open(f'http://127.0.0.1:{PORT}/json') as r:
        targets = json.load(r)
    page = next(t for t in targets if t.get('type') == 'page')
    import websockets
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=50 * 1024 * 1024) as ws:
        mid = 0

        async def call(method, params=None):
            nonlocal mid
            mid += 1
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == mid:
                    return msg.get("result", {})

        async def js(expr):
            r = await call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
            res = r.get("result", {})
            if "exceptionDetails" in r:
                print("JS 异常:", json.dumps(r["exceptionDetails"], ensure_ascii=False)[:300])
            return res.get("value")

        async def shot(name):
            s = await call("Page.captureScreenshot", {"format": "png"})
            open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(s["data"]))
            print("saved", name)

        for _ in range(60):
            if await js("window.hatchDemo ? hatchDemo.stage() : null") == 'egg':
                break
            await asyncio.sleep(1)
        await js("hatchDemo.hatch()")
        for _ in range(60):
            if await js("hatchDemo.stage()") == 'pet':
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(2.0)

        # SMR 网格包围盒（local 空间）+ 骨骼关节最高点
        print("== SMR bounds ==")
        print(await js("JSON.stringify((function(){var out=[];var pet=null;cc.director.getScene().walk(function(n){if(n.name==='tuantuan_rig')pet=n;});if(!pet)return 'no pet';pet.walk(function(n){n.components.forEach(function(c){if(c&&c.mesh&&c.mesh.struct&&c.isSkinnedMeshRenderer!==undefined||c&&c.skinningRoot){out.push({node:n.name,min:c.mesh&&c.mesh.struct?c.mesh.struct.minPosition:null,max:c.mesh&&c.mesh.struct?c.mesh.struct.maxPosition:null});}});});var top=0;pet.walk(function(n){var p=n.worldPosition;if(p.y>top)top=p.y;});out.push({jointTopY:+top.toFixed(3),petScale:pet.scale.x});return out;}()))"))

        for s in ("1.0", "2.0"):
            await js(f"(function(){{var pet=null;cc.director.getScene().walk(function(n){{if(n.name==='tuantuan_rig')pet=n;}});if(pet)pet.setScale({s},{s},{s});}})()")
            await asyncio.sleep(1.2)
            await shot(f"cal_scale_{s.replace('.', '')}")
        print("[done]")


asyncio.run(main())
