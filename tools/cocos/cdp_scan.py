# -*- coding: utf-8 -*-
"""CDP：相机距离扫描 + 状态诊断"""
import asyncio
import json
import base64
import urllib.request
import websockets

PORT = 9226
OUT = r"E:/git/PetCompanionship/tools/cocos/shots"


async def main():
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json') as r:
        targets = json.load(r)
    page = next(t for t in targets if t.get('type') == 'page')
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
            return r.get("result", {}).get("value")

        async def shot(name):
            s = await call("Page.captureScreenshot", {"format": "png"})
            with open(f"{OUT}/{name}.png", "wb") as f:
                f.write(base64.b64decode(s["data"]))
            print("saved", name)

        await asyncio.sleep(14)

        # 诊断：模型世界变换 / 相机位置 / 包围盒
        print(await js("""
        (function(){
          var s = cc.director.getScene();
          var holder = cc.find('PetRigDemo/PetHolder');
          var cam = cc.find('Main Camera');
          var info = {cam: cam ? cam.worldPosition.toString() : null};
          if (holder) {
            var p = holder.children[0];
            if (p) {
              info.petPos = p.worldPosition.toString();
              info.petScale = p.worldScale.toString();
              var mr = p.getComponentInChildren(cc.MeshRenderer);
              if (mr && mr.mesh && mr.mesh.bounds) {
                var b = mr.mesh.bounds;
                info.boundsCenter = b.center.toString();
                info.boundsHalf = b.halfExtents.toString();
              }
            }
          }
          return JSON.stringify(info);
        })()
        """))

        # 隐藏 UI
        await js("""
        cc.director.getScene().children.forEach(function(n){
          if(n.name==='Canvas'||n.name==='PROFILER_NODE') n.active=false;
        });
        """)

        for z in (2.2, 3.2, 4.5):
            await js(f"cc.find('Main Camera').setPosition(0,0.45,{z});")
            await asyncio.sleep(0.4)
            await shot(f"scan_z{int(z*10)}")

        print(await js("cc.find('Main Camera').worldPosition.toString()"))


asyncio.run(main())
