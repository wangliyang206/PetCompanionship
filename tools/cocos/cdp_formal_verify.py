# -*- coding: utf-8 -*-
"""CDP 验证正式游戏骨骼接入：
注入「长风 baby 已孵化」存档 → 校验 PetView 走骨骼管线 → 模拟游走看 walk 剪辑 → 截图
"""
import asyncio, json, base64, os, urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PORT = 9228
OUT = r"E:/git/PetCompanionship/tools/cocos/shots_hatch"

SAVE_JS = """
(function(){
  try {
    var KEY='PetCompanionship.SaveData';
    if(!localStorage.getItem(KEY)){
      var now=Date.now();
      var save={version:2,createdAt:now,lastSeenTs:now,food:10,stardust:5,
        dailyGiftTs:0,eggPityTs:now,eggs:[],
        pets:[{id:'pet_cf1',speciesId:'mao_changfeng',stage:'baby',stageEnteredTs:now,
          companionship:20,lastInteractTs:now,missYouTs:''}],
        activePetId:'pet_cf1',memory:[],collectionFlags:{},exploreStates:{},
        notificationPrefs:{dailyMissYou:true}};
      localStorage.setItem(KEY,JSON.stringify(save));
    }
  } catch(e){}
})();
"""


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

        logs = []

        async def pump():
            while True:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.01))
                except asyncio.TimeoutError:
                    return
                if msg.get("method") == "Runtime.consoleAPICalled":
                    args = [str(a.get("value", a.get("description", "")))[:200]
                            for a in msg["params"].get("args", [])]
                    logs.append(" ".join(args))

        await call("Runtime.enable")
        await call("Page.addScriptToEvaluateOnNewDocument", {"source": SAVE_JS})
        await call("Page.enable")
        # 存档注入脚本只对「之后的导航」生效 → 重新加载一次
        await call("Page.navigate", {"url": "http://127.0.0.1:8767/index.html"})
        await asyncio.sleep(2)

        async def js(expr):
            await pump()
            r = await call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
            res = r.get("result", {})
            if "exceptionDetails" in r:
                print("JS 异常:", json.dumps(r["exceptionDetails"], ensure_ascii=False)[:300])
            await pump()
            return res.get("value")

        async def shot(name):
            s = await call("Page.captureScreenshot", {"format": "png"})
            open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(s["data"]))
            print("saved", name)

        # 等骨骼模型就位（PetView 打印『骨骼模型就位』）
        ok = False
        for _ in range(90):
            await pump()
            if any('骨骼模型就位' in l for l in logs):
                ok = True
                break
            await asyncio.sleep(1)
        print("[1] 骨骼模型加载:", ok)
        for l in logs:
            if 'PetView' in l or 'SceneSetup' in l or 'GameRoot' in l:
                print("   log:", l[:160])
        await asyncio.sleep(2.5)
        await shot("v1_formal_changfeng_baby")

        # 结构检查：PetModelHolder 下有 SkeletalAnimation、剪辑列表
        print("[2] 结构:", await js(
            "JSON.stringify((function(){var out={holder:false,sAnim:false,clips:[],skinned:0};"
            "var a=cc.director.getScene().getChildByName('PetAnchor');"
            "if(!a)return out;var h=a.getChildByName('PetModelHolder');"
            "if(!h)return out;out.holder=true;"
            "var sa=h.getComponentInChildren(cc.SkeletalAnimation||Object);"
            "h.walk(function(n){n.components.forEach(function(c){"
            "if(c&&c.constructor&&c.constructor.name&&c.constructor.name.indexOf('SkinnedMeshRenderer')>=0)out.skinned++;"
            "if(c&&c.clips){out.sAnim=true;out.clips=c.clips.filter(function(x){return !!x;}).map(function(x){return x.name;});}});});"
            "return out;}()))"))

        # 模拟游走：moveTo 触发位移 → walk 剪辑
        await js("(function(){var a=cc.director.getScene().getChildByName('PetAnchor');"
                 "var w=a?a.getComponent('WanderSystem'):null;"
                 "if(w&&w.moveTo)w.moveTo(new cc.Vec3(1.6,0,0.8),2.4);return 'moveTo ok';})()")
        await asyncio.sleep(1.2)
        await shot("v2_formal_walk_mid")
        await asyncio.sleep(2.2)
        await shot("v3_formal_walk_end")
        # 拖拽旋转无;点击互动 → happy?
        print("[done] logs tail:", logs[-3:])


asyncio.run(main())
