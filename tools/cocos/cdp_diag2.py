# -*- coding: utf-8 -*-
"""CDP 构图诊断：dump 完整场景树 / 相机参数 / 关键节点世界坐标 / 屏幕投影"""
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
                print("JS 异常:", json.dumps(r["exceptionDetails"], ensure_ascii=False)[:400])
            return res.get("value")

        # 等蛋就绪
        for _ in range(60):
            if await js("window.hatchDemo ? hatchDemo.stage() : null") == 'egg':
                break
            await asyncio.sleep(1)
        await asyncio.sleep(2)

        # --- 窗口/canvas ---
        print("== 窗口 ==", await js("JSON.stringify({iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio})"))
        print("== canvas ==", await js("(function(){var c=document.querySelector('canvas')||document.querySelector('#GameCanvas');return c?JSON.stringify({w:c.clientWidth,h:c.clientHeight,r:c.getBoundingClientRect():undefined}):'no canvas'})()".replace(',r:c.getBoundingClientRect():undefined','')))

        # --- 蛋阶段：场景树（含世界坐标）---
        TREE = ("JSON.stringify((function(){var out=[];"
                "function v3(v){return '('+v.x.toFixed(2)+','+v.y.toFixed(2)+','+v.z.toFixed(2)+')';}"
                "function dig(n,d){var wp=n.worldPosition;var e='';"
                "var cams=n.components?n.components.filter(function(c){return c instanceof cc.Camera;}):[];"
                "cams.forEach(function(c){e+=' [CAM pri='+c.priority+' vis='+c.visibility+' aspect='+(c.aspect||0).toFixed(3)+' fov='+c.fov+' clear='+c.clearFlags+'];'});"
                "out.push(new Array(d+1).join(' ')+n.name+' wp='+v3(wp)+' lp='+v3(n.position)+' s='+n.scale.x.toFixed(3)+' layer='+n.layer+(n.active?'':' [off]')+e);"
                "for(var i=0;i<n.children.length;i++)dig(n.children[i],d+1);}"
                "var s=cc.director.getScene();dig(s,0);return out.join('\\n');}()))")
        print("== 蛋阶段场景树 ==")
        print(await js(TREE))
        s = await call("Page.captureScreenshot", {"format": "png"})
        open(f"{OUT}/d1_egg.png", "wb").write(base64.b64decode(s["data"]))

        # 孵化到宠物阶段
        await js("hatchDemo.hatch()")
        for _ in range(60):
            if await js("hatchDemo.stage()") == 'pet':
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(2.5)

        print("== 宠物阶段场景树 ==")
        print(await js(TREE))

        # 相机把宠物胸口投影到屏幕
        PROJ = ("JSON.stringify((function(){var out=[];var cams=[];"
                "cc.director.getScene().walk(function(n){n.components.forEach(function(c){if(c&&c.isCamera)cams.push(c);});});"
                "var cw=document.getElementById('GameCanvas');"
                "cams.forEach(function(c){var p=c.node.worldPosition;"
                "var v=new cc.Vec3(0,0.3,0);"
                "var sx=null,sy=null;"
                "try{var w=c.worldToScreen(v,new cc.Vec3());sx=+w.x.toFixed(0);sy=+w.y.toFixed(0);}catch(e){sx='ERR:'+e.message;}"
                "out.push({name:c.node.name,pri:c.priority,aspect:(typeof c.aspect==='number'?+c.aspect.toFixed(3):String(c.aspect)),fovAxis:c.fovAxis,fov:c.fov,"
                "camPos:[+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)],"
                "petScreen:[sx,sy],vis:c.visibility,"
                "canvas:[cw?cw.width:0,cw?cw.height:0,cw?cw.clientWidth:0,cw?cw.clientHeight:0]});});"
                "return out;}()))")
        print("== 相机投影 (pet y=0.3 → 屏幕) ==", await js(PROJ))
        s = await call("Page.captureScreenshot", {"format": "png"})
        open(f"{OUT}/d2_pet.png", "wb").write(base64.b64decode(s["data"]))
        print("[done]")


asyncio.run(main())
