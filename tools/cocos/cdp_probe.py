# -*- coding: utf-8 -*-
"""CDP 实验定责：谁最终上屏 / fov·aspect 实况 / 蛋 mesh 是否为空"""
import asyncio, json, base64, os, urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PORT = 9227
OUT = r"E:/git/PetCompanionship/tools/cocos/shots_hatch"

CAM_LIST = ("JSON.stringify((function(){var out=[];"
            "cc.director.getScene().walk(function(n){n.components.forEach(function(c){"
            "if(c&&typeof c.fov==='number'&&c.clearFlags!==undefined){"
            "out.push({node:n.name,pri:c.priority,fovAxis:c.fovAxis,fov:c.fov,"
            "aspect:c.aspect,vis:c.visibility,clear:c.clearFlags,"
            "enabled:c.enabled,layer:n.layer,"
            "pos:[+n.worldPosition.x.toFixed(2),+n.worldPosition.y.toFixed(2),+n.worldPosition.z.toFixed(2)]});}});});"
            "return out;}()))")


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
        await asyncio.sleep(1.5)

        print("== 相机实况 ==", await js(CAM_LIST))
        print("== 蛋 mesh ==", await js("(function(){var n=cc.director.getScene().getChildByName('PetRigDemo');var h=null;n.walk(function(c){if(c.name==='EggModel')h=c;});if(!h)return 'no node';var mr=h.getComponent(cc.MeshRenderer);return JSON.stringify({mesh:mr.mesh?!!mr.mesh.struct:false,renderable:!!mr.mesh});})()"))

        # 实验1：DemoCamera 清屏改红 —— 看最终上屏的是谁
        await js("(function(){cc.director.getScene().walk(function(n){n.components.forEach(function(c){if(c&&n.name==='DemoCamera'&&typeof c.fov==='number'){c.clearColor=cc.Color.RED;}});});})()")
        await asyncio.sleep(1.0)
        await shot("x1_red_test")

        # 实验2：手动设 DemoCamera aspect + 宠物缩小到 1.5
        await js("(function(){cc.director.getScene().walk(function(n){n.components.forEach(function(c){if(c&&n.name==='DemoCamera'&&typeof c.fov==='number'){c.clearColor=new cc.Color(232,237,244,255);c.aspect=1258/646;}});});var d=cc.find('PetRigDemo/DemoHolder/tuantuan_rig')||cc.director.getScene();var pet=null;d.walk(function(c){if(c.name==='tuantuan_rig')pet=c;});if(pet)pet.setScale(1.5,1.5,1.5);})()")
        await asyncio.sleep(1.5)
        await shot("x2_aspect_scale15")
        print("== 相机实况2 ==", await js(CAM_LIST))


asyncio.run(main())
