# -*- coding: utf-8 -*-
"""通过 Chrome DevTools Protocol 诊断 Cocos 页面：执行 JS、截图"""
import asyncio
import json
import base64
import sys
import urllib.request
import websockets

PORT = 9223


async def main():
    # 找到目标页
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

        # 等引擎跑一会儿
        await asyncio.sleep(12)

        expr = """
        JSON.stringify({
          hasPetDemo: !!window.petDemo,
          loaded: window.petDemo ? window.petDemo.loaded() : null,
          clips: window.__petClips || null,
          anim: window.__petAnimName || null,
          scene: (function(){
            try {
              var d = cc.director.getScene();
              return d ? d.children.map(function(n){return n.name + ':' + n.children.length;}) : 'no scene';
            } catch(e){ return 'cc err: ' + e.message; }
          })(),
        })
        """
        r = await call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        print("STATE:", r.get("result", {}).get("value"))

        shot = await call("Page.captureScreenshot", {"format": "png"})
        with open(r"E:/git/PetCompanionship/tools/cocos/shots/cdp.png", "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print("screenshot saved")


asyncio.run(main())
