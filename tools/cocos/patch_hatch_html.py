# -*- coding: utf-8 -*-
"""给 Cocos web 构建产物注入孵化演示 UI（仅演示用，不改 Cocos 引擎逻辑）
用法: python patch_hatch_html.py <build_dir>
"""
import sys
import os
import io

FULLSCREEN = """
<style>
/* 演示页铺满视口：构建模板把 GameDiv 固定成 1280x960，小窗口会被裁切
   （表现为宠物"偏右下/被切掉"的假象） */
html,body{margin:0;padding:0;background:#e8edf4;overflow:hidden}
.header,.footer{display:none}
#GameDiv{width:100vw!important;height:100vh!important}
#Cocos3dGameContainer,#GameCanvas{width:100%!important;height:100%!important}
</style>
<script>
(function(){
  var gd=document.getElementById('GameDiv');
  if(gd){gd.style.width='100vw';gd.style.height='100vh';}
  var cv=document.getElementById('GameCanvas');
  if(cv){cv.style.width='100%';cv.style.height='100%';}
})();
</script>
"""

UI = """
<div id="pet-panel">
  <div class="pp-title">孵化演示 · 骨骼幼崽</div>
  <div class="pp-row">
    <button id="pp-hatch" data-act="hatch">🥚 孵化</button>
    <button data-anim="idle" disabled>待机</button>
    <button data-anim="walk" disabled>走路</button>
    <button data-anim="happy" disabled>开心</button>
  </div>
  <div class="pp-row">
    <span class="pp-lab">切换幼崽：</span>
    <button data-pet="tuantuan" disabled>团团</button>
    <button data-pet="changfeng" disabled>长风</button>
  </div>
  <div class="pp-hint">点击画面里的蛋即可孵化 · 孵化后拖拽可旋转</div>
</div>
<style>
#pet-panel{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);
  z-index:99999;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
  background:rgba(255,255,255,.86);border-radius:16px;padding:12px 16px;
  box-shadow:0 8px 28px rgba(60,90,140,.18);backdrop-filter:blur(8px);
  text-align:center;user-select:none}
#pet-panel .pp-title{font-size:13px;font-weight:600;color:#3d5169;margin-bottom:9px;letter-spacing:.3px}
#pet-panel .pp-row{display:flex;gap:8px;justify-content:center;align-items:center;margin-top:6px}
#pet-panel .pp-lab{font-size:12px;color:#7d8ba0}
#pet-panel button{border:none;border-radius:10px;padding:8px 18px;font-size:14px;
  color:#456;background:#eef3fa;cursor:pointer;transition:all .15s;font-weight:500}
#pet-panel button:disabled{opacity:.45;cursor:default}
#pet-panel button:not(:disabled):hover{background:#e0eaf8}
#pet-panel button.on{background:#5b9bf5;color:#fff;box-shadow:0 3px 10px rgba(91,155,245,.4)}
#pet-panel .pp-hint{margin-top:8px;font-size:11px;color:#93a3b8}
</style>
<script>
(function(){
  function ready(){
    var panel = document.getElementById('pet-panel');
    var abtns = panel.querySelectorAll('button[data-anim]');
    var pbtns = panel.querySelectorAll('button[data-pet]');
    var hbtn  = panel.querySelector('#pp-hatch');
    abtns.forEach(function(b){ b.addEventListener('click', function(){
      if (window.hatchDemo) window.hatchDemo.play(b.dataset.anim);
    });});
    pbtns.forEach(function(b){ b.addEventListener('click', function(){
      if (window.hatchDemo) window.hatchDemo.pet(b.dataset.pet);
    });});
    if (hbtn) hbtn.addEventListener('click', function(){
      if (window.hatchDemo) window.hatchDemo.hatch();
    });
    setInterval(function(){
      var st = (window.hatchDemo && window.hatchDemo.stage()) || 'egg';
      var cur = (window.__petAnimName || '');
      var pet = (window.hatchDemo && window.hatchDemo.current()) || '';
      var born = st === 'pet';
      if (hbtn) hbtn.disabled = born;
      if (hbtn) hbtn.textContent = born ? '已孵化' : '\\uD83E\\uDD5A \\u5B75\\u5316';
      abtns.forEach(function(b){ b.disabled = !born; });
      pbtns.forEach(function(b){ b.disabled = !born; });
      abtns.forEach(function(b){ b.classList.toggle('on', born && b.dataset.anim === cur); });
      pbtns.forEach(function(b){ b.classList.toggle('on', born && b.dataset.pet === pet); });
    }, 200);
  }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready);
})();
</script>
"""


def main():
    build_dir = sys.argv[1] if len(sys.argv) > 1 else 'build/petdemo'
    idx = os.path.join(build_dir, 'index.html')
    if not os.path.exists(idx):
        print(f'[patch] 找不到 {idx}')
        sys.exit(1)
    html = io.open(idx, encoding='utf-8').read()
    if 'id="pet-panel"' in html:
        print('[patch] 已注入过，跳过')
        return
    marker = '</body>'
    if marker not in html:
        print('[patch] index.html 无 </body> 标记')
        sys.exit(1)
    html = html.replace(marker, FULLSCREEN + UI + '\n' + marker)
    io.open(idx, 'w', encoding='utf-8').write(html)
    print('[patch] 全屏样式 + 孵化演示 UI 已注入', idx)


main()
