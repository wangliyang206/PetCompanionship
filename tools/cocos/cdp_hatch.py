# -*- coding: utf-8 -*-
"""CDP：孵化演示全流程验证（蛋 → 点孵化 → 幼崽登场 → 动画/换宠）
用法：先起 headless chrome（remote-debugging-port=9227）+ 本地服务 8766，再跑本脚本
"""
import asyncio
import json
import base64
import os
import urllib.request

# 沙箱代理会 502 拦截本机调试端口（D42 踩坑），必须直连
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PORT = 9227
OUT = r"E:/git/PetCompanionship/tools/cocos/shots_hatch"


async def main():
    os.makedirs(OUT, exist_ok=True)
    with OPENER.open(f'http://127.0.0.1:{PORT}/json') as r:
        targets = json.load(r)
    page = next(t for t in targets if t.get('type') == 'page')
    async with websockets_connect(page['webSocketDebuggerUrl']) as ws:
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

        async def wait_stage(stage, timeout=40):
            for _ in range(timeout * 2):
                v = await js("window.hatchDemo ? hatchDemo.stage() : null")
                if v == stage:
                    return True
                await asyncio.sleep(0.5)
            return False

        async def shot(name):
            s = await call("Page.captureScreenshot", {"format": "png"})
            with open(f"{OUT}/{name}.png", "wb") as f:
                f.write(base64.b64decode(s["data"]))
            print("saved", name)

        # 等页面与蛋就绪
        ok = False
        for _ in range(60):
            v = await js("window.hatchDemo ? hatchDemo.stage() : null")
            if v == 'egg':
                ok = True
                break
            await asyncio.sleep(1)
        print("[1] 蛋阶段就绪:", ok, "| stage =", await js("window.hatchDemo && hatchDemo.stage()"))
        await asyncio.sleep(2)   # 等贴图/蛋模型显示稳定
        await shot("01_egg")

        # 点孵化（直接调 API，等效点蛋）
        await js("hatchDemo.hatch()")
        print("[2] hatch() 已触发，等待幼崽登场…")
        ok = await wait_stage('pet', 30)
        print("[2] 幼崽登场:", ok,
              "| pet =", await js("hatchDemo.current()"),
              "| anim =", await js("hatchDemo.anim()"),
              "| clips =", await js("window.__petClips"))
        await asyncio.sleep(2.5)  # 等登场弹跳+贴图稳定
        await shot("02_born_tuantuan_idle")

        # 切换动画
        for anim, wait in (("walk", 1.6), ("happy", 1.2)):
            await js(f"hatchDemo.play('{anim}')")
            await asyncio.sleep(wait)
            cur = await js("hatchDemo.anim()")
            print(f"[3] 切动画 {anim} → 实际 {cur}")
            await shot(f"03_tuantuan_{anim}")

        # 切换宠物
        await js("hatchDemo.pet('changfeng')")
        for _ in range(30):
            if await js("hatchDemo.current()") == 'changfeng':
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(2.5)
        print("[4] 切长风:", await js("hatchDemo.current()"),
              "| anim =", await js("hatchDemo.anim()"))
        await shot("04_changfeng_idle")
        await js("hatchDemo.play('happy')")
        await asyncio.sleep(1.2)
        await shot("05_changfeng_happy")


        # 变换 dump（调试归一化，单行表达式）
        expr = "JSON.stringify((function(){var out=[];function dig(n,d){var p=n.position;out.push(new Array(d+1).join(' ')+n.name+' p=('+p.x.toFixed(2)+','+p.y.toFixed(2)+','+p.z.toFixed(2)+') s='+n.scale.x.toFixed(2)+(n.active?'':'[off]'));for(var i=0;i<n.children.length;i++)dig(n.children[i],d+1);}var s=cc.director.getScene();for(var i=0;i<s.children.length;i++)dig(s.children[i],0);return out;}()))"
        raw = await js(expr)
        try:
            tree = json.loads(raw)
            tree = tree[0] if isinstance(tree, list) else tree
            print("== 场景树 ==")
            print(tree.replace('\\n', chr(10)))
        except Exception as e:
            print("== 场景树原始 ==", str(raw)[:2000])
        print("pet mesh struct:", await js("(function(){var mr=null;var s=cc.director.getScene();s.children.forEach(function(c){if(c.name==='DemoHolder'&&c.getComponentInChildren)mr=c.getComponentInChildren(cc.MeshRenderer);});if(!mr||!mr.mesh)return 'no mesh';var st=mr.mesh.struct;return JSON.stringify({min:st.minPosition,max:st.maxPosition});})()"))
        print("[done] 全部截图 ->", OUT)


def websockets_connect(url):
    import websockets
    return websockets.connect(url, max_size=50 * 1024 * 1024)


asyncio.run(main())
