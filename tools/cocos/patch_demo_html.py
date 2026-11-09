# -*- coding: utf-8 -*-
"""给 Cocos web 构建产物注入动画切换 UI（仅演示用，不改 Cocos 引擎逻辑）
用法: python patch_demo_html.py <build_dir>
"""
import sys
import os
import io

UI = """
<div id="pet-panel">
  <div class="pp-title">长风 · 骨骼动画演示</div>
  <div class="pp-row">
    <button data-anim="idle">待机</button>
    <button data-anim="walk">走路</button>
    <button data-anim="happy">开心</button>
  </div>
  <div class="pp-hint">拖拽画面可旋转查看 · 点按钮切换动画</div>
</div>
<style>
#pet-panel{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);
  z-index:99999;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
  background:rgba(255,255,255,.86);border-radius:16px;padding:12px 16px;
  box-shadow:0 8px 28px rgba(60,90,140,.18);backdrop-filter:blur(8px);
  text-align:center;user-select:none}
#pet-panel .pp-title{font-size:13px;font-weight:600;color:#3d5169;margin-bottom:9px;letter-spacing:.3px}
#pet-panel .pp-row{display:flex;gap:8px;justify-content:center}
#pet-panel button{border:none;border-radius:10px;padding:8px 20px;font-size:14px;
  color:#456;background:#eef3fa;cursor:pointer;transition:all .15s;font-weight:500}
#pet-panel button:hover{background:#e0eaf8}
#pet-panel button.on{background:#5b9bf5;color:#fff;box-shadow:0 3px 10px rgba(91,155,245,.4)}
#pet-panel .pp-hint{margin-top:8px;font-size:11px;color:#93a3b8}
</style>
<script>
(function(){
  function ready(){
    var btns = document.querySelectorAll('#pet-panel button[data-anim]');
    btns.forEach(function(b){
      b.addEventListener('click', function(){
        if (window.petDemo) window.petDemo.play(b.dataset.anim);
      });
    });
    setInterval(function(){
      var cur = window.__petAnimName || '';
      btns.forEach(function(b){
        b.classList.toggle('on', b.dataset.anim === cur);
      });
    }, 200);
  }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready);
})();
</script>
"""


def main():
    d = sys.argv[1]
    p = os.path.join(d, 'index.html')
    with io.open(p, encoding='utf-8') as f:
        html = f.read()
    if 'id="pet-panel"' in html:
        print('已注入过，跳过')
        return
    idx = html.rfind('</body>')
    if idx < 0:
        html += UI
    else:
        html = html[:idx] + UI + '\n' + html[idx:]
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(html)
    print('已注入 UI →', p)


main()
