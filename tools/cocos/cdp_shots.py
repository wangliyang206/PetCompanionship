# -*- coding: utf-8 -*-
"""CDP：隐藏游戏UI层，依次播放三段动画并截图（验证 Cocos 内骨骼动画渲染）"""
import asyncio
import json
import base64
import urllib.request
import websockets

import os
PORT = int(os.environ.get('CDP_PORT', '9236'))
OUT = r"E:/git/PetCompanionship/tools/cocos/shots"

# 沙箱代理会拦截本机 CDP 端口（502），这里强制直连
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


async def main():
    for _ in range(20):
        try:
            with _opener.open(f'http://127.0.0.1:{PORT}/json', timeout=3) as r:
                targets = json.load(r)
            break
        except Exception:
            await asyncio.sleep(1)
    else:
        raise SystemExit("CDP 端口连不上")
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

        await asyncio.sleep(6)  # 引擎先起来

        # 轮询等宠物真正加载完（组件设置相机发生在 spawn 回调里）
        for _ in range(60):
            v = await js("!!(window.petDemo && window.petDemo.loaded())")
            if v:
                break
            await asyncio.sleep(1)
        print("pet loaded:", v)
        await asyncio.sleep(2)  # 等相机取景与 idle 起播

        # 隐藏游戏 UI 与调试层（仅演示，不改游戏代码）
        print("hide:", await js("""
        (function(){
          var out=[];
          var s=cc.director.getScene();
          s.children.forEach(function(n){
            if(n.name==='Canvas'||n.name==='PROFILER_NODE'){ n.active=false; out.push(n.name); }
          });
          return out.join(',');
        })()
        """))
        # 相机拉远一点看全身
        await js("""
        (function(){
          var cam=cc.find('Main Camera');
          if(cam){ cam.setPosition(0,0.32,0.95); cam.angle=-8; }
          return 'cam ok';
        })()
        """)
        await asyncio.sleep(1)
        await shot("cocos_idle")

        await js("window.petDemo.play('walk')")
        await asyncio.sleep(1.2)
        await shot("cocos_walk")

        await js("window.petDemo.play('happy')")
        await asyncio.sleep(0.45)
        await shot("cocos_happy_air")
        await asyncio.sleep(0.6)
        await shot("cocos_happy_land")

        print("done")


asyncio.run(main())
